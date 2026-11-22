import fixtures from './__fixtures__/mp3-bytes.json'
import {
  DECODER_DELAY,
  assembleSlice,
  averageFrameBytes,
  chainedHeader,
  crc16Lame,
  findSync,
  id3v2Size,
  nearestSync,
  parseFrameHeader,
  parseMp3Head,
  planSlice,
  primingSamples,
  readTagFrame,
  resignLameCrc,
  SYNC_SLACK,
  type Mp3Head,
} from './mp3'

type FixtureName = keyof typeof fixtures.files

function bytes(name: FixtureName): Uint8Array {
  const bin = atob(fixtures.files[name].base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function head(name: FixtureName): Mp3Head {
  const b = bytes(name)
  const h = parseMp3Head(b, 0, id3v2Size(b))
  if (typeof h === 'string') throw new Error(`${name}: ${h}`)
  return h
}

/** A synthetic MPEG-1 Layer III frame (header + zero body): 44.1 kHz, stereo, no CRC. */
function frame(kbps: number, padding = 0): Uint8Array {
  const idx = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320].indexOf(kbps)
  const len = Math.floor((144000 * kbps) / 44100) + padding
  const f = new Uint8Array(len)
  f[0] = 0xff
  f[1] = 0xfb
  f[2] = (idx << 4) | (0 << 2) | (padding << 1)
  f[3] = 0x00
  return f
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('frame headers', () => {
  it('parses MPEG-1 and MPEG-2 Layer III headers from real files', () => {
    const y = bytes('yasser-qdc97-112-head')
    const h = parseFrameHeader(y, id3v2Size(y))
    expect(h).toMatchObject({ version: 1, bitrateKbps: 128, sampleRate: 44100, samplesPerFrame: 1152, mono: false, tagOffset: 36 })
    expect([417, 418]).toContain(h!.frameBytes)
    expect(h!.nominalFrameBytes).toBeCloseTo(417.959, 3)

    const g = bytes('ghamdi-mp3quran-112-head')
    expect(parseFrameHeader(g, id3v2Size(g))).toMatchObject({ version: 2, bitrateKbps: 96, sampleRate: 22050, samplesPerFrame: 576 })
  })

  it('rejects non-headers, free format and reserved values', () => {
    expect(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0x00, 0x00]), 0)).toBeNull() // free-format bitrate
    expect(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0xf0, 0x00]), 0)).toBeNull() // bitrate index 15
    expect(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0x9c, 0x00]), 0)).toBeNull() // sample-rate index 3
    expect(parseFrameHeader(new Uint8Array([0xff, 0xfd, 0x90, 0x00]), 0)).toBeNull() // layer II
    expect(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0x90, 0x02]), 0)).toBeNull() // reserved emphasis
    expect(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0x90]), 0)).toBeNull() // truncated
  })

  it('measures ID3v2 tags', () => {
    expect(id3v2Size(bytes('yasser-qdc97-112-head'))).toBe(8746)
    expect(id3v2Size(bytes('shatri-qdc4-112-head'))).toBe(45)
    expect(id3v2Size(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0]))).toBe(0)
  })

  it('needs three chained headers for a sync', () => {
    const run = concat(new Uint8Array([1, 2, 0xff, 0xfb, 0x90]), frame(128), frame(128, 1), frame(128))
    expect(findSync(run)).toBe(5)
    expect(chainedHeader(run, 5, 128)).not.toBeNull()
    expect(chainedHeader(run, 5, 160)).toBeNull()
    // only two frames: no sync
    expect(findSync(concat(frame(128), frame(128)))).toBe(-1)
    // nearest sync to a prediction that is off by 40 bytes
    expect(nearestSync(run, 45, 64)).toBe(5)
    expect(nearestSync(run, 45, 30)).toBe(-1)
  })
})

