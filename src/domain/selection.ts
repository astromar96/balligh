// Selection helpers, pause-mark snapping and integrity warnings — research/features.md §2.3 (the boundary guard,
// prototype research/scripts/features/boundary_check.py) with the Tanzil marks of 00-gaps D1 (Word.waqf).
import type { Ayah, Selection, Surah, Word, WordRef } from '../core/types'
import type { SelectionWarning } from './index'
import { ayahCountOf } from './quran-meta'
import { toArabicDigits } from './arabic'
import { curatedEnd, isIlla, isSpeechVerb } from './guard'
import { canStopAfter, waqfOfWord } from './waqf'

/**
 * Word number meaning "the last word of this ayah" where the word count is not known yet (a decoded
 * share link, or ayahs that are not loaded). Every domain function treats an end word at or above
 * this as the ayah's last word; clampSelection() replaces it with the real position.
 */
export const AYAH_END_WORD = 999

/** Above this many words selectionWarnings() suggests splitting the clip. */
export const LONG_SELECTION_WORDS = 120

const int = (n: unknown, fallback: number): number => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? v : fallback
}

const ref = (r: WordRef | undefined): WordRef => ({ ayah: int(r?.ayah, 1), word: int(r?.word, 1) })

export function compareRefs(a: WordRef, b: WordRef): number {
  return a.ayah - b.ayah || a.word - b.word
}

export function normalizeSelection(sel: Selection): Selection {
  const start = ref(sel.start)
  const end = ref(sel.end)
  return compareRefs(start, end) <= 0 ? { surah: sel.surah, start, end } : { surah: sel.surah, start: end, end: start }
}

// ── ayah/word lookups ──

/** Ayahs by number (first wins), restricted to `surah` when the ayahs say which surah they belong to. */
export function indexAyahs(ayahs: readonly Ayah[] | null | undefined, surah?: number): Map<number, Ayah> {
  const map = new Map<number, Ayah>()
  for (const a of ayahs ?? []) {
    if (!a || !Array.isArray(a.words)) continue
    if (surah !== undefined && Number.isFinite(a.surah) && a.surah !== surah) continue
    if (!map.has(a.number)) map.set(a.number, a)
  }
  return map
}

/** The ayah's words in position order (input is normally sorted already; this guards against it not being). */
function orderedWords(a: Ayah): Word[] {
  const ws = a.words.filter((w) => w && Number.isFinite(w.position))
  for (let i = 1; i < ws.length; i++) {
    if (ws[i].position < ws[i - 1].position) return [...ws].sort((x, y) => x.position - y.position)
  }
  return ws
}

export function firstPosition(a: Ayah): number {
  const ws = orderedWords(a)
  return ws.length ? ws[0].position : 1
}

export function lastPosition(a: Ayah): number {
  const ws = orderedWords(a)
  return ws.length ? ws[ws.length - 1].position : 1
}

/** Index of the last word whose position is <= `pos` (0 when every word is after it). */
function indexAtOrBefore(ws: Word[], pos: number): number {
  let idx = 0
  for (let i = 0; i < ws.length; i++) if (ws[i].position <= pos) idx = i
  return idx
}

/** Index of the first word whose position is >= `pos` (the last word when none is). */
function indexAtOrAfter(ws: Word[], pos: number): number {
  for (let i = 0; i < ws.length; i++) if (ws[i].position >= pos) return i
  return ws.length - 1
}

/**
 * Orders the selection, keeps its ayahs inside the surah and its words inside their ayahs, and resolves
 * AYAH_END_WORD to the real last word. Ayahs that are not in `ayahs` keep their word numbers.
 */
