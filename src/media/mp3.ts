// Pure MPEG audio (Layer III) helpers for fetching a time window of a long CBR MP3 with HTTP Range.
// No I/O, no DOM: shared by the web platform today and the native port later. Unit-tested on real
// file heads in __fixtures__/.
//
// Sources (read these before changing anything here):
//   research/audio-timing.md §7 (+ Independent verification #9, #10) — ID3 skip, 3-header sync, trim to
//     the first valid sync (WebKit rejects a slice that starts mid-frame), ±1 s margin, frame-index origin;
//   research/media-pipeline.md §7.3 (+ its Independent verification) — prepend the file's own Info frame
//     so both engines drop the encoder priming; take the CBR rate from the first AUDIO frame (ffmpeg-muxed
//     files carry a 64 kbps Info frame in front of 128 kbps audio); support MPEG-2/2.5 (576-sample
//     frames); re-sign the LAME tag CRC (AudioToolbox ignores a tag with a bad CRC); average frame size
//     from the tag's own totals (long QDC files drift up to −141 B from the nominal size).

const KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const RATES: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/** MPEG-1/2 Layer III decoder delay in samples; added to the LAME encoder delay by every gapless decoder. */
export const DECODER_DELAY = 529

export interface Mp3FrameHeader {
  /** 1 = MPEG-1, 2 = MPEG-2, 2.5 = MPEG-2.5 */
  version: 1 | 2 | 2.5
  bitrateKbps: number
  sampleRate: number
  /** 1152 (MPEG-1) or 576 (MPEG-2/2.5) */
  samplesPerFrame: number
  /** whole frame length in bytes, header included */
  frameBytes: number
  /** nominal (unpadded, fractional) frame size: coefficient × kbps / sampleRate */
  nominalFrameBytes: number
  mono: boolean
  /** true when a 16-bit CRC follows the header (protection bit 0) */
  crc: boolean
  /**
   * where a Xing/Info tag starts: 4 + side info. LAME writes the tag there even in CRC-protected streams
   * (VbrTag.c: "if (cfg->error_protection) nStreamIndex -= 2") and ffmpeg/mutagen read it there; readTagFrame
   * also accepts it 2 bytes later, after the CRC.
   */
  tagOffset: number
}

/** Parses a Layer III frame header at b[o], or null when there is none. Free-format and reserved values are rejected. */
export function parseFrameHeader(b: Uint8Array, o: number): Mp3FrameHeader | null {
  if (o < 0 || o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null
  const ver = (b[o + 1] >> 3) & 3
  const layer = (b[o + 1] >> 1) & 3
  if (ver === 1 || layer !== 1) return null
  const bi = b[o + 2] >> 4
  const si = (b[o + 2] >> 2) & 3
  if (bi === 0 || bi === 15 || si === 3) return null
  if ((b[o + 3] & 3) === 2) return null // reserved emphasis: not a real header
  const mpeg1 = ver === 3
  const bitrateKbps = (mpeg1 ? KBPS_V1 : KBPS_V2)[bi]
  const sampleRate = RATES[ver][si]
  const coef = mpeg1 ? 144000 : 72000
  const mono = b[o + 3] >> 6 === 3
  const crc = (b[o + 1] & 1) === 0
  const side = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17
  return {
    version: mpeg1 ? 1 : ver === 2 ? 2 : 2.5,
    bitrateKbps,
    sampleRate,
    samplesPerFrame: mpeg1 ? 1152 : 576,
    frameBytes: Math.floor((coef * bitrateKbps) / sampleRate) + ((b[o + 2] >> 1) & 1),
    nominalFrameBytes: (coef * bitrateKbps) / sampleRate,
    mono,
    crc,
    tagOffset: 4 + side,
  }
}

/** Size of a leading ID3v2 tag (header + body + optional footer), 0 when the bytes do not start with "ID3". */
export function id3v2Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0
  const body = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
  return 10 + body + (b[5] & 0x10 ? 10 : 0)
}

