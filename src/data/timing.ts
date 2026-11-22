// Timing adapters: source payload → AyahAudio (core/types.ts). Ported from the reference adapters in
// research/scripts/audio-timing/cut-planner.ts (fromV4Segments / fromQdcVerseTiming / fromAyahWindow) with the
// corrections of research/audio-timing.md "Independent verification" (Number() for every id, offset 26 ms,
// muqatta'at index overflow #7, unsorted QDC verse_timings #8) and the class-B validation of research/00-gaps.md
// §2.6 / D8 (corrupt word labels → that verse at ayah level, never "repaired"). Pure functions: no fetch, never
// throw on bad data.
import type { AyahAudio, WordTime } from '../core/types'

// ───────────────────────── estimation helpers ─────────────────────────

const LETTERS = /[\u{0621}-\u{063A}\u{0641}-\u{064A}\u{0671}]/gu
const MADDAH = /\u{0653}/gu
const DAGGER_ALEF = /\u{0670}/gu
const SHADDA = /\u{0651}/gu
const PAUSE = /[\u{06D6}-\u{06DC}]/u

/**
 * Text weight of a word for spreading a time span over several words: letters + 2.5·maddah + 0.5·dagger alef +
 * 0.5·shadda + 3·pause sign (the segment before a pause absorbs it). Measured best of the weights tried
 * (audio-timing.md §9: median boundary error 598 ms).
 */
export function wordWeight(text: string): number {
  const count = (re: RegExp) => (text.match(re) ?? []).length
  const letters = count(LETTERS)
  return Math.max(letters, 1) + 2.5 * count(MADDAH) + 0.5 * count(DAGGER_ALEF) + 0.5 * count(SHADDA) + (PAUSE.test(text) ? 3 : 0)
}

/** Spreads [t0, t1] over consecutive words proportionally to their weights (all estimated). */
export function spread(t0: number, t1: number, words: { word: number; text: string }[]): WordTime[] {
  const ws = words.map((w) => wordWeight(w.text))
  const total = ws.reduce((a, b) => a + b, 0) || 1
  const out: WordTime[] = []
  let acc = 0
  words.forEach((w, i) => {
    const s = t0 + ((t1 - t0) * acc) / total
    acc += ws[i]
    const e = t0 + ((t1 - t0) * acc) / total
    out.push({ word: w.word, startMs: Math.round(s), endMs: Math.round(e), estimated: true })
  })
  return out
}

/** Median duration of measured words (fallback 600 ms) — sizes estimates for words at the edges. */
function typicalWordMs(timed: WordTime[]): number {
  const d = timed
    .filter((w) => !w.estimated && w.endMs > w.startMs)
    .map((w) => w.endMs - w.startMs)
    .sort((a, b) => a - b)
  return d.length ? Math.max(150, Math.min(2000, d[Math.floor(d.length / 2)])) : 600
}

/**
 * Fills words with no timing (estimated) between their timed neighbours. Words at the start/end without a
 * neighbour get typical-word-sized estimates, clamped to [winStart, winEnd] when the window is known.
 * Returns words in chronological order (repeats kept).
 */
export function fillMissing(timed: WordTime[], texts: string[], winStart: number, winEnd: number | null): WordTime[] {
  const n = texts.length
  const firstOcc = new Map<number, WordTime>()
  for (const w of timed) if (!firstOcc.has(w.word)) firstOcc.set(w.word, w)
  if (firstOcc.size === n) return [...timed].sort((a, b) => a.startMs - b.startMs || a.word - b.word)
  const typical = typicalWordMs(timed)
  const out: WordTime[] = [...timed]
  let w = 1
  while (w <= n) {
    if (firstOcc.has(w)) {
      w++
      continue
    }
    let z = w
    while (z + 1 <= n && !firstOcc.has(z + 1)) z++
    const prev = firstOcc.get(w - 1)
    const next = firstOcc.get(z + 1)
    const count = z - w + 1
    let t0: number
    let t1: number
    if (prev && next) {
      t0 = prev.endMs
      t1 = next.startMs
    } else if (next) {
      t1 = next.startMs
      t0 = Math.max(winStart, t1 - typical * count)
    } else if (prev) {
      t0 = prev.endMs
      t1 = winEnd != null ? Math.max(t0, Math.min(winEnd, t0 + typical * count)) : t0 + typical * count
    } else {
      t0 = winStart
      t1 = winEnd ?? winStart + typical * count
    }
    const run: { word: number; text: string }[] = []
    for (let k = w; k <= z; k++) run.push({ word: k, text: texts[k - 1] })
    out.push(...spread(t0, Math.max(t0, t1), run))
    w = z + 1
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.word - b.word)
}

/**
 * Words Quran.com stores as ONE word but quran-align and QDC timing split in two (verified: 37:130
 * «إِلْ يَاسِينَ»). Value = Quran.com position of that word.
 */