export function clampSelection(sel: Selection, ayahs: readonly Ayah[]): Selection {
  const s = normalizeSelection(sel)
  const byNo = indexAyahs(ayahs, s.surah)
  const count = ayahCountOf(s.surah)
  let lo = 1
  let hi = count > 0 ? count : Number.MAX_SAFE_INTEGER
  if (count === 0 && byNo.size > 0) {
    lo = Math.min(...byNo.keys())
    hi = Math.max(...byNo.keys())
  }
  // an end moved back into the surah ends with its new ayah; a start moved forward starts with its new ayah
  const start: WordRef =
    s.start.ayah < lo ? { ayah: lo, word: 1 } : s.start.ayah > hi ? { ayah: hi, word: 1 } : { ayah: s.start.ayah, word: Math.max(1, s.start.word) }
  const end: WordRef =
    s.end.ayah > hi
      ? { ayah: hi, word: AYAH_END_WORD }
      : s.end.ayah < lo
        ? { ayah: lo, word: AYAH_END_WORD }
        : { ayah: s.end.ayah, word: Math.max(1, s.end.word) }
  const a = byNo.get(start.ayah)
  if (a && a.words.length) start.word = Math.min(lastPosition(a), Math.max(firstPosition(a), start.word))
  const b = byNo.get(end.ayah)
  if (b && b.words.length) end.word = Math.min(lastPosition(b), Math.max(firstPosition(b), end.word))
  return normalizeSelection({ surah: s.surah, start, end })
}

export function ayahRangeSelection(surah: number, fromAyah: number, toAyah: number, ayahs: Ayah[]): Selection {
  let from = int(fromAyah, 1)
  let to = int(toAyah, from)
  if (from > to) [from, to] = [to, from]
  const byNo = indexAyahs(ayahs, surah)
  const count = ayahCountOf(surah)
  if (count > 0) {
    from = Math.min(count, Math.max(1, from))
    to = Math.min(count, Math.max(1, to))
  } else if (byNo.size > 0) {
    const lo = Math.min(...byNo.keys())
    const hi = Math.max(...byNo.keys())
    from = Math.min(hi, Math.max(lo, from))
    to = Math.min(hi, Math.max(lo, to))
  } else {
    from = Math.max(1, from)
    to = Math.max(1, to)
  }
  const a = byNo.get(from)
  const b = byNo.get(to)
  return {
    surah,
    start: { ayah: from, word: a && a.words.length ? firstPosition(a) : 1 },
    end: { ayah: to, word: b && b.words.length ? lastPosition(b) : AYAH_END_WORD },
  }
}

export function isWordSelected(sel: Selection | null, r: WordRef): boolean {
  if (!sel || !r) return false
  const s = normalizeSelection(sel)
  return compareRefs(r, s.start) >= 0 && compareRefs(r, s.end) <= 0
}

export function trimToSelection(sel: Selection, ayahs: Ayah[]): { ayahs: Ayah[]; partialStart: boolean; partialEnd: boolean } {
  const s = normalizeSelection(sel)
  const out: Ayah[] = []
  let partialStart = false
  let partialEnd = false
  for (const a of indexAyahs(ayahs, s.surah).values()) {
    if (a.number < s.start.ayah || a.number > s.end.ayah) continue
    const ws = orderedWords(a)
    const kept = ws.filter((w) => isWordSelected(s, { ayah: a.number, word: w.position }))
    if (a.number === s.start.ayah && ws.some((w) => w.position < s.start.word)) partialStart = true
    if (a.number === s.end.ayah && ws.some((w) => w.position > s.end.word)) partialEnd = true
    if (kept.length) out.push({ ...a, words: kept })
  }
  out.sort((x, y) => x.number - y.number)
  return { ayahs: out, partialStart, partialEnd }
}

export function selectedWordCount(sel: Selection, ayahs: Ayah[]): number {
  return trimToSelection(sel, ayahs).ayahs.reduce((n, a) => n + a.words.length, 0)
}

export function expandToAyahs(sel: Selection, ayahs: Ayah[]): Selection {
  const s = normalizeSelection(sel)
  const byNo = indexAyahs(ayahs, s.surah)
  const a = byNo.get(s.start.ayah)
  const b = byNo.get(s.end.ayah)
  return {
    surah: s.surah,
    start: { ayah: s.start.ayah, word: a && a.words.length ? firstPosition(a) : 1 },
    end: { ayah: s.end.ayah, word: b && b.words.length ? lastPosition(b) : AYAH_END_WORD },
  }
}

// ── pause marks ──
// A phrase ends at the end of an ayah, or after a word whose mark allows stopping (ۘ ۚ ۖ ۗ ۛ). ۙ (do not
// stop) and ۜ (saktah, a breathless pause) are never phrase ends. The marks are Word.waqf (Tanzil, 00-gaps D1).