/** Header at o when it chains to two more headers of the same version and sample rate (and bitrate, if given). */
export function chainedHeader(b: Uint8Array, o: number, bitrateKbps?: number): Mp3FrameHeader | null {
  const h1 = parseFrameHeader(b, o)
  if (!h1 || (bitrateKbps !== undefined && h1.bitrateKbps !== bitrateKbps)) return null
  const h2 = parseFrameHeader(b, o + h1.frameBytes)
  if (!h2 || h2.version !== h1.version || h2.sampleRate !== h1.sampleRate) return null
  if (bitrateKbps !== undefined && h2.bitrateKbps !== bitrateKbps) return null
  const h3 = parseFrameHeader(b, o + h1.frameBytes + h2.frameBytes)
  if (!h3 || h3.version !== h1.version || h3.sampleRate !== h1.sampleRate) return null
  if (bitrateKbps !== undefined && h3.bitrateKbps !== bitrateKbps) return null
  return h1
}

/** First offset ≥ from that starts three chained frames, or −1. */
export function findSync(b: Uint8Array, from = 0, bitrateKbps?: number): number {
  for (let o = Math.max(0, from); o + 4 <= b.length; o++) if (b[o] === 0xff && chainedHeader(b, o, bitrateKbps)) return o
  return -1
}

/** Chained sync nearest to `predicted` (searching ±slack), or −1. */
export function nearestSync(b: Uint8Array, predicted: number, slack: number, bitrateKbps?: number): number {
  for (let r = 0; r <= slack; r++) {
    for (const o of r === 0 ? [predicted] : [predicted - r, predicted + r]) {
      if (o >= 0 && o + 4 <= b.length && b[o] === 0xff && chainedHeader(b, o, bitrateKbps)) return o
    }
  }
  return -1
}

/** CRC-16 used by the LAME tag: polynomial 0x8005 reflected (0xA001), initial value 0. */
export function crc16Lame(b: Uint8Array, end: number): number {
  let crc = 0
  for (let i = 0; i < end; i++) {
    crc ^= b[i]
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
  }
  return crc
}

export interface Mp3Head {
  /** ID3v2 bytes before the first frame */
  id3Bytes: number
  /** absolute offset of the first frame (the Info/Xing frame when there is one) */
  firstFrameOffset: number
  /** 'Info' = CBR tag, 'Xing'/'VBRI' = VBR tag, null = untagged */
  tag: 'Info' | 'Xing' | 'VBRI' | null
  /** absolute offset of the first audio frame (after the tag frame) */
  audioStart: number
  /** header of the first AUDIO frame: the stream's real bitrate/sample rate */
  audio: Mp3FrameHeader
  /** distinct bitrates seen while walking the audio frames held in the head bytes */
  headBitrates: number[]
  /** Xing/Info totals: audio frames (tag frame excluded) and bytes (tag frame included, ID3 excluded) */
  tagFrames: number | null
  tagBytes: number | null
  /** LAME-extension encoder string ("LAME3.96r", "Lavc58.54", "Lavf"), null without one */
  encoder: string | null
  /** LAME-extension encoder delay in samples (0 when absent) */
  encoderDelay: number
  /**
   * The tag frame to prepend to a window, LAME CRC re-signed; null for untagged files (their windows are
   * decoded raw, origin = frame index).
   */
  infoFrame: Uint8Array | null
}

/** Why a file cannot be cut with Range requests. */
export type Mp3HeadProblem = 'no-sync' | 'vbr'

export interface TagFrame {
  /** offset (in the given bytes) of the first frame */
  offset: number
  header: Mp3FrameHeader
  /** 'Info'/'Xing' (gapless decoders trim the priming) · 'VBRI' · null = untagged (decoded raw) */
  tag: 'Info' | 'Xing' | 'VBRI' | null
  tagFrames: number | null
  tagBytes: number | null
  encoder: string | null
  encoderDelay: number
  /** offset (in the given bytes) of the LAME tag's CRC-16, −1 without a LAME extension */
  lameCrcAt: number
}