export const SPLIT_IN_TIMING: Readonly<Record<string, number>> = { '37:130': 3 }

function timingOf(words: WordTime[]): AyahAudio['timing'] {
  if (words.length === 0) return 'none'
  return words.some((w) => w.estimated) ? 'partly-estimated' : 'word'
}

const finite = (xs: number[]) => xs.every((x) => Number.isFinite(x))

/** A timing value as a number: numbers and numeric strings (several recitations send strings); anything else NaN. */
function num(x: unknown): number {
  if (typeof x === 'number') return x
  if (typeof x === 'string' && x.trim() !== '') return Number(x)
  return NaN
}

/**
 * Words with no measured time at all may be at most half of an ayah's words: beyond that the karaoke would be
 * mostly guesswork (text-weight estimates are off by a median 598 ms, audio-timing §9), so the ayah is
 * highlighted as a whole instead (00-gaps D4).
 */
const MAX_MISSING_SHARE = 0.5

// ───────────────────────── class A: Quran.com v4 per-ayah segments ─────────────────────────

export interface V4SegmentsInput {
  ayah: number
  verseKey: string
  /** per-ayah file (EveryAyah) */
  url: string
  /** raw `segments` of /recitations/{id}/by_chapter/{s}?fields=segments: [w0, w1Exclusive, startMs, endMs], numbers or strings */
  segments: unknown
  /** display text of each Quran.com word (with its pause mark), position = index + 1 */
  wordTexts: string[]
  /** add when the played file is another encode of the aligned one (26 ms; catalogue v4.offsetMs) */
  offsetMs?: number
}

/**
 * Class A adapter. Coerces every value with Number() (several recitations send strings), drops malformed
 * tuples, sorts by time, remaps the 37:130 split word, repairs the muqatta'at index jump (verification #7:
 * shift the indices after the first jump when that makes them fit the word count), spreads multi-word
 * segments by text weight and interpolates missing words (estimated: true). Indices that still do not fit
 * the words, more than half of the words untimed, or no segments at all → words [] and timing 'none' (the
 * ayah is played and highlighted whole: guessing the labels is not repairing them, 00-gaps D4/D8).
 */
export function fromV4Segments(a: V4SegmentsInput): AyahAudio {
  const n = a.wordTexts.length
  const off = a.offsetMs ?? 0
  const base: AyahAudio = {
    ayah: a.ayah,
    url: a.url,
    fileKind: 'per_ayah',
    bitrateKbps: null,
    windowStartMs: 0,
    windowEndMs: null,
    approximateWindow: false,
    words: [],
    wordCount: n,
    timing: 'none',
    perAyahUrl: null,
  }
  let segs = (Array.isArray(a.segments) ? a.segments : [])
    .filter((s): s is unknown[] => Array.isArray(s) && s.length === 4)
    .map((s) => s.map((x) => Math.round(num(x))))
    .filter((s) => finite(s) && s[0] >= 0 && s[1] > s[0] && s[3] >= s[2] && s[2] >= 0)
    .sort((x, y) => x[2] - y[2] || x[0] - y[0])
  if (segs.length === 0 || n === 0) return base
  let maxEnd = Math.max(...segs.map((s) => s[1]))
  const split = SPLIT_IN_TIMING[a.verseKey]
  /** segments that timed the second half of the split word on their own (merged into the first half below) */
  const secondHalves = new Set<number[]>()
  if (split && maxEnd === n + 1) {
    segs = segs.map(([w0, w1, t0, t1]) => {
      const m = [w0 >= split ? w0 - 1 : w0, w1 > split ? w1 - 1 : w1, t0, t1]
      if (w0 === split && w1 === split + 1) secondHalves.add(m)
      return m
    })
    maxEnd = n
  }
  if (maxEnd > n) {
    // muqatta'at followed by a pause sign: the aligner counted one more token → one index jump after the first segment(s)
    const k = segs.findIndex((s, i) => i > 0 && s[0] > segs[i - 1][1])
    if (k > 0 && k <= 3) {
      const shift = segs[k][0] - segs[k - 1][1]
      const shifted = segs.map((s, i) => (i >= k ? [s[0] - shift, s[1] - shift, s[2], s[3]] : s))
      if (Math.max(...shifted.map((s) => s[1])) === n && shifted.every((s) => s[0] >= 0)) {
        segs = shifted
        maxEnd = n
      }
    }
  }
  const texts = a.wordTexts
  if (maxEnd > n) return base // labels that cannot be mapped onto the words: ayah level
  let covered = 0
  for (let w = 1; w <= n; w++) if (segs.some((s) => s[0] < w && w <= s[1])) covered++
  if (n - covered > n * MAX_MISSING_SHARE) return base
  const timed: WordTime[] = []
  for (const seg of segs) {
    const [w0, w1, t0, t1] = seg
    if (w1 - w0 === 1) {
      const last = timed[timed.length - 1]
      // the two halves of a split word (37:130) are one word: extend instead of recording a repeat
      if (secondHalves.has(seg) && last && !last.estimated && last.word === w0 + 1) {
        last.endMs = Math.max(last.endMs, t1 + off)
        continue
      }
      timed.push({ word: w0 + 1, startMs: t0 + off, endMs: t1 + off, estimated: false })
    } else {
      const run: { word: number; text: string }[] = []
      for (let k = w0 + 1; k <= w1; k++) run.push({ word: k, text: texts[k - 1] })
      timed.push(...spread(t0 + off, t1 + off, run))
    }
  }
  const words = fillMissing(timed, texts, 0, null).map((w) => ({ ...w, startMs: Math.max(0, w.startMs), endMs: Math.max(0, w.endMs) }))
  return { ...base, words, timing: timingOf(words) }
}