/**
 * Index of the other mark of the ۛ (muanaqa, تعانق) pair that ws[i] belongs to, or -1. The marks pair up in reading
 * order inside their ayah: 6 ayahs carry exactly two each in the Tanzil text (2:2, 2:195, 5:26, 5:41, 7:172, 14:9).
 */
function muanaqaPartner(ws: Word[], i: number): number {
  if (waqfOfWord(ws[i]) !== 'muanaqa') return -1
  const marks: number[] = []
  ws.forEach((w, k) => {
    if (waqfOfWord(w) === 'muanaqa') marks.push(k)
  })
  const n = marks.indexOf(i)
  const partner = n % 2 === 0 ? marks[n + 1] : marks[n - 1]
  return partner === undefined ? -1 : partner
}

/**
 * Index (in `ws`, the end ayah's words) of the ۛ the end must not stop on because the selection starts right after
 * its pair partner in the same ayah — stopping at both marks of a pair is not allowed. -1 when there is none.
 */
function pairBlockedEnd(ws: Word[], startAyah: number, startWord: number, endAyah: number): number {
  if (startAyah !== endAyah) return -1
  const i = indexAtOrBefore(ws, startWord)
  if (i === 0 || ws[i].position !== startWord) return -1
  const partner = muanaqaPartner(ws, i - 1)
  return partner > i - 1 ? partner : -1
}

export function snapToPauses(sel: Selection, ayahs: Ayah[]): Selection {
  const s = normalizeSelection(sel)
  const byNo = indexAyahs(ayahs, s.surah)
  const start = { ...s.start }
  const end = { ...s.end }
  const a = byNo.get(start.ayah)
  if (a && a.words.length) {
    const ws = orderedWords(a)
    let i = indexAtOrBefore(ws, start.word)
    while (i > 0 && !canStopAfter(ws[i - 1])) i--
    start.word = ws[i].position
  }
  const b = byNo.get(end.ayah)
  if (b && b.words.length) {
    const ws = orderedWords(b)
    const blocked = pairBlockedEnd(ws, start.ayah, start.word, end.ayah)
    let i = indexAtOrAfter(ws, end.word)
    while (i < ws.length - 1 && (!canStopAfter(ws[i]) || i === blocked)) i++
    end.word = ws[i].position
  }
  return normalizeSelection({ surah: s.surah, start, end })
}

/** Index of the speech verb nearest before ws[i] since the last allowed stop (features §2.3), or -1. */
function speechVerbBefore(ws: Word[], i: number): number {
  for (let k = i - 1; k >= 0; k--) {
    if (k < i - 1 && canStopAfter(ws[k])) break
    if (isSpeechVerb(ws[k].text)) return k
  }
  return -1
}

/** Where a fix for an ayah-end warning should extend the end: the first complete phrase of the next ayah. */
function nextPhraseEnd(next: Ayah | undefined, ayah: number): WordRef {
  if (!next || !next.words.length) return { ayah, word: AYAH_END_WORD }
  const ws = orderedWords(next)
  let i = 0
  while (i < ws.length - 1 && !canStopAfter(ws[i])) i++
  return { ayah: next.number, word: ws[i].position }
}