/** Finds the first frame at or after `from` (3-frame chain) and reads its Xing/Info/VBRI tag and LAME extension. */
export function readTagFrame(b: Uint8Array, from: number): TagFrame | null {
  // ffmpeg-muxed files write the Info frame at a smaller bitrate than the audio: chain on version + rate only.
  const f = findSync(b, Math.max(0, from))
  const header = f < 0 ? null : parseFrameHeader(b, f)
  if (!header) return null
  const isXing = (o: number) => ascii(b, o, 4) === 'Info' || ascii(b, o, 4) === 'Xing'
  const x = isXing(f + header.tagOffset) ? f + header.tagOffset : header.crc && isXing(f + header.tagOffset + 2) ? f + header.tagOffset + 2 : -1
  const tag: TagFrame['tag'] = x >= 0 ? (ascii(b, x, 4) as 'Info' | 'Xing') : ascii(b, f + 36, 4) === 'VBRI' ? 'VBRI' : null
  const out: TagFrame = { offset: f, header, tag, tagFrames: null, tagBytes: null, encoder: null, encoderDelay: 0, lameCrcAt: -1 }
  if (tag !== 'Info' && tag !== 'Xing') return out
  const flags = u32(b, x + 4)
  let p = x + 8
  if (flags & 1) {
    out.tagFrames = u32(b, p)
    p += 4
  }
  if (flags & 2) {
    out.tagBytes = u32(b, p)
    p += 4
  }
  if (flags & 4) p += 100
  if (flags & 8) p += 4
  const enc = ascii(b, p, 9)
  if (/^[A-Za-z]{3,4}/.test(enc) && p + 36 <= f + header.frameBytes && p + 36 <= b.length) {
    out.encoder = enc.replace(/[^\x20-\x7e]+/g, '').trim() || null
    out.encoderDelay = (b[p + 21] << 4) | (b[p + 22] >> 4)
    out.lameCrcAt = p + 34
  }
  return out
}

/**
 * Re-signs the LAME tag CRC of the tag frame in place (WebKit/AudioToolbox ignores a tag whose CRC is
 * wrong and then keeps the encoder delay). Returns true when the stored CRC was wrong.
 */
export function resignLameCrc(b: Uint8Array, t: TagFrame): boolean {
  if (t.lameCrcAt < 0) return false
  const crc = crc16Lame(b.subarray(t.offset), t.lameCrcAt - t.offset)
  const stored = (b[t.lameCrcAt] << 8) | b[t.lameCrcAt + 1]
  if (stored === crc) return false
  b[t.lameCrcAt] = crc >> 8
  b[t.lameCrcAt + 1] = crc & 0xff
  return true
}

/**
 * Parses the start of an MP3. `b` holds file bytes starting at absolute offset `base` (non-zero when the
 * ID3 tag was too big and the head was re-fetched from its end); `id3Bytes` is the ID3v2 size measured on
 * the true file start.
 */
export function parseMp3Head(b: Uint8Array, base: number, id3Bytes: number): Mp3Head | Mp3HeadProblem {
  const t = readTagFrame(b, id3Bytes - base)
  if (!t) return 'no-sync'
  const f = t.offset
  const audioRel = t.tag ? f + t.header.frameBytes : f
  const audio = parseFrameHeader(b, audioRel)
  if (!audio || audio.sampleRate !== t.header.sampleRate) return 'no-sync'

  const headBitrates: number[] = []
  for (let o = audioRel, h = audio as Mp3FrameHeader | null; h && o + h.frameBytes <= b.length; o += h.frameBytes, h = parseFrameHeader(b, o)) {
    if (h.sampleRate !== audio.sampleRate) break
    if (!headBitrates.includes(h.bitrateKbps)) headBitrates.push(h.bitrateKbps)
  }
  if (t.tag === 'Xing' || t.tag === 'VBRI' || headBitrates.length > 1) return 'vbr'

  let infoFrame: Uint8Array | null = null
  if (t.tag === 'Info') {
    infoFrame = b.slice(f, f + t.header.frameBytes)
    if (t.lameCrcAt >= 0) resignLameCrc(infoFrame, { ...t, offset: 0, lameCrcAt: t.lameCrcAt - f })
  }
  return {
    id3Bytes,
    firstFrameOffset: base + f,
    tag: t.tag,
    audioStart: base + audioRel,
    audio,
    headBitrates,
    tagFrames: t.tagFrames,
    tagBytes: t.tagBytes,
    encoder: t.encoder,
    encoderDelay: t.encoderDelay,
    infoFrame,
  }
}

/**
 * Average audio-frame size in bytes. The Info tag's totals give the true average (real files are up to
 * 0.0005 B/frame shorter than nominal, −141 B by 7000 s — enough to round a 64 kbps frame index wrong);
 * untagged files measured 0–1 B of drift over 7200 s, so they use the nominal size.
 */
export function averageFrameBytes(head: Mp3Head): number {
  const nominal = head.audio.nominalFrameBytes
  if (head.tagFrames && head.tagBytes && head.infoFrame) {
    const fromTag = (head.tagBytes - head.infoFrame.length) / head.tagFrames
    if (Math.abs(fromTag - nominal) < nominal * 0.01) return fromTag
  }
  return nominal
}