// ───────────────────────── class B: QDC chapter verse timing ─────────────────────────

export interface QdcVerseTiming {
  verse_key: string
  timestamp_from: unknown
  timestamp_to: unknown
  segments?: unknown
}

export interface QdcInput {
  ayah: number
  /** chapter file (absolute https URL from audio_files[0].audio_url) */
  url: string
  bitrateKbps: number | null
  verseTiming: QdcVerseTiming
  wordTexts: string[]
  /** the reciter's own per-ayah file of this ayah (EveryAyah), the fallback when the chapter file cannot be windowed */
  perAyahUrl?: string | null
}

/** research/scripts/gaps/classb_scan.py statuses ('zero_length' verses are not in the file: no AyahAudio at all). */
export type QdcVerseStatus = 'ok' | 'ok_with_repeats' | 'missing_words' | 'invalid_order' | 'overflow' | 'no_segments'

/**
 * Validates one verse's segments ([wordPosition1, startMs, endMs], finite numbers) against its n words exactly as
 * research/scripts/gaps/classb_scan.py validate() does (00-gaps §2.6): a position beyond n → overflow; a position
 * below 1, starts running backwards, or first occurrences out of word order → invalid_order (corrupt labels:
 * Khalifa's 247 verses, e.g. 2:29 "…10, 18, 12…"); a word never timed → missing_words; otherwise ok, or
 * ok_with_repeats when the reciter repeated words. `missing` lists the untimed words of a missing_words verse.
 */
export function checkQdcSegments(segs: readonly (readonly number[])[], n: number): { status: QdcVerseStatus; missing: number[] } {
  if (segs.length === 0) return { status: 'no_segments', missing: [] }
  const pos = segs.map((s) => s[0])
  if (Math.max(...pos) > n) return { status: 'overflow', missing: [] }
  let ordered = pos.every((p) => p >= 1)
  for (let i = 1; ordered && i < segs.length; i++) if (segs[i][1] < segs[i - 1][1]) ordered = false
  const seen = new Set<number>()
  let lastFirst = 0
  for (const p of pos) {
    if (seen.has(p)) continue
    if (p < lastFirst) ordered = false
    seen.add(p)
    lastFirst = p
  }
  if (!ordered) return { status: 'invalid_order', missing: [] }
  const missing: number[] = []
  for (let w = 1; w <= n; w++) if (!seen.has(w)) missing.push(w)
  if (missing.length) return { status: 'missing_words', missing }
  return { status: seen.size < pos.length ? 'ok_with_repeats' : 'ok', missing: [] }
}

/**
 * Class B adapter: [wordPosition1, startMs, endMs] in chapter-file time. Keeps 3-tuples of finite numbers
 * (junk like [1] exists), rounds floats, remaps 37:130, then validates the verse (checkQdcSegments):
 * - ok / ok_with_repeats → measured words, reciter repetitions kept (a word may appear twice), the halves of the
 *   split word merged;
 * - missing_words → the missing words interpolated (estimated), unless more than half are missing;
 * - invalid_order / overflow / no segments / more than half missing → words [] and timing 'none': the verse is
 *   cut and highlighted as a whole ayah, its window still cuts the file (00-gaps §2.6, D4, D8).
 * Returns null when the verse is not in the file (timestamp_to <= timestamp_from).
 */