export function selectionWarnings(sel: Selection, ayahs: Ayah[]): SelectionWarning[] {
  const s = normalizeSelection(sel)
  const byNo = indexAyahs(ayahs, s.surah)
  const out: SelectionWarning[] = []
  const a = byNo.get(s.start.ayah)
  if (a && a.words.length) {
    const ws = orderedWords(a)
    const i = indexAtOrBefore(ws, s.start.word)
    if (i > 0 && !canStopAfter(ws[i - 1])) {
      const at = { ayah: a.number, word: ws[i].position }
      const v = speechVerbBefore(ws, i)
      if (v >= 0) out.push({ kind: 'starts-after-speech-verb', at, verb: { ayah: a.number, word: ws[v].position } })
      else out.push({ kind: 'starts-mid-phrase', at })
    }
  }
  const b = byNo.get(s.end.ayah)
  const bws = b && b.words.length ? orderedWords(b) : null
  const j = bws ? indexAtOrAfter(bws, s.end.word) : -1
  if (bws && j < bws.length - 1) {
    // inside the ayah
    const at = { ayah: s.end.ayah, word: bws[j].position }
    const kind = waqfOfWord(bws[j])
    if (kind === 'mamnu') out.push({ kind: 'ends-on-mamnu', at })
    else if (!canStopAfter(bws[j])) out.push({ kind: 'ends-mid-phrase', at })
    else if (kind === 'wasl_awla') out.push({ kind: 'pause-hint', at, mark: 'wasl_awla', bothStops: false })
    else if (kind === 'muanaqa') {
      const bothStops = pairBlockedEnd(bws, s.start.ayah, s.start.word, s.end.ayah) === j
      out.push({ kind: 'pause-hint', at, mark: 'muanaqa', bothStops })
    }
  } else if (bws || s.end.word >= AYAH_END_WORD) {
    // at the ayah end (an ayah that is not loaded counts when the end word says "to the ayah end")
    const at = { ayah: s.end.ayah, word: bws ? bws[j].position : s.end.word }
    const next = byNo.get(s.end.ayah + 1)
    const firstNext = next && next.words.length ? orderedWords(next)[0] : undefined
    if (curatedEnd(s.surah, s.end.ayah)) out.push({ kind: 'ends-curated', at, extendTo: nextPhraseEnd(next, s.end.ayah + 1) })
    else if (firstNext && isIlla(firstNext.text)) out.push({ kind: 'next-starts-with-illa', at, extendTo: nextPhraseEnd(next, s.end.ayah + 1) })
  }
  const count = selectedWordCount(s, ayahs)
  if (count > LONG_SELECTION_WORDS) out.push({ kind: 'long', count })
  return out
}

export function warningSeverity(w: SelectionWarning): 'warning' | 'info' {
  return w?.kind === 'pause-hint' && !w.bothStops ? 'info' : 'warning'
}

/**
 * "البقرة ٢٥٥" · "البقرة ٢٥٥–٢٥٧" · "البقرة ٢٥٥ (الكلمة ٣)" · "البقرة ٢٥٥ (الكلمات ١–٧)" ·
 * "البقرة ٢٥٥–٢٥٧ (من الكلمة ٣ إلى الكلمة ٥)"; in English "Al-Baqarah 255–257 (from word 3 to word 5)" and so on
 * (the cases of src/ui/describe.ts). Unknown ayahs count as whole unless a word number says otherwise.
 */
export function describeSelection(sel: Selection, surah: Surah | null, ayahs: Ayah[], lang: 'ar' | 'en' = 'ar'): string {
  const s = normalizeSelection(sel)
  const byNo = indexAyahs(ayahs, s.surah)
  const en = lang === 'en'
  const d = en ? (n: number) => String(n) : toArabicDigits
  const name = ((en ? surah?.nameSimple : surah?.nameArabic) ?? '').trim() || (en ? `Surah ${s.surah}` : `سورة ${d(s.surah)}`)
  const a = byNo.get(s.start.ayah)
  const b = byNo.get(s.end.ayah)
  const fw = a && a.words.length ? Math.max(s.start.word, firstPosition(a)) : s.start.word
  const lw = b && b.words.length ? Math.min(s.end.word, lastPosition(b)) : s.end.word
  const startWhole = a && a.words.length ? fw <= firstPosition(a) : fw <= 1
  const endWhole = b && b.words.length ? lw >= lastPosition(b) : lw >= AYAH_END_WORD
  const sameAyah = s.start.ayah === s.end.ayah
  const base = sameAyah ? `${name} ${d(s.start.ayah)}` : `${name} ${d(s.start.ayah)}–${d(s.end.ayah)}`
  if (startWhole && endWhole) return base
  if (sameAyah) {
    if (endWhole) return en ? `${base} (from word ${d(fw)})` : `${base} (من الكلمة ${d(fw)})`
    if (fw === lw) return en ? `${base} (word ${d(fw)})` : `${base} (الكلمة ${d(fw)})`
    return en ? `${base} (words ${d(fw)}–${d(lw)})` : `${base} (الكلمات ${d(fw)}–${d(lw)})`
  }
  const parts: string[] = []
  if (!startWhole) parts.push(en ? `from word ${d(fw)}` : `من الكلمة ${d(fw)}`)
  if (!endWhole) parts.push(en ? `to word ${d(lw)}` : `إلى الكلمة ${d(lw)}`)
  return `${base} (${parts.join(' ')})`
}
