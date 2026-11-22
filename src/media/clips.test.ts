import type { AudioClip } from '../core/types'
import { clipSamples, copyWithFades, fadeGain, mixPieces, resolveClip, type DecodedSpan } from './clips'
import { HOP_MS, type EnvelopeWindow } from './envelope'

function clip(over: Partial<AudioClip>): AudioClip {
  return {
    ayah: 1,
    ayahTo: 1,
    url: 'https://example.test/a.mp3',
    fileKind: 'per_ayah',
    bitrateKbps: null,
    srcStartMs: 0,
    srcEndMs: null,
    fadeInMs: 20,
    fadeOutMs: 60,
    snapToPause: false,
    extendToSpeechOnset: false,
    trimSilence: false,
    words: [],
    ayahs: [{ ayah: 1, startMs: 0, endMs: null }],
    ...over,
  }
}

const wholeFile = (durationMs: number): DecodedSpan => ({ startMs: 0, durationMs, usableFromMs: 0, usableToMs: durationMs, reachesFileEnd: true })

function env(totalMs: number, quiet: [number, number][], startMs = 0): EnvelopeWindow {
  const levels = new Float32Array(Math.round(totalMs / HOP_MS)).fill(-12)
  for (const [a, b] of quiet) for (let f = Math.round((a - startMs) / HOP_MS); f < Math.round((b - startMs) / HOP_MS); f++) levels[f] = -80
  return { levels, startMs, usableFromMs: startMs, usableToMs: startMs + totalMs }
}

describe('fades on Float32Arrays', () => {
  it('ramps linearly in and out, 0 at both edges', () => {
    expect(fadeGain(0, 100, 10, 20)).toBe(0)
    expect(fadeGain(5, 100, 10, 20)).toBe(0.5)
    expect(fadeGain(10, 100, 10, 20)).toBe(1)
    expect(fadeGain(99, 100, 10, 20)).toBe(0)
    expect(fadeGain(89, 100, 10, 20)).toBe(0.5)
    expect(fadeGain(50, 100, 0, 0)).toBe(1)
  })

  it('copies a cut with fades and leaves the rest of the destination alone', () => {
    const src = new Float32Array(1000).fill(1)
    const dst = new Float32Array(300).fill(7)
    const end = copyWithFades(dst, 100, src, 400, 100, 10, 20)
    expect(end).toBe(200)
    expect(dst[99]).toBe(7)
    expect(dst[100]).toBe(0)
    expect(dst[105]).toBe(0.5)
    expect(dst[150]).toBe(1)
    expect(dst[189]).toBe(0.5)
    expect(dst[199]).toBe(0)
    expect(dst[200]).toBe(7)
  })

  it('caps each fade at half the clip and stays exact for a ramp source', () => {
    const src = Float32Array.from({ length: 50 }, (_, i) => i)
    const dst = new Float32Array(10)
    copyWithFades(dst, 0, src, 20, 10, 100, 100)
    expect(Array.from(dst)).toEqual([0, 21 * 0.2, 22 * 0.4, 23 * 0.6, 24 * 0.8, 25 * 0.8, 26 * 0.6, 27 * 0.4, 28 * 0.2, 0].map((v) => Math.fround(v)))
  })

  it('concatenates pieces in order and up-mixes mono to both channels', () => {
    const mono = [new Float32Array(100).fill(0.5)]
    const stereo = [new Float32Array(100).fill(0.25), new Float32Array(100).fill(-0.25)]
    const out = [new Float32Array(130), new Float32Array(130)]
    const n = mixPieces(out, [
      { channels: mono, offset: 10, length: 80, fadeIn: 0, fadeOut: 0 },
      { channels: stereo, offset: 0, length: 50, fadeIn: 0, fadeOut: 0 },
    ])
    expect(n).toBe(130)
    expect(out[0][0]).toBe(0.5)
    expect(out[1][79]).toBe(0.5)
    expect(out[0][80]).toBe(0.25)
    expect(out[1][129]).toBe(-0.25)
  })
})