/** Samples the decoder drops from a window's start: encoder delay + decoder delay for tagged files, none for raw windows. */
export function primingSamples(head: Mp3Head): number {
  return head.infoFrame ? head.encoderDelay + DECODER_DELAY : 0
}

/** Bytes of search slack around a predicted frame start (drift + rounding; 512 as in the research). */
export const SYNC_SLACK = 512

export interface SlicePlan {
  /** first and last frame index wanted (pre/post-roll included) */
  n0: number
  n1: number
  /** inclusive byte range to request */
  lo: number
  hi: number
  /** absolute offset where frame n0 is predicted to start */
  predicted: number
}

/**
 * Byte range covering file time [fromMs, toMs] (the caller adds its margins) with 2 frames of pre-roll
 * and post-roll. A window decoded from frame n starts at time n·spf/sr in the gapless (tagged) or raw
 * (untagged) timeline — the decoder drops the priming from the window itself.
 */
export function planSlice(head: Mp3Head, fromMs: number, toMs: number): SlicePlan {
  const { sampleRate: sr, samplesPerFrame: spf } = head.audio
  const fb = averageFrameBytes(head)
  const priming = primingSamples(head)
  const n0 = Math.max(0, Math.floor((Math.max(0, fromMs) / 1000) * sr / spf) - 2)
  const n1 = Math.max(n0 + 1, Math.ceil(((Math.max(0, toMs) / 1000) * sr + priming) / spf) + 2)
  const predicted = head.audioStart + Math.floor(n0 * fb)
  const lo = Math.max(head.audioStart, predicted - SYNC_SLACK)
  const hi = head.audioStart + Math.floor((n1 + 1) * fb) + SYNC_SLACK
  return { n0, n1, lo, hi, predicted }
}

export interface SliceBytes {
  /** bytes to hand to decodeAudioData: [Info frame] + whole frames from the first valid sync */
  bytes: Uint8Array
  /** frame index of the first window frame (rounded from its byte offset) */
  frameIndex: number
  /** file time (ms) of the first decoded sample */
  startMs: number
  /** number of audio frames kept */
  frames: number
  /** absolute offset of the first kept frame */
  firstFrameOffset: number
  /** true when the window ended at the end of the file data */
  hitEnd: boolean
}

export type SliceProblem = 'no-sync' | 'vbr'

/**
 * Trims a fetched window to whole frames: finds the chained sync nearest to the predicted frame start
 * (falling back to a forward scan), derives its frame index by rounding, walks frames up to plan.n1, and
 * prepends the re-signed Info frame for tagged files. A frame at another bitrate means the file is VBR.
 */
export function assembleSlice(head: Mp3Head, plan: SlicePlan, win: Uint8Array, winOffset: number): SliceBytes | SliceProblem {
  const kbps = head.audio.bitrateKbps
  let s = nearestSync(win, plan.predicted - winOffset, SYNC_SLACK, kbps)
  if (s < 0) s = findSync(win, 0, kbps)
  if (s < 0) return findSync(win, 0) >= 0 ? 'vbr' : 'no-sync'
  const fb = averageFrameBytes(head)
  const frameIndex = Math.max(0, Math.round((winOffset + s - head.audioStart) / fb))
  const want = Math.max(1, plan.n1 - frameIndex + 1)
  let e = s
  let frames = 0
  let hitEnd = false
  while (frames < want) {
    const h = parseFrameHeader(win, e)
    if (!h || h.sampleRate !== head.audio.sampleRate) {
      hitEnd = e + 4 > win.length
      break
    }
    if (h.bitrateKbps !== kbps) return 'vbr'
    if (e + h.frameBytes > win.length) {
      hitEnd = true
      break
    }
    e += h.frameBytes
    frames++
  }
  if (frames === 0) return 'no-sync'
  const info = head.infoFrame
  const bytes = new Uint8Array((info?.length ?? 0) + (e - s))
  if (info) bytes.set(info, 0)
  bytes.set(win.subarray(s, e), info?.length ?? 0)
  const { sampleRate: sr, samplesPerFrame: spf } = head.audio
  return {
    bytes,
    frameIndex,
    startMs: ((frameIndex * spf) / sr) * 1000,
    frames,
    firstFrameOffset: winOffset + s,
    hitEnd,
  }
}

function ascii(b: Uint8Array, o: number, n: number): string {
  let s = ''
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
}