describe('file heads', () => {
  it('untagged CBR (Yasser QDC): audio starts at the first frame, raw windows', () => {
    const h = head('yasser-qdc97-112-head')
    expect(h.tag).toBeNull()
    expect(h.audioStart).toBe(8746)
    expect(h.audio.bitrateKbps).toBe(128)
    expect(h.headBitrates).toEqual([128])
    expect(h.infoFrame).toBeNull()
    expect(primingSamples(h)).toBe(0)
    expect(averageFrameBytes(h)).toBeCloseTo(144000 * 128 / 44100, 9)
  })

  it('ffmpeg-muxed Info frame at 64 kbps in front of 128 kbps audio (Shatri QDC): rate from the first AUDIO frame', () => {
    const h = head('shatri-qdc4-112-head')
    expect(h.tag).toBe('Info')
    expect(h.firstFrameOffset).toBe(45)
    expect(h.infoFrame!.length).toBe(208)
    expect(h.audioStart).toBe(45 + 208)
    expect(h.audio.bitrateKbps).toBe(128)
    expect(h.encoder).toBe('Lavc58.54')
    expect(h.encoderDelay).toBe(576)
    expect(primingSamples(h)).toBe(576 + DECODER_DELAY)
  })

  it('LAME Info tag totals give the true average frame size (QDC Alafasy ch 2 drifts −141 B by 7000 s)', () => {
    const h = head('alafasy-qdc7-2-head')
    expect(h).toMatchObject({ tag: 'Info', encoder: 'LAME3.96r', encoderDelay: 576, tagFrames: 278080, tagBytes: 116226364 })
    expect(averageFrameBytes(h)).toBeCloseTo((116226364 - 417) / 278080, 9)
    expect(averageFrameBytes(h)).toBeLessThan(h.audio.nominalFrameBytes)
  })

  it('refuses VBR: a Xing tag (QDC Alafasy ch 1, 192 kbps head frames then 128 kbps)', () => {
    const b = bytes('alafasy-qdc7-1-head')
    expect(parseMp3Head(b, 0, id3v2Size(b))).toBe('vbr')
  })

  it('refuses VBR detected from the head frames even without a tag', () => {
    const b = concat(frame(128), frame(128), frame(128), frame(160), frame(128))
    expect(parseMp3Head(b, 0, 0)).toBe('vbr')
    expect(parseMp3Head(concat(frame(128), frame(128), frame(128), frame(128)), 0, 0)).toMatchObject({ tag: null, headBitrates: [128] })
  })

  it('re-signs a bad LAME tag CRC (QDC Husary ch 2, MPEG-2 22.05 kHz) and keeps a good one', () => {
    const h = head('husary-qdc6-2-head')
    expect(h.audio).toMatchObject({ version: 2, sampleRate: 22050, samplesPerFrame: 576, bitrateKbps: 64 })
    expect(h.encoder).toBe('LAME3.98r')
    const raw = bytes('husary-qdc6-2-head').slice(h.firstFrameOffset, h.firstFrameOffset + h.infoFrame!.length)
    const crcAt = 4 + 17 + 8 + 4 + 4 + 100 + 4 + 34 // header + side info + Xing (flags 15) + LAME offset of the CRC
    expect((raw[crcAt] << 8) | raw[crcAt + 1]).toBe(0x076f) // stored, wrong
    expect((h.infoFrame![crcAt] << 8) | h.infoFrame![crcAt + 1]).toBe(0x143b) // re-signed
    expect(crc16Lame(h.infoFrame!, crcAt)).toBe(0x143b)

    const good = head('alafasy-qdc7-2-head')
    const original = bytes('alafasy-qdc7-2-head').slice(good.firstFrameOffset, good.firstFrameOffset + good.infoFrame!.length)
    expect(Array.from(good.infoFrame!)).toEqual(Array.from(original))
  })

  it('repairs a bad LAME CRC in place in whole-file bytes (per-ayah files are decoded whole, N3)', () => {
    const b = bytes('husary-qdc6-2-head')
    const t = readTagFrame(b, id3v2Size(b))!
    expect(t).toMatchObject({ tag: 'Info', encoder: 'LAME3.98r', offset: id3v2Size(b) })
    expect((b[t.lameCrcAt] << 8) | b[t.lameCrcAt + 1]).toBe(0x076f)
    expect(resignLameCrc(b, t)).toBe(true)
    expect((b[t.lameCrcAt] << 8) | b[t.lameCrcAt + 1]).toBe(0x143b)
    expect(resignLameCrc(b, t)).toBe(false) // now valid: untouched

    const good = bytes('alafasy-qdc7-2-head')
    const before = Array.from(good)
    const tg = readTagFrame(good, id3v2Size(good))!
    expect(tg.lameCrcAt).toBeGreaterThan(0)
    expect(resignLameCrc(good, tg)).toBe(false)
    expect(Array.from(good)).toEqual(before)
  })

  it('finds the LAME Info tag of a CRC-protected stream at 4 + side info, not after the CRC (EveryAyah Alafasy)', () => {
    const b = bytes('alafasy-everyayah-112001-head')
    const h0 = parseFrameHeader(b, 0)!
    expect(h0).toMatchObject({ crc: true, tagOffset: 36, bitrateKbps: 128, sampleRate: 44100 })
    const t = readTagFrame(b, 0)!
    expect(t).toMatchObject({ offset: 0, tag: 'Info' })
    expect(t.encoder).toMatch(/^LAME/)
    expect(t.lameCrcAt).toBeGreaterThan(36)
    const h = head('alafasy-everyayah-112001-head')
    expect(h).toMatchObject({ tag: 'Info', audioStart: h0.frameBytes })
    expect(primingSamples(h)).toBe(h.encoderDelay + DECODER_DELAY)
    // a tag written after the CRC (other encoders) is accepted too
    const shifted = new Uint8Array(b)
    shifted.copyWithin(38, 36, 300)
    shifted.set([0, 0], 36)
    expect(readTagFrame(shifted, 0)).toMatchObject({ tag: 'Info' })
  })

  it('reads an untagged file as tag null with no LAME CRC to fix', () => {
    const b = bytes('yasser-qdc97-112-head')
    const t = readTagFrame(b, id3v2Size(b))!
    expect(t).toMatchObject({ tag: null, offset: 8746, lameCrcAt: -1, encoder: null })
    expect(t.header.sampleRate).toBe(44100)
    expect(resignLameCrc(b, t)).toBe(false)
    expect(readTagFrame(new Uint8Array(500), 0)).toBeNull()
  })

  it('Lavf Info with no encoder delay (QDC Khalifa ch 112): only the decoder delay is primed', () => {
    const h = head('khalifa-qdc161-112-head')
    expect(h.encoder).toBe('Lavf')
    expect(h.encoderDelay).toBe(0)
    expect(primingSamples(h)).toBe(DECODER_DELAY)
  })

  it('untagged MPEG-2 (Ghamdi mp3quran)', () => {
    const h = head('ghamdi-mp3quran-112-head')
    expect(h.tag).toBeNull()
    expect(h.audio).toMatchObject({ sampleRate: 22050, bitrateKbps: 96, samplesPerFrame: 576 })
    expect(h.audioStart).toBe(id3v2Size(bytes('ghamdi-mp3quran-112-head')))
  })

  it('accepts a head re-fetched from the end of a large ID3 tag', () => {
    const b = bytes('yasser-qdc97-112-head')
    const h = parseMp3Head(b.slice(8746), 8746, 8746)
    expect(h).toMatchObject({ audioStart: 8746, firstFrameOffset: 8746, tag: null })
  })
})

