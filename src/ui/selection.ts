// Pure selection mechanics for the Mushaf panel: the tap state machine, page grouping, the keyboard cursor and
// the share text. The selection rules themselves (snapping, warnings, labels) are domain's; these are the small
// helpers the panel needs on every render. No React, no I/O: unit-tested in selection.test.ts.
import type { Ayah, Selection, WordRef } from '../core/types'

export function compareRef(a: WordRef, b: WordRef): number {
  return a.ayah !== b.ayah ? a.ayah - b.ayah : a.word - b.word
}

export function normalizeLocal(sel: Selection): Selection {
  return compareRef(sel.start, sel.end) <= 0 ? sel : { surah: sel.surah, start: sel.end, end: sel.start }
}

export function contains(sel: Selection | null, ref: WordRef): boolean {
  if (!sel) return false
  return compareRef(sel.start, ref) <= 0 && compareRef(ref, sel.end) <= 0
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.surah === b.surah && compareRef(a.start, b.start) === 0 && compareRef(a.end, b.end) === 0
}

/** Last word position of an ayah (positions are 1-based; the audio segments use the same numbers). */
export function lastWordOf(ayah: Ayah | undefined): number {
  if (!ayah || ayah.words.length === 0) return 1
  return ayah.words[ayah.words.length - 1].position
}

export function firstWordOf(ayah: Ayah | undefined): number {
  if (!ayah || ayah.words.length === 0) return 1
  return ayah.words[0].position
}

export function findAyah(ayahs: Ayah[], n: number): Ayah | undefined {
  const guess = ayahs[n - 1]
  if (guess && guess.number === n) return guess
  return ayahs.find((a) => a.number === n)
}

/** Whole ayahs from..to, clamped to the surah (an ornament tap stands for its whole ayah). */
export function wholeAyahsLocal(surah: number, fromAyah: number, toAyah: number, ayahs: Ayah[]): Selection {
  const count = ayahs.length > 0 ? ayahs[ayahs.length - 1].number : Math.max(fromAyah, toAyah, 1)
  const clamp = (n: number) => Math.min(Math.max(1, Math.round(n)), count)
  let from = clamp(fromAyah)
  let to = clamp(toAyah)
  if (from > to) [from, to] = [to, from]
  return {
    surah,
    start: { ayah: from, word: firstWordOf(findAyah(ayahs, from)) },
    end: { ayah: to, word: lastWordOf(findAyah(ayahs, to)) },
  }
}

/** Smallest selection covering both. */
export function hull(a: Selection, b: Selection): Selection {
  const x = normalizeLocal(a)
  const y = normalizeLocal(b)
  return {
    surah: x.surah,
    start: compareRef(x.start, y.start) <= 0 ? x.start : y.start,
    end: compareRef(x.end, y.end) >= 0 ? x.end : y.end,
  }
}

/** The selected words of each ayah, with flags for a partly selected first/last ayah. */
export function trimLocal(sel: Selection, ayahs: Ayah[]): { ayahs: Ayah[]; partialStart: boolean; partialEnd: boolean } {
  const s = normalizeLocal(sel)
  const out: Ayah[] = []
  let partialStart = false
  let partialEnd = false
  for (const a of ayahs) {
    if (a.number < s.start.ayah || a.number > s.end.ayah) continue
    const words = a.words.filter((w) => contains(s, { ayah: a.number, word: w.position }))
    if (a.number === s.start.ayah && words.length > 0 && words[0].position !== firstWordOf(a)) partialStart = true
    if (a.number === s.end.ayah && words.length > 0 && words[words.length - 1].position !== lastWordOf(a)) partialEnd = true
    out.push({ ...a, words })
  }
  return { ayahs: out, partialStart, partialEnd }
}

// ───────────────────────── Tap state machine ─────────────────────────

export interface TapState {
  /** what is selected now (a single word while the end is still open) */
  selection: Selection | null
  /** the first tap, waiting for the second; null when the selection is complete */
  pending: Selection | null
}

export type TapTarget = { kind: 'word'; ref: WordRef } | { kind: 'ayah'; ayah: number }

export interface TapOptions {
  surah: number
  ayahs: Ayah[]
  mode: 'words' | 'ayahs'
  snap: boolean
  expandToAyahs(sel: Selection): Selection
  snapToPauses(sel: Selection): Selection
}

/** The range a tap stands for: one word, or a whole ayah (ornament tap / 'ayahs' mode). */
export function targetRange(target: TapTarget, opts: TapOptions): Selection {
  if (target.kind === 'ayah') return wholeAyahsLocal(opts.surah, target.ayah, target.ayah, opts.ayahs)
  const single: Selection = { surah: opts.surah, start: target.ref, end: target.ref }
  return opts.mode === 'ayahs' ? opts.expandToAyahs(single) : single
}

