// Audio cut planner — research/audio-timing.md §8 "Planner", ported from the reference
// research/scripts/audio-timing/cut-planner.ts (planCuts + locate; its real-payload tests are re-run in
// audio-plan.test.ts) and adapted to the contract: AudioClip windows in FILE time, class C/D widening, and
// the Independent-verification findings A (stale timings past the file end) and B (speech before the first
// segment → extendToSpeechOnset). Pure: no I/O, never throws on imperfect timing data.
import type { AudioClip, AudioPlan, Ayah, AyahAudio, Reciter, Selection, WordRef } from '../core/types'
import type { PlanOptions } from './index'
import { indexAyahs, lastPosition, normalizeSelection } from './selection'

export const DEFAULT_LEAD_PAD_MS = 120
export const DEFAULT_TAIL_PAD_MS = 350
/** A previous word that ends within this of the next start is adjacent (segments sit 10 ms apart): no lead pad. */
const ADJACENT_GAP_MS = 80
/** A cut that stops inside an ayah ends this long before the next word starts, so it never plays it. */
const NEXT_WORD_GUARD_MS = 5
/** Consecutive cuts of one chapter file closer than this are played as one clip (keeps the natural pause). */
const MERGE_GAP_MS = 4000
/** QDC word 1 often starts a little before its verse window (1:2 −65 ms, Yasser 1:1 −100 ms). */
const WINDOW_SKEW_MS = 250
/** Finding A: a word ending this far past a known window end (or starting at/after it) means stale timings. */
const STALE_OVERRUN_MS = 300
const FADE_IN_ADJACENT_MS = 8
const FADE_IN_AFTER_PAUSE_MS = 20
const FADE_OUT_MID_AYAH_MS = 25
const FADE_OUT_AYAH_END_MS = 60

interface WordSpan {
  word: number
  startMs: number
  endMs: number
  estimated: boolean
}

interface Window {
  start: number
  /** null = unknown / to the end of a per-ayah file */
  end: number | null
}

/** One ayah's (or the basmala's) cut, before consecutive chapter cuts are merged. */
interface Part {
  ayah: number
  url: string
  fileKind: AudioClip['fileKind']
  bitrateKbps: number | null
  startMs: number
  endMs: number | null
  /**
   * start of the clip's first `ayahs` entry: the cut start, or the ayah's window start when the cut opens the
   * ayah at word 1 and the window starts earlier — the media searches back to it for speech before a late
   * first segment (finding B) and never past it into the previous ayah
   */
  ayahStartMs: number
  fadeInMs: number
  fadeOutMs: number
  snapToPause: boolean
  extendToSpeechOnset: boolean
  /** a whole per-ayah file without word timings: the media trims its leading/trailing silence */
  trimSilence: boolean
  words: AudioClip['words']
  /** a boundary word is estimated or the window is approximate */
  inexact: boolean
  /** the selected words this part really plays (a word missing from the timings narrows them) */
  firstWord: number
  lastWord: number
}