describe('Range windows', () => {
  it('plans frames and bytes (untagged: no priming)', () => {
    const h = head('yasser-qdc97-112-head')
    const fb = 144000 * 128 / 44100
    const p = planSlice(h, 10_000, 12_000)
    expect(p.n0).toBe(Math.floor((10 * 44100) / 1152) - 2) // 380
    expect(p.n1).toBe(Math.ceil((12 * 44100) / 1152) + 2) // 462
    expect(p.predicted).toBe(8746 + Math.floor(p.n0 * fb))
    expect(p.lo).toBe(p.predicted - SYNC_SLACK)
    expect(p.hi).toBe(8746 + Math.floor((p.n1 + 1) * fb) + SYNC_SLACK)
    // the bytes requested cover 2 s at 16 000 B/s + ≤ 7 frames of pre/post-roll + slack
    expect(p.hi - p.lo).toBeLessThan(2 * 16000 + 7 * 418 + 2 * SYNC_SLACK)
    expect(p.hi - p.lo).toBeGreaterThan(2 * 16000)
  })

  it('plans the end with the priming of a tagged file and never before the audio start', () => {
    const h = head('alafasy-qdc7-2-head')
    const p = planSlice(h, -5_000, 0)
    expect(p.n0).toBe(0)
    expect(p.lo).toBe(h.audioStart)
    expect(p.n1).toBe(Math.ceil(1105 / 1152) + 2)
  })

  it('finds the true frame at 7000 s of QDC Alafasy ch 2 and its index (independent ffmpeg frame walk)', () => {
    const h = head('alafasy-qdc7-2-head')
    const plan = planSlice(h, 7_000_000, 7_000_000)
    expect(plan.n0).toBe(267966)
    const f = fixtures.files['alafasy-qdc7-2-window-7000s']
    const win = bytes('alafasy-qdc7-2-window-7000s')
    const lo = Math.max(plan.lo, f.offset)
    const s = assembleSlice(h, { ...plan, lo }, win.subarray(lo - f.offset), lo)
    if (typeof s === 'string') throw new Error(s)
    expect(s.frameIndex).toBe(267966)
    const first = parseFrameHeader(win, s.firstFrameOffset - f.offset)!
    expect(s.firstFrameOffset + first.frameBytes).toBe(111999590) // frame 267967 per the ground truth
    expect(s.startMs).toBeCloseTo((267966 * 1152 / 44100) * 1000, 6)
    // [re-signed Info frame] + whole frames
    expect(Array.from(s.bytes.subarray(0, h.infoFrame!.length))).toEqual(Array.from(h.infoFrame!))
    expect(parseFrameHeader(s.bytes, h.infoFrame!.length)).not.toBeNull()
    expect(s.frames).toBe(plan.n1 - plan.n0 + 1)
  })

  it('trims a window that starts mid-frame to the first valid sync (WebKit rejects partial frames)', () => {
    const h = head('yasser-qdc97-112-head')
    const b = bytes('yasser-qdc97-112-head')
    const plan = planSlice(h, 0, 50)
    const cut = 8746 + 200 // 200 bytes into the first audio frame
    const s = assembleSlice(h, { ...plan, lo: cut, predicted: cut }, b.subarray(cut), cut)
    if (typeof s === 'string') throw new Error(s)
    expect(s.firstFrameOffset).toBeGreaterThan(cut)
    expect(chainedHeader(b, s.firstFrameOffset, 128)).not.toBeNull()
    expect(s.frameIndex).toBe(1)
    expect(s.bytes[0]).toBe(0xff)
  })

  it('reports VBR when the window changes bitrate, and end-of-data when it runs out', () => {
    const h = parseMp3Head(concat(frame(128), frame(128), frame(128), frame(128)), 0, 0) as Mp3Head
    const vbrWin = concat(frame(128), frame(128), frame(128), frame(160), frame(128), frame(128))
    expect(assembleSlice(h, { n0: 0, n1: 10, lo: 0, hi: vbrWin.length - 1, predicted: 0 }, vbrWin, 0)).toBe('vbr')

    const short = concat(frame(128), frame(128), frame(128), frame(128).subarray(0, 100))
    const s = assembleSlice(h, { n0: 0, n1: 10, lo: 0, hi: 5000, predicted: 0 }, short, 0)
    expect(s).toMatchObject({ frames: 3, hitEnd: true, frameIndex: 0 })
    expect(assembleSlice(h, { n0: 0, n1: 10, lo: 0, hi: 100, predicted: 0 }, new Uint8Array(300), 0)).toBe('no-sync')
  })
})
