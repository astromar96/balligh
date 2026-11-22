// Whole-Quran audit of the display pipeline, used by the dump-based and LIVE tests and the data lab. Not part of
// the public API. Per verse it rebuilds the words exactly as fetchAyahs does (text.ts buildWords) and measures
// what research/00-gaps.md §2.1–§2.3 claims: §3.7 grouping never fails, the tajweed projection onto
// qpcToStandard(text_qpc_hafs) is exact for ≥ 77,388 of 77,429 words and loses one class (17:7:12), the display
// carries no tanween + small-meem sequence, the Tanzil (guard) and QPC (printed) pause marks differ in 353 words
// (ۙ unprinted in 67), and — as an independent cross-check — QF's word-level `<rule>` markup projected the same way
// differs from the verse-level route in exactly the 11 words the research lists.
import { buildWords, charClasses, hasTanweenMeem, parseQuranComTajweed, project, qpcToStandard, wordRanges, type BuiltWord } from './text'

export interface AuditWord {
  position: number
  char_type_name?: string
  text_uthmani: string
  text_qpc_hafs?: string
  /** QF's word-level tajweed markup (`<rule class=…>`), used only for the cross-check */
  text_uthmani_tajweed?: string
}

export interface AuditCounts {
  verses: number
  words: number
  alignmentFailures: number
  failedKeys: string[]
  /** verses where tokens ≠ words (۞, ۩, 8:6, 37:130) */
  tokenMerges: number
  /** project() met no coloured mismatch (the research script's "clean") */
  wordsProjectedExactly: number
  /** words with a class of the source slice on no character of the display source */
  wordsWithLostRule: number
  /** "key:word class" of every lost class */
  lostRules: string[]
  /** words where a class on a letter (not a separator, ۞, ۩ or pause mark) is missing from Word.tajweed */
  wordsWithLostDisplayRule: number
  lostDisplayRuleKeys: string[]
  /** display words (Word.text) still carrying a tanween + small meem (Amiri draws the meem) */
  tanweenMeemWords: number
  tanweenMeemKeys: string[]
  /** words displayed from their Tanzil text because the verse came without text_qpc_hafs */
  qpcMissingWords: number
  /** words whose Tanzil marks (text_uthmani, anywhere in the word) differ from the QPC marks (text_qpc_hafs) */
  waqfMarkDiffWords: number
  /** words whose trailing Tanzil marks (Word.waqf's source) differ from the printed QPC marks (Word.waqfChar) */
  waqfTrailingDiffWords: number
  /** ۙ (mamnu) positions of the guard, and those with no mark printed */
  mamnu: number
  mamnuWithoutPrintedMark: number
  /** Word.waqf / Word.waqfChar inconsistent with the raw texts */
  waqfFieldErrors: number
  spans: number
  /** malformed spans (out of bounds, empty, overlapping, on a space) */
  badSpans: number
  /** display words that end with a pause mark, contain invisible characters, are empty or untrimmed */
  badDisplayWords: number
  /** cross-check with QF's word-level markup projected the same way: per-character and class-set differences */
  wordLevelCompared: number
  wordLevelCharDiffer: number
  wordLevelSetDiffer: number
  wordLevelDiffKeys: string[]
}

export function emptyCounts(): AuditCounts {
  return {
    verses: 0,
    words: 0,
    alignmentFailures: 0,
    failedKeys: [],
    tokenMerges: 0,
    wordsProjectedExactly: 0,
    wordsWithLostRule: 0,
    lostRules: [],
    wordsWithLostDisplayRule: 0,
    lostDisplayRuleKeys: [],
    tanweenMeemWords: 0,
    tanweenMeemKeys: [],
    qpcMissingWords: 0,
    waqfMarkDiffWords: 0,
    waqfTrailingDiffWords: 0,
    mamnu: 0,
    mamnuWithoutPrintedMark: 0,
    waqfFieldErrors: 0,
    spans: 0,
    badSpans: 0,
    badDisplayWords: 0,
    wordLevelCompared: 0,
    wordLevelCharDiffer: 0,
    wordLevelSetDiffer: 0,
    wordLevelDiffKeys: [],
  }
}

