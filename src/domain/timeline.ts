// Output-time schedule of the assembled audio: shifts each clip's FILE-time word/ayah windows by what the
// decoder really produced (ClipResult: source start after pause-snapping / onset extension, real duration).
import type { AudioClip, AudioPlan, ClipResult, Timeline, TimedAyah, TimedWord } from '../core/types'

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Ayah boundaries split at each later ayah's start, shifted into [t0, t1]; contiguous and non-decreasing. */
function shiftedBounds(list: AudioClip['ayahs'], toOut: (ms: number) => number, t0: number, t1: number): number[] {
  const bounds = [t0]
  for (let k = 1; k < list.length; k++) {
    const b = finite(list[k].startMs) ? toOut(list[k].startMs) : bounds[k - 1]
    bounds.push(Math.max(bounds[k - 1], b))
  }
  bounds.push(t1)
  return bounds
}

/**
 * When the decoded file contradicts the clip's timings, its ayah boundaries (derived from them) cannot be
 * shifted either: share the real duration in proportion to the planned ayah lengths (equal shares if those
 * are unusable).
 */
function proportionalBounds(clip: AudioClip, list: AudioClip['ayahs'], t0: number, t1: number): number[] {
  const ends = list.map((_, k) => (k + 1 < list.length ? list[k + 1].startMs : (clip.srcEndMs ?? NaN)))
  // the first entry may start at its ayah's window start, before the clip: only the part inside the clip counts
  let lens = list.map((a, k) => ends[k] - (k === 0 ? Math.max(a.startMs, clip.srcStartMs) : a.startMs))
  if (!lens.every((l) => finite(l) && l > 0)) lens = list.map(() => 1)
  const total = lens.reduce((x, y) => x + y, 0)
  const bounds = [t0]
  let acc = 0
  for (let k = 0; k < list.length - 1; k++) {
    acc += lens[k]
    bounds.push(t0 + ((t1 - t0) * acc) / total)
  }
  bounds.push(t1)
  return bounds
}

export function buildTimeline(plan: AudioPlan, results: ClipResult[]): Timeline {
  const words: TimedWord[] = []
  const ayahs: TimedAyah[] = []
  const clips = Array.isArray(plan?.clips) ? plan.clips : []
  let offset = 0
  clips.forEach((clip, i) => {
    const r: ClipResult | undefined = Array.isArray(results) ? results[i] : undefined
    const srcStart = r && finite(r.srcStartMs) ? r.srcStartMs : clip.srcStartMs
    const planned = finite(clip.srcEndMs) ? Math.max(0, clip.srcEndMs - clip.srcStartMs) : 0
    const duration = r && finite(r.durationMs) ? Math.max(0, r.durationMs) : planned
    const valid = r ? r.wordTimingsValid !== false : true
    const t0 = offset
    const t1 = offset + duration
    offset = t1
    if (!(duration > 0)) return
    const toOut = (ms: number) => clamp(t0 + (ms - srcStart), t0, t1)

    const list = Array.isArray(clip.ayahs) && clip.ayahs.length ? clip.ayahs : [{ ayah: clip.ayah, startMs: clip.srcStartMs, endMs: null }]
    const bounds = valid || list.length === 1 ? shiftedBounds(list, toOut, t0, t1) : proportionalBounds(clip, list, t0, t1)
    list.forEach((a, k) => {
      if (bounds[k + 1] > bounds[k]) ayahs.push({ ayah: a.ayah, startMs: bounds[k], endMs: bounds[k + 1] })
    })

    if (!valid) return // stale/contradicted timings: highlight per ayah for this clip
    const extended = clip.extendToSpeechOnset && srcStart < clip.srcStartMs
    const clipWords = Array.isArray(clip.words) ? clip.words : []
    clipWords.forEach((w, j) => {
      if (!w || !finite(w.startMs) || !finite(w.endMs)) return
      // the speech the decoder found before the first segment belongs to that first word (finding B)
      const s = j === 0 && extended ? t0 : toOut(w.startMs)
      const e = toOut(w.endMs)
      if (e > s) words.push({ ayah: w.ayah, word: w.word, startMs: s, endMs: e })
    })
  })

  // monotonic, no overlaps: an overlapping earlier word ends where the next one starts (onsets stay exact)
  words.sort((x, y) => x.startMs - y.startMs || x.endMs - y.endMs)
  const outWords: TimedWord[] = []
  for (const w of words) {
    const prev = outWords[outWords.length - 1]
    if (prev && prev.endMs > w.startMs) {
      prev.endMs = w.startMs
      if (prev.endMs <= prev.startMs) outWords.pop()
    }
    outWords.push(w)
  }
  // ayah spans are contiguous per clip and clips follow each other; join touching spans of the same ayah
  const outAyahs: TimedAyah[] = []
  for (const a of ayahs) {
    const prev = outAyahs[outAyahs.length - 1]
    if (prev && prev.ayah === a.ayah && prev.endMs >= a.startMs) prev.endMs = Math.max(prev.endMs, a.endMs)
    else outAyahs.push(a)
  }
  return { durationMs: offset, ayahs: outAyahs, words: outWords }
}
