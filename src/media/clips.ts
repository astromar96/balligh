// Pure per-clip decisions once a source is decoded — where the clip really starts and ends, whether its
// word timings still hold — and the sample-exact cut + fade + concatenation. No I/O, no DOM.
import type { AudioClip } from '../core/types'
import { snapToPause, speechBounds, speechOnsetBefore, trimSilence, type EnvelopeWindow } from './envelope'

/** Output sample rate of every assembled AudioBuffer (preview and export use the same buffer). */
export const OUTPUT_RATE = 48000

/** finding A tolerance: timings may run this far past the decoded end before they count as stale */
export const STALE_TOLERANCE_MS = 300
/** reverb kept after the last speech when a stale clip falls back to the whole file */
export const FALLBACK_TAIL_MS = 350
/** every junction gets at least this much fade, so a cut never clicks */
export const MIN_FADE_MS = 2

export interface DecodedSpan {
  /** file time (ms) of decoded sample 0 */
  startMs: number
  /** decoded length (ms) */
  durationMs: number
  /** file-time range this decode may be used for (a Range window's warm-up excluded) */
  usableFromMs: number
  usableToMs: number
  /** the decoded audio ends where the file ends (whole file, or a window that reached EOF) */
  reachesFileEnd: boolean
}

export interface ResolvedClip {
  srcStartMs: number
  srcEndMs: number
  wordTimingsValid: boolean
  /** what changed, for logs and the test bench */
  notes: string[]
}

/**
 * Decides a clip's final source window: clamps it to the decoded audio, flags stale word timings
 * (finding A — a timing past the end of the file), trims the leading/trailing silence of a whole file
 * played without word timings (clip.trimSilence: keeps 80 ms, never cuts speech), snaps class-D edges
 * into pauses and extends a late first segment back to the speech onset (finding B).
 */
export function resolveClip(clip: AudioClip, span: DecodedSpan, env: () => EnvelopeWindow): ResolvedClip {
  const notes: string[] = []
  const fileEndMs = span.reachesFileEnd ? span.startMs + span.durationMs : null
  let start = clip.srcStartMs
  let end = clip.srcEndMs ?? span.startMs + span.durationMs
  let valid = true

  if (fileEndMs !== null) {
    const past = (ms: number) => ms > fileEndMs + STALE_TOLERANCE_MS
    const stale =
      clip.words.some((w) => past(w.endMs) || w.startMs >= fileEndMs) ||
      clip.ayahs.some((a) => a.startMs >= fileEndMs || (a.endMs !== null && past(a.endMs))) ||
      start >= fileEndMs ||
      (clip.srcEndMs !== null && past(clip.srcEndMs))
    if (stale) {
      valid = false
      notes.push(`stale timings: the file ends at ${Math.round(fileEndMs)} ms`)
    }
    if (start >= fileEndMs - 50) {
      // Nothing of the planned window exists: play the file's speech (it holds the selected words).
      const sb = speechBounds(env())
      start = sb ? sb.startMs - 50 : span.usableFromMs
      end = sb ? sb.endMs + FALLBACK_TAIL_MS : fileEndMs
      notes.push('window past the file end: fell back to the whole recitation in the file')
    }
    if (end > fileEndMs) end = fileEndMs
  }

  if (clip.trimSilence) {
    const t = trimSilence(env(), Math.max(start, span.usableFromMs), Math.min(end, span.usableToMs))
    if (t) {
      notes.push(`silence trimmed: ${Math.round(start)}–${Math.round(end)} → ${Math.round(t.startMs)}–${Math.round(t.endMs)} ms`)
      start = t.startMs
      end = t.endMs
    }
  }

  if (clip.snapToPause) {
    const e = env()
    const s2 = snapToPause(e, start, 'start')
    const e2 = clip.srcEndMs === null ? end : snapToPause(e, end, 'end')
    if (e2 - s2 >= 100) {
      if (s2 !== start) notes.push(`start snapped ${Math.round(start)} → ${Math.round(s2)} ms`)
      if (e2 !== end) notes.push(`end snapped ${Math.round(end)} → ${Math.round(e2)} ms`)
      start = s2
      end = e2
    } else {
      notes.push('pause snapping skipped: it would empty the clip')
    }
  }

  if (clip.extendToSpeechOnset) {
    const firstWordMs = clip.words.length ? clip.words[0].startMs : clip.srcStartMs
    // A per-ayah file holds only this ayah: search from its start. In a chapter file never reach into the
    // previous ayah: stay inside this ayah's window (and the decoded margin).
    const firstAyah = clip.ayahs[0]
    const searchFrom = clip.fileKind === 'per_ayah' ? 0 : firstAyah ? firstAyah.startMs : start
    const onset = searchFrom < firstWordMs ? speechOnsetBefore(env(), firstWordMs, searchFrom) : null
    if (onset !== null && onset < start) {
      notes.push(`start extended ${Math.round(start)} → ${Math.round(onset)} ms (speech before the first segment)`)
      start = onset
    }
  }

  start = Math.max(start, span.usableFromMs)
  end = Math.min(end, span.usableToMs)
  if (end < start) end = start
  return { srcStartMs: start, srcEndMs: end, wordTimingsValid: valid, notes }
}