const toNumber = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN)
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const nonNegative = (v: unknown, fallback: number) => {
  const n = toNumber(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** The ayah's window in file time; null when a chapter window is empty (the ayah is not in that file, e.g. QDC 173 1:1). */
function windowOf(a: AyahAudio): Window | null {
  const s = toNumber(a.windowStartMs)
  const start = Number.isFinite(s) && s > 0 ? s : 0
  const e = a.windowEndMs == null ? NaN : toNumber(a.windowEndMs)
  if (!Number.isFinite(e)) return { start, end: null }
  if (e > start) return { start, end: e }
  return a.fileKind === 'chapter' ? null : { start, end: null }
}

/**
 * Valid word windows in chronological order, clamped into the ayah window (with the QDC skew allowance).
 * `stale` = a word lies outside the window beyond any tolerance: the timings belong to another file (finding A)
 * or another verse, so none of them can be trusted.
 */
function sanitizeWords(a: AyahAudio, count: number, win: Window): { words: WordSpan[]; stale: boolean } {
  const lo = Math.max(0, win.start - WINDOW_SKEW_MS)
  const out: (WordSpan & { i: number })[] = []
  let stale = false
  const list = Array.isArray(a.words) ? a.words : []
  list.forEach((w, i) => {
    if (!w) return
    const word = toNumber(w.word)
    const s = toNumber(w.startMs)
    const e0 = toNumber(w.endMs)
    if (!Number.isInteger(word) || word < 1 || word > count || !Number.isFinite(s) || !Number.isFinite(e0)) return
    const e = Math.max(s, e0)
    if (win.end !== null && (s >= win.end || e > win.end + STALE_OVERRUN_MS)) stale = true
    if (e < lo) stale = true
    const startMs = Math.max(lo, s)
    const endMs = Math.max(startMs, win.end === null ? e : Math.min(e, win.end))
    out.push({ word, startMs, endMs, estimated: w.estimated === true, i })
  })
  out.sort((x, y) => x.startMs - y.startMs || x.i - y.i)
  return { words: out.map(({ word, startMs, endMs, estimated }) => ({ word, startMs, endMs, estimated })), stale }
}

/** Word timings good enough to cut inside this ayah: present, trusted, and not all estimated. */
function cuttable(a: AyahAudio, reciter: Reciter | null | undefined, ws: WordSpan[], stale: boolean): boolean {
  if (stale || a.timing === 'none' || reciter?.wordTimings === false) return false
  return ws.some((w) => !w.estimated)
}

/**
 * Chronological index range [iS, iE] covering firstWord..lastWord, robust to reciter repetitions:
 * E = FIRST occurrence of the last word; S = LAST occurrence of the first word at or before E — one clean
 * pass even when the reciter went back and repeated part of the ayah. When the range would contain words
 * outside [first, last], S falls back to the first occurrence. Missing words degrade to the nearest present
 * selected word; null when no selected word is timed at all.
 */
export function locateWords(ws: readonly { word: number }[], firstWord: number, lastWord: number): { iS: number; iE: number } | null {
  const inRange = (w: { word: number }) => w.word >= firstWord && w.word <= lastWord
  let endWord = -1
  for (const w of ws) if (inRange(w) && w.word > endWord) endWord = w.word
  if (endWord < 0) return null
  const iE = ws.findIndex((w) => w.word === endWord)
  let startWord = Infinity
  for (let i = 0; i <= iE; i++) if (inRange(ws[i]) && ws[i].word < startWord) startWord = ws[i].word
  let iS = iE
  for (let i = iE; i >= 0; i--) {
    if (ws[i].word === startWord) {
      iS = i
      break
    }
  }
  for (let i = iS; i <= iE; i++) {
    if (!inRange(ws[i])) {
      const f = ws.findIndex((w) => w.word === startWord)
      if (f >= 0 && f <= iE) iS = f
      break
    }
  }
  return { iS, iE }
}

/** §8 per-ayah cut by word timings (lead pad, tail pad, fade table, never the previous/next word). */
function cutByWords(a: AyahAudio, ayah: number, fw: number, lw: number, ws: WordSpan[], win: Window, lead: number, tail: number): Part | null {
  const loc = locateWords(ws, fw, lw)
  if (!loc) return null
  const { iS, iE } = loc
  const first = ws[iS]
  const last = ws[iE]
  const prevEnd = iS > 0 ? ws[iS - 1].endMs : win.start
  const gapBefore = first.startMs - prevEnd
  let startMs = gapBefore > ADJACENT_GAP_MS ? Math.max(prevEnd, first.startMs - lead) : first.startMs
  const next = iE + 1 < ws.length ? ws[iE + 1] : null
  // inside the ayah the segment end already holds the pause; at the ayah end keep the reverb tail (bounded by the window)
  let endMs = next ? Math.min(last.endMs, next.startMs - NEXT_WORD_GUARD_MS) : Math.min(win.end ?? Infinity, last.endMs + tail)
  startMs = Math.max(0, win.start - WINDOW_SKEW_MS, startMs)
  if (!(endMs > startMs)) endMs = Math.max(last.endMs, first.endMs) // overlapping timings: keep at least the words
  if (!(endMs > startMs)) return null
  const words = ws
    .slice(iS, iE + 1)
    .map((w) => ({ ayah, word: w.word, startMs: Math.max(w.startMs, startMs), endMs: Math.min(w.endMs, endMs) }))
    .filter((w) => w.endMs > w.startMs)
  // finding B: the cut opens the ayah at word 1 from a word timing, so speech may precede that first segment.
  // The media looks for it after decoding: a per-ayah file from 0, a chapter file from this ayah's window start.
  const opensAyah = iS === 0 && first.word === 1
  return {
    ayah,
    url: a.url,
    fileKind: a.fileKind,
    bitrateKbps: a.bitrateKbps ?? null,
    startMs,
    endMs,
    ayahStartMs: opensAyah ? Math.max(0, Math.min(startMs, win.start)) : startMs,
    fadeInMs: gapBefore > ADJACENT_GAP_MS ? FADE_IN_AFTER_PAUSE_MS : FADE_IN_ADJACENT_MS,
    fadeOutMs: next ? FADE_OUT_MID_AYAH_MS : FADE_OUT_AYAH_END_MS,
    snapToPause: a.approximateWindow === true,
    extendToSpeechOnset: opensAyah,
    trimSilence: false, // the word timings place the cut
    words,
    inexact: first.estimated || last.estimated || a.approximateWindow === true,
    firstWord: Math.min(first.word, last.word),
    lastWord: Math.max(first.word, last.word),
  }
}

/**
 * The whole ayah window (no usable word timings). A chapter window with an unknown end is not playable.
 * A per-ayah file is played whole, so the media trims its silence (trimSilence); a chapter window is not.
 */
function cutWhole(a: AyahAudio, ayah: number, count: number, win: Window, nextStart: number | null): Part | null {
  let end = win.end
  if (a.fileKind === 'chapter' && end === null) {
    // never "to the end of a chapter file" (up to 250 MB): stop where the next ayah starts, if known
    end = nextStart !== null && nextStart > win.start ? nextStart : null
    if (end === null) return null
  }
  return {
    ayah,
    url: a.url,
    fileKind: a.fileKind,
    bitrateKbps: a.bitrateKbps ?? null,
    startMs: win.start,
    endMs: end,
    ayahStartMs: win.start,
    fadeInMs: a.fileKind === 'per_ayah' ? FADE_IN_ADJACENT_MS : FADE_IN_AFTER_PAUSE_MS,
    fadeOutMs: FADE_OUT_AYAH_END_MS,
    snapToPause: a.approximateWindow === true,
    extendToSpeechOnset: false,
    trimSilence: a.fileKind === 'per_ayah',
    words: [],
    inexact: a.approximateWindow === true,
    firstWord: 1,
    lastWord: count,
  }
}

/** The basmala (ayah 0) or isti'adha (ayah -1) clip: cut by its word timings when usable, else played whole. */
function cutPreamble(a: AyahAudio, ayah: 0 | -1, defaultCount: number, reciter: Reciter, lead: number, tail: number): Part | null {
  const win = windowOf(a)
  if (!win) return null
  const c = toNumber(a.wordCount)
  const count = Number.isInteger(c) && c > 0 ? c : defaultCount
  const { words, stale } = sanitizeWords(a, count, win)
  return (cuttable(a, reciter, words, stale) ? cutByWords(a, ayah, 1, count, words, win, lead, tail) : null) ?? cutWhole(a, ayah, count, win, null)
}

function canMerge(prev: AudioClip, p: Part): boolean {
  return (
    prev.ayah > 0 &&
    p.ayah > 0 &&
    prev.fileKind === 'chapter' &&
    p.fileKind === 'chapter' &&
    prev.url === p.url &&
    prev.srcEndMs !== null &&
    p.endMs !== null &&
    p.startMs > prev.srcStartMs &&
    p.startMs - prev.srcEndMs < MERGE_GAP_MS
  )
}

export function planAudio(sel: Selection, ayahs: Ayah[], audio: AyahAudio[], reciter: Reciter, opts: PlanOptions): AudioPlan {
  const lead = nonNegative(opts?.leadPadMs, DEFAULT_LEAD_PAD_MS)
  const tail = nonNegative(opts?.tailPadMs, DEFAULT_TAIL_PAD_MS)
  const s = normalizeSelection(sel)
  const surah = s.surah
  const texts = indexAyahs(ayahs, surah)
  // ayah ≥ 1: the recitation; -1: the isti'adha source; 0 (a basmala source) is never planned from this list
  const audios = new Map<number, AyahAudio>()
  for (const a of Array.isArray(audio) ? audio : []) if (a && Number.isInteger(a.ayah) && !audios.has(a.ayah)) audios.set(a.ayah, a)

  const wordCountOf = (n: number, a: AyahAudio): number => {
    const t = texts.get(n)
    if (t && t.words.length) return lastPosition(t)
    const c = toNumber(a.wordCount)
    if (Number.isInteger(c) && c > 0) return c
    let max = 1
    for (const w of Array.isArray(a.words) ? a.words : []) {
      const k = toNumber(w?.word)
      if (Number.isInteger(k) && k > max) max = k
    }
    return max
  }
  const startOfAyah = (n: number): number | null => {
    const a = audios.get(n)
    const w = a ? windowOf(a) : null
    return w ? w.start : null
  }

  const parts: Part[] = []
  let exact = true
  let wordLevel = false
  let playedStart: WordRef | null = null
  let playedEnd: WordRef | null = null

  // only ayahs that have audio are visited, so a malformed selection cannot loop for long
  const present = [...audios.keys()].filter((n) => n >= 1 && n >= s.start.ayah && n <= s.end.ayah).sort((x, y) => x - y)
  if (present.length < s.end.ayah - Math.max(1, s.start.ayah) + 1) exact = false // a selected ayah has no audio: skipped
  for (const n of present) {
    const a = audios.get(n) as AyahAudio
    const win = windowOf(a)
    if (!win) {
      exact = false
      continue
    }
    const count = wordCountOf(n, a)
    let fw = n === s.start.ayah ? clamp(s.start.word, 1, count) : 1
    let lw = n === s.end.ayah ? clamp(s.end.word, 1, count) : count
    if (lw < fw) lw = fw
    const partial = fw > 1 || lw < count
    const { words, stale } = sanitizeWords(a, count, win)
    let part = cuttable(a, reciter, words, stale) ? cutByWords(a, n, fw, lw, words, win, lead, tail) : null
    if (part && partial) wordLevel = true
    if (!part) {
      if (partial) {
        // classes C/D (and ayahs without trustworthy word timings): whole ayahs only
        exact = false
        fw = 1
        lw = count
      }
      part = cutWhole(a, n, count, win, startOfAyah(n + 1))
    }
    if (!part) {
      exact = false
      continue
    }
    if (part.inexact || part.firstWord !== fw || part.lastWord !== lw) exact = false
    parts.push(part)
    playedStart ??= { ayah: n, word: part.firstWord }
    playedEnd = { ayah: n, word: part.lastWord }
  }

  // §6: per-ayah files never contain the basmala → prepend the reciter's 1:1 when the clip opens the surah
  const b = opts?.basmala
  if (b && playedStart && playedStart.ayah === 1 && playedStart.word === 1 && surah !== 1 && surah !== 9) {
    const part = cutPreamble(b, 0, 4, reciter, lead, tail) // «بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ»: 4 words
    if (part) parts.unshift(part)
  }
  // the isti'adha opens any recitation, before the basmala (features §2.4); only from this reciter's own file (D7)
  const istiadha = opts?.istiadha === true ? audios.get(-1) : undefined
  if (istiadha && playedStart) {
    const part = cutPreamble(istiadha, -1, 5, reciter, lead, tail) // «أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ»: 5 words
    if (part) parts.unshift(part)
  }

  // merge consecutive cuts of the SAME chapter file: keeps the natural pause, and QDC windows overlap by ~65 ms,
  // so appending would play that audio twice
  const clips: AudioClip[] = []
  for (const p of parts) {
    const prev = clips[clips.length - 1]
    if (prev && canMerge(prev, p)) {
      prev.srcEndMs = Math.max(prev.srcEndMs as number, p.endMs as number)
      prev.fadeOutMs = p.fadeOutMs
      prev.ayahTo = p.ayah
      prev.snapToPause = prev.snapToPause || p.snapToPause
      prev.words.push(...p.words)
      const lastAyah = prev.ayahs[prev.ayahs.length - 1]
      const boundary = Math.max(p.startMs, lastAyah.startMs)
      lastAyah.endMs = boundary
      prev.ayahs.push({ ayah: p.ayah, startMs: boundary, endMs: null })
      continue
    }
    clips.push({
      ayah: p.ayah,
      ayahTo: p.ayah,
      url: p.url,
      fileKind: p.fileKind,
      bitrateKbps: p.bitrateKbps,
      srcStartMs: p.startMs,
      srcEndMs: p.endMs,
      fadeInMs: p.fadeInMs,
      fadeOutMs: p.fadeOutMs,
      snapToPause: p.snapToPause,
      extendToSpeechOnset: p.extendToSpeechOnset,
      trimSilence: p.trimSilence,
      words: [...p.words],
      ayahs: [{ ayah: p.ayah, startMs: p.ayahStartMs, endMs: null }],
    })
  }
  if (!clips.length) exact = false

  return {
    reciterId: typeof reciter?.id === 'string' ? reciter.id : '',
    clips,
    wordLevel,
    exact,
    playedSelection:
      playedStart && playedEnd ? { surah, start: playedStart, end: playedEnd } : { surah, start: { ...s.start }, end: { ...s.end } },
  }
}

export function estimatePlanDurationMs(plan: AudioPlan): number | null {
  const clips = Array.isArray(plan?.clips) ? plan.clips : []
  let total = 0
  for (const c of clips) {
    const start = toNumber(c?.srcStartMs)
    const end = c?.srcEndMs == null ? NaN : toNumber(c.srcEndMs)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    total += Math.max(0, end - start)
  }
  return total
}