/**
 * Tap a word = start; another = end; a third starts over. Tapping the same word twice selects it
 * alone. An ornament tap stands for its whole ayah. 'ayahs' mode widens every tap to whole ayahs.
 * Snapping to pause marks applies when the selection completes (never to the lone first word, so the
 * band does not jump before the user has said where the passage ends).
 */
export function applyTap(state: TapState, target: TapTarget, opts: TapOptions): TapState {
  const range = targetRange(target, opts)
  if (!state.pending) return { selection: range, pending: range }
  let sel = hull(state.pending, range)
  if (opts.mode === 'ayahs') sel = opts.expandToAyahs(sel)
  else if (opts.snap) sel = opts.snapToPauses(sel)
  return { selection: sel, pending: null }
}

// ───────────────────────── Mushaf pages ─────────────────────────

export interface MushafPage {
  /** printed Mushaf page number (where the first ayah of this block starts) */
  page: number
  /** juz numbers that begin inside this block (the first block also lists its own juz) */
  juzStarts: number[]
  ayahs: Ayah[]
}

/** Groups a surah's ayahs into Mushaf-page blocks so the panel flows like a printed page. */
export function groupByPage(ayahs: Ayah[]): MushafPage[] {
  const pages: MushafPage[] = []
  let prevJuz = -1
  for (const a of ayahs) {
    let block = pages[pages.length - 1]
    if (!block || block.page !== a.page) {
      block = { page: a.page, juzStarts: [], ayahs: [] }
      pages.push(block)
    }
    if (a.juz !== prevJuz) {
      block.juzStarts.push(a.juz)
      prevJuz = a.juz
    }
    block.ayahs.push(a)
  }
  return pages
}

export function pageIndexOfAyah(pages: MushafPage[], ayah: number): number {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    if (p.ayahs.length > 0 && p.ayahs[0].number <= ayah && ayah <= p.ayahs[p.ayahs.length - 1].number) return i
  }
  return -1
}

/**
 * A short key describing how a selection touches a page block — rows whose key did not change are
 * not re-rendered when the selection moves (Al-Baqarah has 6,000+ words).
 */
export function pageSelectionKey(page: MushafPage, sel: Selection | null, anchor: Selection | null, cursor: WordRef | null): string {
  const first = page.ayahs[0]?.number ?? 0
  const last = page.ayahs[page.ayahs.length - 1]?.number ?? 0
  const part = (s: Selection | null, tag: string) => {
    if (!s) return ''
    const n = normalizeLocal(s)
    if (n.end.ayah < first || n.start.ayah > last) return ''
    return `${tag}${n.start.ayah}.${n.start.word}-${n.end.ayah}.${n.end.word}`
  }
  const c = cursor && cursor.ayah >= first && cursor.ayah <= last ? `c${cursor.ayah}.${cursor.word}` : ''
  return part(sel, 's') + part(anchor, 'a') + c
}

/** The selected words as plain text (pause marks kept, ayah ornaments between ayahs) — for share text. */
export function selectedText(sel: Selection, ayahs: Ayah[], ornament: (n: number) => string): string {
  const { ayahs: trimmed } = trimLocal(sel, ayahs)
  const parts: string[] = []
  trimmed.forEach((a, i) => {
    for (const w of a.words) parts.push(w.waqfChar ? `${w.text} ${w.waqfChar}` : w.text)
    const reachesEnd = a.words.length > 0 && a.words[a.words.length - 1].position === lastWordOf(findAyah(ayahs, a.number))
    if (reachesEnd || i < trimmed.length - 1) parts.push(ornament(a.number))
  })
  return parts.join(' ')
}

// ───────────────────────── Keyboard cursor ─────────────────────────

/** Next/previous word in reading order across ayahs; stays put at the surah's edges. */
export function stepWord(ayahs: Ayah[], ref: WordRef, delta: 1 | -1): WordRef {
  const ayah = findAyah(ayahs, ref.ayah)
  if (!ayah) return ref
  const idx = ayah.words.findIndex((w) => w.position === ref.word)
  const nextIdx = idx + delta
  if (idx >= 0 && nextIdx >= 0 && nextIdx < ayah.words.length) return { ayah: ref.ayah, word: ayah.words[nextIdx].position }
  const neighbour = findAyah(ayahs, ref.ayah + delta)
  if (!neighbour || neighbour.words.length === 0) return ref
  return { ayah: neighbour.number, word: delta === 1 ? firstWordOf(neighbour) : lastWordOf(neighbour) }
}