const WAQF = /[\u{06D6}-\u{06DC}]/u
const WAQF_G = /[\u{06D6}-\u{06DC}]/gu
const NOT_RULE_CONTENT = /[\u{200C}\u{200F} \u{06DE}\u{06E9}\u{06D6}-\u{06DC}]/u
const INVISIBLE = /[\u{200B}-\u{200F}\u{FEFF}]/u
const TRAILING_MARKS = /(?:[\s\u{200C}\u{200F}]*[\u{06D6}-\u{06DC}])+[\s\u{200C}\u{200F}]*$/u
const MAMNU = '\u{06D9}'

const marksOf = (s: string): string => (s.match(WAQF_G) ?? []).join('')
/** The pause marks at the end of a raw word text (spaces/ZWNJ/RLM between them ignored), e.g. "ۜۗ" for 36:52:6. */
export const trailingMarks = (s: string): string => marksOf(TRAILING_MARKS.exec(s)?.[0] ?? '')

/**
 * research/scripts/gaps/spurious_meem_count.py over consecutive verses of word texts: words with tanween + small
 * meem, split into iqlab (the next word — or the next verse's first — starts with ب; the meem is right) and the
 * rest (Tanzil's open-tanween encoding, which Amiri draws as a stray meem).
 */
export function meemCounts(verses: string[][]): { words: number; iqlab: number; spurious: number } {
  const strip = /[\u{0610}-\u{061A}\u{064B}-\u{065F}\u{0670}\u{06D6}-\u{06ED}\u{0640}\s]/gu
  const out = { words: 0, iqlab: 0, spurious: 0 }
  verses.forEach((words, vi) =>
    words.forEach((t, i) => {
      if (!hasTanweenMeem(t)) return
      const next = i + 1 < words.length ? words[i + 1] : (verses[vi + 1]?.[0] ?? '')
      out.words++
      if (next.replace(strip, '').startsWith('\u{0628}')) out.iqlab++
      else out.spurious++
    }),
  )
  return out
}
const normCls = (c: string | null): string | null => (c && c.startsWith('madda_obligatory') ? 'madda_obligatory' : c)

/** QF word-level markup → characters + the innermost class that colours (research script parse_word_markup). */
function wordMarkupChars(markup: string): { text: string; classes: (string | null)[] } {
  const stack: string[] = []
  let text = ''
  const classes: (string | null)[] = []
  for (const m of markup.matchAll(/<rule class=([\w-]+)>|<\/rule>|([^<]+)/g)) {
    if (m[1]) stack.push(m[1])
    else if (m[0] === '</rule>') stack.pop()
    else {
      const cls = [...stack].reverse().find((c) => c !== 'custom-alef-maksora') ?? null
      for (const ch of m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) {
        text += ch
        classes.push(cls)
      }
    }
  }
  return { text, classes }
}

/**
 * Audits one verse and returns the words built for it (null when the §3.7 grouping failed). `words` are the
 * verse's words[] entries of char_type_name "word", in position order.
 */