describe('clip windows in samples', () => {
  it('converts file ms to 48 kHz sample offsets inside the decoded span', () => {
    const span: DecodedSpan = { startMs: 999_967.3469, durationMs: 10_000, usableFromMs: 1_000_067, usableToMs: 1_009_907, reachesFileEnd: false }
    const { offset, length } = clipSamples(span, 1_000_500, 1_005_500)
    expect(offset).toBe(Math.round((1_000_500 - 999_967.3469) * 48))
    expect(length).toBe(240_000)
  })

  it('clamps to the decoded audio', () => {
    expect(clipSamples(wholeFile(1000), -50, 2000)).toEqual({ offset: 0, length: 48_000 })
    expect(clipSamples(wholeFile(1000), 900, 800)).toEqual({ offset: 43_200, length: 0 })
  })
})

describe('resolveClip', () => {
  it('keeps a valid class A cut as planned', () => {
    const c = clip({ srcStartMs: 1050, srcEndMs: 4580, words: [{ ayah: 255, word: 3, startMs: 1170, endMs: 3530 }] })
    const r = resolveClip(c, wholeFile(51_918), () => env(51_918, []))
    expect(r).toMatchObject({ srcStartMs: 1050, srcEndMs: 4580, wordTimingsValid: true })
  })

  it('finding A: segments past the end of a replaced file → timings invalid, window falls back to the speech', () => {
    // Alafasy 37:152: segments run to 19 320 ms, the served file is 6.77 s; the planner asked for [12600, 6766].
    const c = clip({
      srcStartMs: 12_600,
      srcEndMs: 6766,
      words: [
        { ayah: 152, word: 1, startMs: 12_720, endMs: 13_640 },
        { ayah: 152, word: 4, startMs: 16_330, endMs: 19_320 },
      ],
    })
    const r = resolveClip(c, wholeFile(6766), () => env(6766, [[0, 400], [6200, 6766]]))
    expect(r.wordTimingsValid).toBe(false)
    expect(r.srcStartMs).toBe(350)
    expect(r.srcEndMs).toBe(6550)
  })

  it('finding A: a window that only runs past the end is clamped and flagged', () => {
    const c = clip({ srcStartMs: 100, srcEndMs: 9000, words: [{ ayah: 1, word: 1, startMs: 100, endMs: 8800 }] })
    const r = resolveClip(c, wholeFile(6000), () => env(6000, []))
    expect(r).toMatchObject({ srcStartMs: 100, srcEndMs: 6000, wordTimingsValid: false })
  })

  it('tolerates timings up to 300 ms past the end', () => {
    const c = clip({ srcStartMs: 100, srcEndMs: 6200, words: [{ ayah: 1, word: 1, startMs: 100, endMs: 6250 }] })
    expect(resolveClip(c, wholeFile(6000), () => env(6000, [])).wordTimingsValid).toBe(true)
  })

  it('snaps both edges of a class D clip into the surrounding pauses', () => {
    const span: DecodedSpan = { startMs: 3000, durationMs: 9000, usableFromMs: 3100, usableToMs: 11_940, reachesFileEnd: false }
    const c = clip({ fileKind: 'chapter', bitrateKbps: 96, srcStartMs: 6111, srcEndMs: 8708, snapToPause: true, ayahs: [{ ayah: 1, startMs: 6111, endMs: null }] })
    const r = resolveClip(c, span, () => env(9000, [[5300, 5800], [8900, 9300]], 3000))
    expect(r.srcStartMs).toBe(5650)
    expect(r.srcEndMs).toBe(9100)
    expect(r.wordTimingsValid).toBe(true)
  })

  it('finding B: extends a late first segment of a per-ayah file back to the speech onset', () => {
    const c = clip({ srcStartMs: 3810, srcEndMs: null, extendToSpeechOnset: true, words: [{ ayah: 1, word: 1, startMs: 3930, endMs: 5100 }] })
    const r = resolveClip(c, wholeFile(6870), () => env(6870, [[0, 120]]))
    expect(r.srcStartMs).toBe(70)
    expect(r.srcEndMs).toBe(6870)
  })

  it('finding B: keeps the segment start when a long pause marks a repetition', () => {
    const c = clip({ srcStartMs: 36_180, srcEndMs: null, extendToSpeechOnset: true, words: [{ ayah: 3, word: 1, startMs: 36_300, endMs: 37_000 }] })
    const r = resolveClip(c, wholeFile(41_200), () => env(41_200, [[0, 100], [24_000, 25_500], [35_000, 36_200]]))
    expect(r.srcStartMs).toBe(36_180)
  })

  it('finding B in a chapter file never reaches before the ayah window', () => {
    const span: DecodedSpan = { startMs: 7000, durationMs: 8000, usableFromMs: 7100, usableToMs: 14_940, reachesFileEnd: false }
    const c = clip({
      fileKind: 'chapter',
      srcStartMs: 10_400,
      srcEndMs: 13_000,
      extendToSpeechOnset: true,
      words: [{ ayah: 2, word: 1, startMs: 10_400, endMs: 11_000 }],
      ayahs: [{ ayah: 2, startMs: 9600, endMs: null }],
    })
    const r = resolveClip(c, span, () => env(8000, [], 7000))
    expect(r.srcStartMs).toBe(9600)
  })

  it('clamps to the usable part of a Range window (warm-up excluded)', () => {
    const span: DecodedSpan = { startMs: 1000, durationMs: 3000, usableFromMs: 1100, usableToMs: 3940, reachesFileEnd: false }
    const r = resolveClip(clip({ fileKind: 'chapter', srcStartMs: 1050, srcEndMs: 3990 }), span, () => env(3000, [], 1000))
    expect(r).toMatchObject({ srcStartMs: 1100, srcEndMs: 3940 })
  })
})