export function fromQdcVerseTiming(a: QdcInput): AyahAudio | null {
  const v = a.verseTiming
  const n = a.wordTexts.length
  const from = Math.round(num(v.timestamp_from))
  const to = Math.round(num(v.timestamp_to))
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from) || from < 0) return null
  const base: AyahAudio = {
    ayah: a.ayah,
    url: a.url,
    fileKind: 'chapter',
    bitrateKbps: a.bitrateKbps,
    windowStartMs: from,
    windowEndMs: to,
    approximateWindow: false,
    words: [],
    wordCount: n,
    timing: 'none',
    perAyahUrl: a.perAyahUrl ?? null,
  }
  if (n === 0) return base
  const split = SPLIT_IN_TIMING[v.verse_key]
  let segs = (Array.isArray(v.segments) ? v.segments : [])
    .filter((s): s is unknown[] => Array.isArray(s) && s.length === 3)
    .map((s) => s.map((x) => Math.round(num(x))))
    .filter((s) => finite(s))
  const secondHalves = new Set<number[]>()
  if (split && segs.some((s) => s[0] === n + 1)) {
    segs = segs.map(([w, t0, t1]) => {
      const m = [w > split ? w - 1 : w, t0, t1]
      if (w === split + 1) secondHalves.add(m)
      return m
    })
  }
  const check = checkQdcSegments(segs, n)
  const usable =
    check.status === 'ok' || check.status === 'ok_with_repeats' || (check.status === 'missing_words' && check.missing.length <= n * MAX_MISSING_SHARE)
  if (!usable) return base
  const timed: WordTime[] = []
  for (const seg of segs) {
    const [w] = seg
    const t0 = Math.max(0, seg[1])
    const t1 = Math.max(t0, seg[2])
    const last = timed[timed.length - 1]
    // the two halves of a split word (37:130) are one word: extend instead of recording a repeat
    if (secondHalves.has(seg) && last && last.word === w) {
      last.endMs = Math.max(last.endMs, t1)
      continue
    }
    timed.push({ word: w, startMs: t0, endMs: t1, estimated: false })
  }
  const words = fillMissing(timed, a.wordTexts, from, to)
  return { ...base, words, timing: timingOf(words) }
}

/** Indexes QDC verse_timings by verse_key — the array can be unsorted (verification #8, id 8 ch 36). */
export function indexQdcTimings(verseTimings: unknown): Map<string, QdcVerseTiming> {
  const map = new Map<string, QdcVerseTiming>()
  if (!Array.isArray(verseTimings)) return map
  for (const vt of verseTimings) {
    if (vt && typeof vt === 'object' && typeof (vt as QdcVerseTiming).verse_key === 'string') {
      const key = (vt as QdcVerseTiming).verse_key
      if (!map.has(key)) map.set(key, vt as QdcVerseTiming)
    }
  }
  return map
}

// ───────────────────────── classes C / D: ayah windows only ─────────────────────────

/** Class C: whole per-ayah file, no word timings (also the basmala / isti'adha files: ayah 0 / -1). */
export function perAyahWithoutWords(ayah: number, url: string, wordCount: number): AyahAudio {
  return {
    ayah,
    url,
    fileKind: 'per_ayah',
    bitrateKbps: null,
    windowStartMs: 0,
    windowEndMs: null,
    approximateWindow: false,
    words: [],
    wordCount,
    timing: 'none',
    perAyahUrl: null,
  }
}

export interface Mp3quranRow {
  ayah: number
  startMs: number
  endMs: number
}

/** Parses mp3quran /ayat_timing rows (ayah 0 = intro, kept out); drops malformed rows. */
export function parseMp3quranTiming(json: unknown): Map<number, Mp3quranRow> {
  const map = new Map<number, Mp3quranRow>()
  if (!Array.isArray(json)) return map
  for (const r of json) {
    if (!r || typeof r !== 'object') continue
    const row = r as { ayah?: unknown; start_time?: unknown; end_time?: unknown }
    const ayah = Math.round(num(row.ayah))
    const startMs = Math.round(num(row.start_time))
    const endMs = Math.round(num(row.end_time))
    if (!Number.isFinite(ayah) || ayah < 1 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs) || startMs < 0) continue
    if (!map.has(ayah)) map.set(ayah, { ayah, startMs, endMs })
  }
  return map
}

/**
 * Class D adapter: chapter file + approximate ayah window (mp3quran ayat_timing is typically 0.2–0.4 s off,
 * up to ~1.2 s, either direction — verification #12) → approximateWindow true, no words.
 */
export function fromAyahWindow(a: {
  ayah: number
  url: string
  bitrateKbps: number | null
  row: Mp3quranRow
  wordCount: number
  /** the reciter's own per-ayah file of this ayah (EveryAyah), when there is one */
  perAyahUrl?: string | null
}): AyahAudio {
  return {
    ayah: a.ayah,
    url: a.url,
    fileKind: 'chapter',
    bitrateKbps: a.bitrateKbps,
    windowStartMs: a.row.startMs,
    windowEndMs: a.row.endMs,
    approximateWindow: true,
    words: [],
    wordCount: a.wordCount,
    timing: 'none',
    perAyahUrl: a.perAyahUrl ?? null,
  }
}