export function auditVerse(counts: AuditCounts, key: string, tajweedRaw: string, words: AuditWord[]): BuiltWord[] | null {
  counts.verses++
  counts.words += words.length
  const parsed = parseQuranComTajweed(tajweedRaw)
  const tanzil = words.map((w) => w.text_uthmani)
  if (parsed.plain.split(' ').length !== tanzil.length) counts.tokenMerges++
  let ranges: [number, number][]
  try {
    ranges = wordRanges(parsed.plain, tanzil)
  } catch {
    counts.alignmentFailures++
    if (counts.failedKeys.length < 20) counts.failedKeys.push(key)
    return null
  }
  const qpcOk = words.every((w) => typeof w.text_qpc_hafs === 'string' && w.text_qpc_hafs.length > 0)
  const { built } = buildWords(
    words.map((w) => ({ tanzil: w.text_uthmani, qpc: qpcOk ? (w.text_qpc_hafs as string) : null })),
    parsed,
  )
  built.forEach((b, k) => {
    const w = b.word
    const ref = `${key}:${k + 1}`
    const src = words[k]
    if (!qpcOk) counts.qpcMissingWords++
    // projection
    if (b.clean) counts.wordsProjectedExactly++
    if (b.lostClasses.length) {
      counts.wordsWithLostRule++
      for (const c of b.lostClasses) if (counts.lostRules.length < 50) counts.lostRules.push(`${ref} ${c}`)
    }
    const [a, z] = ranges[k]
    const slice = parsed.plain.slice(a, z)
    const cls = charClasses(parsed.spans, a, z)
    const want = new Set<string>()
    for (let i = 0; i < slice.length; i++) if (cls[i] && !NOT_RULE_CONTENT.test(slice[i])) want.add(cls[i] as string)
    const got = new Set(w.tajweed.map((s) => s.rule))
    if ([...want].some((c) => !got.has(c))) {
      counts.wordsWithLostDisplayRule++
      if (counts.lostDisplayRuleKeys.length < 50) counts.lostDisplayRuleKeys.push(ref)
    }
    // display encoding
    if (hasTanweenMeem(w.text)) {
      counts.tanweenMeemWords++
      if (counts.tanweenMeemKeys.length < 20) counts.tanweenMeemKeys.push(ref)
    }
    // pause marks: guard (Tanzil) vs printed (QPC)
    if (qpcOk) {
      if (marksOf(src.text_uthmani) !== marksOf(src.text_qpc_hafs as string)) counts.waqfMarkDiffWords++
      if (trailingMarks(src.text_uthmani) !== trailingMarks(src.text_qpc_hafs as string)) counts.waqfTrailingDiffWords++
    }
    const tz = trailingMarks(src.text_uthmani)
    const printed = qpcOk ? trailingMarks(src.text_qpc_hafs as string) : tz
    if (tz.includes(MAMNU)) {
      counts.mamnu++
      if (w.waqfChar === null) counts.mamnuWithoutPrintedMark++
    }
    if ((w.waqfChar ?? '').replace(/\s/g, '') !== printed || (tz === '') !== (w.waqf === null)) counts.waqfFieldErrors++
    // spans and display words
    let prevEnd = 0
    for (const s of w.tajweed) {
      counts.spans++
      if (s.start < prevEnd || s.end <= s.start || s.end > w.text.length || /\s/u.test(w.text.slice(s.start, s.end))) counts.badSpans++
      prevEnd = s.end
    }
    if (WAQF.test(w.text.slice(-1)) || INVISIBLE.test(w.text) || w.text !== w.text.trim() || w.text.length === 0) counts.badDisplayWords++
    // cross-check: QF's word-level markup through the same projector, onto the same display source
    if (qpcOk && src.text_uthmani_tajweed !== undefined) {
      counts.wordLevelCompared++
      const wm = wordMarkupChars(src.text_uthmani_tajweed)
      const target = qpcToStandard(src.text_qpc_hafs as string)
      const verseRoute = project(slice, cls, target).classes.map(normCls)
      const wordRoute = project(wm.text, wm.classes, target).classes.map(normCls)
      if (verseRoute.some((c, i) => c !== wordRoute[i])) {
        counts.wordLevelCharDiffer++
        if (counts.wordLevelDiffKeys.length < 30) counts.wordLevelDiffKeys.push(ref)
        const setOf = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean))].sort().join()
        if (setOf(verseRoute) !== setOf(wordRoute)) counts.wordLevelSetDiffer++
      }
    }
  })
  return built
}