describe('resolveClip: trimSilence (whole per-ayah files without word timings)', () => {
  // Husary Mujawwad 1:1 shape: 1.2 s of quiet before the voice, 0.9 s after it
  const quietEnds = () => env(5000, [[0, 1200], [4100, 5000]])

  it('trims the leading and trailing silence of a whole file, keeping 80 ms of it', () => {
    const r = resolveClip(clip({ trimSilence: true, fadeInMs: 8 }), wholeFile(5000), quietEnds)
    expect(r).toMatchObject({ srcStartMs: 1120, srcEndMs: 4180, wordTimingsValid: true })
    expect(r.notes.join()).toMatch(/silence trimmed/)
  })

  it('leaves the window alone when trimSilence is false (word timings place the cut)', () => {
    const r = resolveClip(clip({ trimSilence: false }), wholeFile(5000), quietEnds)
    expect(r).toMatchObject({ srcStartMs: 0, srcEndMs: 5000 })
  })

  it('only ever shrinks the planned window and keeps a file that is all quiet as it is', () => {
    const r = resolveClip(clip({ trimSilence: true, srcStartMs: 1500, srcEndMs: 3000 }), wholeFile(5000), quietEnds)
    expect(r).toMatchObject({ srcStartMs: 1500, srcEndMs: 3000 })
    const silent = resolveClip(clip({ trimSilence: true }), wholeFile(3000), () => env(3000, [[0, 3000]]))
    expect(silent).toMatchObject({ srcStartMs: 0, srcEndMs: 3000 })
  })

  it('works on the isti\'adha clip (ayah -1) like on any whole file', () => {
    const r = resolveClip(clip({ ayah: -1, ayahTo: -1, trimSilence: true, ayahs: [{ ayah: -1, startMs: 0, endMs: null }] }), wholeFile(5000), quietEnds)
    expect(r).toMatchObject({ srcStartMs: 1120, srcEndMs: 4180 })
  })
})