/** Sample range of a resolved window inside a decoded span, at OUTPUT_RATE. */
export function clipSamples(span: DecodedSpan, startMs: number, endMs: number, rate = OUTPUT_RATE): { offset: number; length: number } {
  const perMs = rate / 1000
  const total = Math.round(span.durationMs * perMs)
  const offset = Math.min(total, Math.max(0, Math.round((startMs - span.startMs) * perMs)))
  const stop = Math.min(total, Math.max(offset, Math.round((endMs - span.startMs) * perMs)))
  return { offset, length: stop - offset }
}

/** Linear fade gain for sample i of a clip of `length` samples (0 at both outer edges when faded). */
export function fadeGain(i: number, length: number, fadeIn: number, fadeOut: number): number {
  let g = 1
  if (fadeIn > 0 && i < fadeIn) g = i / fadeIn
  const fromEnd = length - 1 - i
  if (fadeOut > 0 && fromEnd < fadeOut) g *= fromEnd / fadeOut
  return g
}

/**
 * Copies src[srcOffset, srcOffset + length) to dst at dstOffset with linear fades (in samples; each
 * capped at half the clip). Returns dstOffset + length.
 */
export function copyWithFades(
  dst: Float32Array,
  dstOffset: number,
  src: Float32Array,
  srcOffset: number,
  length: number,
  fadeIn: number,
  fadeOut: number,
): number {
  const fi = Math.min(Math.max(0, Math.round(fadeIn)), Math.floor(length / 2))
  const fo = Math.min(Math.max(0, Math.round(fadeOut)), Math.floor(length / 2))
  const n = Math.max(0, Math.min(length, src.length - srcOffset, dst.length - dstOffset))
  dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset)
  for (let i = 0; i < fi && i < n; i++) dst[dstOffset + i] *= fadeGain(i, length, fi, 0)
  for (let i = Math.max(0, length - fo); i < n; i++) dst[dstOffset + i] *= fadeGain(i, length, 0, fo)
  return dstOffset + length
}

export interface MixPiece {
  /** decoded channels (1 = mono, up-mixed to both outputs; 2 = stereo) */
  channels: readonly Float32Array[]
  offset: number
  length: number
  fadeIn: number
  fadeOut: number
}

/** Concatenates the pieces into `out` (stereo) in order; returns the number of samples written. */
export function mixPieces(out: readonly Float32Array[], pieces: readonly MixPiece[]): number {
  let at = 0
  for (const p of pieces) {
    for (let c = 0; c < out.length; c++) {
      const src = p.channels[Math.min(c, p.channels.length - 1)]
      copyWithFades(out[c], at, src, p.offset, p.length, p.fadeIn, p.fadeOut)
    }
    at += p.length
  }
  return at
}
