// Quran text helpers: the display text (QPC → standard Unicode for Amiri Quran), pause-mark splitting, tajweed
// markup parsing and the projection of tajweed rule classes onto the display text.
//
// Display text (research/00-gaps.md §0.1, §2.2): words[].text_qpc_hafs mapped by qpcToStandard. Not
// words[].text_uthmani: Amiri Quran draws a stray small meem on 6,678 of those words (Tanzil's open-tanween
// encoding). words[].text_uthmani is still read: its skeletons drive the §3.7 grouping of the tajweed tokens and
// its (Tanzil) pause marks drive the selection guard (00-gaps D1).
// Tajweed (00-gaps §2.1): verse-level text_uthmani_tajweed → quran-text-api §3.7 grouping → project() (a port of
// research/scripts/gaps/tajweed_projection_check.py, difflib matching included) onto the display text.
// All Quran text is BMP-only, so a JS string index is a code point (and a HarfBuzz cluster value).
// Escapes are written \u{…} on purpose (no literal invisible characters in source).
import type { TajweedRuleId, TajweedSpan, WaqfKind, Word } from '../core/types'

// ───────────────────────── pause marks ─────────────────────────

/** U+06D6..U+06DC → kind (types.ts WaqfKind docs). */
export const WAQF_KIND_BY_CHAR: Readonly<Record<string, WaqfKind>> = {
  '\u{06D6}': 'wasl_awla', // ۖ continuing is better
  '\u{06D7}': 'waqf_awla', // ۗ stopping is better
  '\u{06D8}': 'lazim', // ۘ must stop
  '\u{06D9}': 'mamnu', // ۙ do not stop
  '\u{06DA}': 'jaiz', // ۚ may stop
  '\u{06DB}': 'muanaqa', // ۛ stop at one of the pair
  '\u{06DC}': 'saktah', // ۜ brief pause without breath
}

const SAKTAH = '\u{06DC}'
const SAJDAH_SIGN = '\u{06E9}'
const isWaqfChar = (c: string): boolean => c >= '\u{06D6}' && c <= '\u{06DC}'

/** Invisible format characters seen in the data (RLM in 27:26, BOM in alquran.cloud 1:1). */
const INVISIBLE = /[\u{200B}-\u{200F}\u{2060}\u{FEFF}]/u
/** Separators between a word and its pause mark: space, NBSP, ZWNJ (tajweed text). */
const MARK_SEPARATOR = /[ \u{00A0}\u{200C}]/u
const SPACE_LIKE = /[ \t\n\r\u{00A0}]/u
const IS_MN = /\p{Mn}/u
const IS_SPACE = /\s/u

/** Characters the bundled Amiri Quran font lacks (or the tajweed text uses as hacks) → intended form, 1:1. */
const CHAR_FIX: Readonly<Record<string, string>> = {
  '\u{0672}': '\u{0670}', // alef with wavy hamza stands in for superscript alef (tajweed text, 1,561×)
  '\u{066E}': '\u{0649}', // dotless beh stands in for alef maksura (tajweed text, 161×)
}

/**
 * Normalises Quran text for display and returns where each input index went (-1 = removed): invisible format
 * characters dropped, space runs collapsed (and trimmed), the stand-ins of CHAR_FIX mapped, and ۩ always set
 * after a space (QPC glues it to the word in 6 of its 15 words, e.g. 27:26 «ٱلۡعَظِيمِ۩»; Amiri would draw it
 * touching the last letter). Never applies Unicode NFC/NFKC (it reorders shadda/fatha — fonts-rendering §1.2).
 */
export function normalizeWithMap(text: string): { text: string; map: number[] } {
  const map: number[] = new Array(text.length).fill(-1)
  let out = ''
  let pendingSpace = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (INVISIBLE.test(c)) continue
    if (SPACE_LIKE.test(c)) {
      if (out.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace || (c === SAJDAH_SIGN && out.length > 0)) {
      out += ' '
      pendingSpace = false
    }
    map[i] = out.length
    out += CHAR_FIX[c] ?? c
  }
  return { text: out, map }
}

/** Display normalisation (see normalizeWithMap): invisible characters dropped, spaces collapsed, ۩ spaced. */
export function normalizeQuranText(text: string): string {
  return normalizeWithMap(text).text
}

/** Picks the kind that matters for stopping when a word carries two marks (only 36:52 «مَّرْقَدِنَا ۜ ۗ»). */
function waqfKindOfMarks(marks: string[]): WaqfKind | null {
  if (marks.length === 0) return null
  const nonSakt = marks.find((m) => m !== SAKTAH)
  return WAQF_KIND_BY_CHAR[nonSakt ?? marks[0]] ?? null
}

/**
 * Splits trailing pause mark(s) — separated by a space/NBSP/ZWNJ (Tanzil) or attached directly (QPC; Tanzil
 * 18:1 «عِوَجَاۜ») — off a word. Marks inside a word (2:245 «وَيَبْصُۜطُ») stay. Returns the raw (un-normalised)
 * rest, which is always a prefix of `text`. Two marks on one word (36:52) come back as "ۜ ۗ".
 */
export function splitWaqfRaw(text: string): { text: string; waqfChar: string | null; waqf: WaqfKind | null } {
  const marks: string[] = []
  let end = text.length
  let cut = end
  for (;;) {
    let j = end
    while (j > 0 && (INVISIBLE.test(text[j - 1]) || MARK_SEPARATOR.test(text[j - 1]))) j--
    if (j > 0 && isWaqfChar(text[j - 1])) {
      marks.unshift(text[j - 1])
      end = j - 1
      cut = end
      continue
    }
    break
  }
  if (marks.length === 0) return { text, waqfChar: null, waqf: null }
  let k = cut
  while (k > 0 && MARK_SEPARATOR.test(text[k - 1])) k--
  const rest = text.slice(0, k)
  if (rest.length === 0) return { text, waqfChar: null, waqf: null } // a bare mark is not a word
  return { text: rest, waqfChar: marks.join(' '), waqf: waqfKindOfMarks(marks) }
}

/** Splits a trailing pause mark (with its separating space/ZWNJ) off a word's text. */
export function splitWaqf(text: string): { text: string; waqfChar: string | null; waqf: WaqfKind | null } {
  const r = splitWaqfRaw(text)
  return { ...r, text: normalizeQuranText(r.text) }
}

// ───────────────────────── display encodings ─────────────────────────

/** QPC's private use of three standard marks: open (staggered) tanween (fonts-rendering §2.3). */
const QPC_OPEN_TANWEEN: Readonly<Record<string, string>> = {
  '\u{0657}': '\u{08F0}', // open fathatan
  '\u{065E}': '\u{08F1}', // open dammatan
  '\u{0656}': '\u{08F2}', // open kasratan
}
/** After a yeh (and its marks), these leave it in final/isolated form: end of word, space, hamza, small waw/yeh. */
const NO_JOIN_AFTER_YEH = /[\s\u{0621}\u{06E5}\u{06E6}]/u

function yehIsFinal(s: string, i: number): boolean {
  let k = i + 1
  while (k < s.length && IS_MN.test(s[k])) k++
  return k >= s.length || NO_JOIN_AFTER_YEH.test(s[k])
}

/**
 * QPC Hafs encoding (text_qpc_hafs, made for the KFGQPC Hafs font) → the standard Unicode the OFL fonts (Amiri
 * Quran) expect. Length-preserving (1:1), idempotent:
 * - U+0657 / U+065E / U+0656 (QPC's open tanween) → U+08F0 / U+08F1 / U+08F2 (fonts-rendering §2.3; raw QPC
 *   leaves U+065E as .notdef in 1,807 words);
 * - a word-final yeh U+064A → U+0649: the Madani Mushaf never dots a final yeh, the KFGQPC font draws QPC's
 *   U+064A dotless there but Amiri dots it («فِي» vs «فِى», 3,464 words). Tanzil (the encoding Amiri follows)
 *   writes U+0649 in exactly those places: the yeh letters agree with words[].text_uthmani in 77,415 of 77,429
 *   words, the other 14 being QPC's hamza seat «يِٕ» (→ «ىِٕ», hamza below as printed) and 11:13 «ٱفۡتَرَىٰهُ».
 */
export function qpcToStandard(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const open = QPC_OPEN_TANWEEN[c]
    if (open) out += open
    else if (c === '\u{064A}' && yehIsFinal(text, i)) out += '\u{0649}'
    else out += c
  }
  return out
}

const FATHATAN = '\u{064B}'
const DAMMATAN = '\u{064C}'
const KASRATAN = '\u{064D}'
const LOW_MEEM = '\u{06ED}'
const HIGH_MEEM = '\u{06E2}'
const HARAKA_OF_TANWEEN: Readonly<Record<string, string>> = { [FATHATAN]: '\u{064E}', [DAMMATAN]: '\u{064F}', [KASRATAN]: '\u{0650}' }
const OPEN_OF_TANWEEN: Readonly<Record<string, string>> = { [FATHATAN]: '\u{08F0}', [DAMMATAN]: '\u{08F1}', [KASRATAN]: '\u{08F2}' }

/**
 * Tanzil Uthmani (alquran.cloud quran-uthmani, = words[].text_uthmani) → the encoding qpcToStandard produces,
 * for the text fallback: Amiri draws Tanzil's tanween + small meem as a stray meem (00-gaps §2.2).
 * - open tanween: fathatan/dammatan + U+06ED and kasratan + U+06E2 → U+08F0 / U+08F1 / U+08F2;
 * - iqlab: fathatan/dammatan + U+06E2 and kasratan + U+06ED → the haraka + that small meem (QPC's form);
 * - sukun U+0652 → U+06E1 and the silent-letter zero U+06DF → U+0652, as in QPC (37,148 and 3,988 each).
 * Measured on the whole-Quran dump: the tanween/meem marks then equal the primary display in 77,429/77,429 words.
 */
export function tanzilToStandard(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if ((c === FATHATAN || c === DAMMATAN || c === KASRATAN) && (next === LOW_MEEM || next === HIGH_MEEM)) {
      const open = c === KASRATAN ? next === HIGH_MEEM : next === LOW_MEEM
      out += open ? OPEN_OF_TANWEEN[c] : HARAKA_OF_TANWEEN[c] + next
      i++
      continue
    }
    if (c === '\u{0652}') out += '\u{06E1}'
    else if (c === '\u{06DF}') out += '\u{0652}'
    else out += c
  }
  return out
}

const TANWEEN_MEEM = /[\u{064B}-\u{064D}][\u{06E2}\u{06ED}]/u

/** True when the text carries Tanzil's tanween + small-meem encoding (Amiri draws the meem). */
export function hasTanweenMeem(text: string): boolean {
  return TANWEEN_MEEM.test(text)
}

// ───────────────────────── tajweed markup ─────────────────────────

/** A rule span over a plain (tag-free) string; depth 0 = outermost. */
export interface RawSpan {
  start: number
  end: number
  cls: string
  depth: number
}

export interface ParsedTajweed {
  /** tag-free text ("P" in quran-text-api §3) */
  plain: string
  spans: RawSpan[]
  /** Arabic-Indic digits of the ayah-end span, if any */
  ayahNumber: string | null
}

const TAG_RE = /<(\/?)([A-Za-z]+)([^>]*)>/g
const END_RE = / ?<span class=['"]?end['"]?>([^<]*)<\/span>\s*$/

/**
 * Parses Quran.com text_uthmani_tajweed: verse level `<tajweed class=X>…</tajweed>` (unquoted attributes,
 * nesting depth 2 in 33 spans, a broken '>'-only opener in 32:3, one more closer than openers) or the
 * word-level `<rule class=X>` variant. Stray '<'/'>' are dropped and unmatched closers ignored
 * (quran-text-api §3.7 step 1). Spans come back sorted by start, outer before inner.
 */
export function parseQuranComTajweed(raw: string): ParsedTajweed {
  const m = END_RE.exec(raw)
  const body = m ? raw.slice(0, m.index) : raw
  let plain = ''
  const stack: { cls: string; start: number }[] = []
  const spans: RawSpan[] = []
  let pos = 0
  for (const t of body.matchAll(TAG_RE)) {
    plain += body.slice(pos, t.index).replace(/[<>]/g, '')
    pos = (t.index ?? 0) + t[0].length
    const tag = t[2].toLowerCase()
    if (tag !== 'tajweed' && tag !== 'rule') continue
    if (t[1] !== '/') {
      const cm = /class=['"]?([A-Za-z_-]+)/.exec(t[3])
      stack.push({ cls: cm ? cm[1] : 'unknown', start: plain.length })
    } else {
      const open = stack.pop()
      if (open && plain.length > open.start) spans.push({ start: open.start, end: plain.length, cls: open.cls, depth: stack.length })
    }
  }
  plain += body.slice(pos).replace(/[<>]/g, '')
  spans.sort((a, b) => a.start - b.start || a.depth - b.depth)
  return { plain, spans, ayahNumber: m ? m[1].trim() : null }
}

/** alquran.cloud `quran-tajweed` codes → Quran.com classes (quran-text-api §3.2, measured 1:1). */
export const ALQURAN_CLOUD_TAJWEED_CODES: Readonly<Record<string, TajweedRuleId>> = {
  h: 'ham_wasl',
  s: 'slnt',
  l: 'laam_shamsiyah',
  n: 'madda_normal',
  p: 'madda_permissible',
  m: 'madda_necessary',
  o: 'madda_obligatory',
  q: 'qalaqah',
  c: 'ikhafa_shafawi',
  f: 'ikhafa',
  w: 'idgham_shafawi',
  i: 'iqlab',
  a: 'idgham_ghunnah',
  u: 'idgham_wo_ghunnah',
  d: 'idgham_mutajanisayn',
  b: 'idgham_mutaqaribayn',
  g: 'ghunnah',
}

/**
 * Parses alquran.cloud `quran-tajweed` markup (`[h:123[ٱ]`, `[n[ـٰ]`, nested `[o[ُوٓ[s[اْ](ZWNJ)ۚ]`, and a
 * class-less `[ٮٰ]` in 32:3). Its plain text equals Quran.com's tajweed plain text in 6,235/6,236 verses.
 */
export function parseAlquranCloudTajweed(raw: string): ParsedTajweed {
  let plain = ''
  const stack: { cls: string | null; start: number }[] = []
  const spans: RawSpan[] = []
  const OPEN = /^\[([a-z])(?::\d+)?\[/
  let i = 0
  while (i < raw.length) {
    const c = raw[i]
    if (c === '[') {
      const m = OPEN.exec(raw.slice(i, i + 16))
      if (m) {
        stack.push({ cls: ALQURAN_CLOUD_TAJWEED_CODES[m[1]] ?? `code_${m[1]}`, start: plain.length })
        i += m[0].length
      } else {
        stack.push({ cls: null, start: plain.length }) // class-less opener (32:3)
        i++
      }
      continue
    }
    if (c === ']') {
      const open = stack.pop()
      if (open && open.cls && plain.length > open.start) spans.push({ start: open.start, end: plain.length, cls: open.cls, depth: stack.length })
      i++
      continue
    }
    plain += c
    i++
  }
  spans.sort((a, b) => a.start - b.start || a.depth - b.depth)
  return { plain, spans, ayahNumber: null }
}

// ───────────────────────── word ranges (quran-text-api §3.7) ─────────────────────────

const RUB_EL_HIZB = '\u{06DE}'
const SKELETON_DROP = new Set(['\u{0640}', '\u{200C}', '\u{200F}', '\u{200E}', '\u{FEFF}', ' ', RUB_EL_HIZB, SAJDAH_SIGN, '\u{0672}', '\u{00A0}'])
const SKELETON_FOLD: Readonly<Record<string, string>> = {
  '\u{0671}': '\u{0627}',
  '\u{0623}': '\u{0627}',
  '\u{0625}': '\u{0627}',
  '\u{0622}': '\u{0627}',
  '\u{066E}': '\u{064A}',
  '\u{0649}': '\u{064A}',
  '\u{0626}': '\u{064A}',
  '\u{0624}': '\u{0648}',
  '\u{06CC}': '\u{064A}',
}
const MARK_OR_DIGIT = /[\p{M}\p{Nd}]/u

/** Letters-only skeleton used to group tajweed tokens into words[] entries. */
export function skeleton(s: string): string {
  let out = ''
  for (const ch of s) {
    if (SKELETON_DROP.has(ch) || MARK_OR_DIGIT.test(ch)) continue
    out += SKELETON_FOLD[ch] ?? ch
  }
  return out
}

/**
 * [start, end) of each word inside the tajweed plain text. Tokens are split on U+0020 only (ZWNJ-glued pause
 * marks stay with their word); token merges: a leading ۞ token joins the next word, pause-only and ۩ tokens
 * join the previous word, and a word whose skeleton spans two tokens (8:6 «بَعْدَ مَا», 37:130 «إِلْ يَاسِينَ»)
 * absorbs both. `wordTexts` = words[].text_uthmani (grouping against QPC skeletons was never validated).
 * Throws when tokens run out or are left over (never happened on 6,236 verses).
 */
export function wordRanges(plain: string, wordTexts: string[]): [number, number][] {
  const tokens = plain.split(' ')
  const offs: [number, number][] = []
  let acc = 0
  for (const t of tokens) {
    offs.push([acc, acc + t.length])
    acc += t.length + 1
  }
  const groups: [number, number][] = []
  let i = 0
  let pendingRub: number | null = null
  for (let wi = 0; wi < wordTexts.length; wi++) {
    const target = skeleton(wordTexts[wi])
    if (i >= tokens.length) throw new Error(`ran out of tokens at word ${wi + 1}`)
    let start = i
    if (pendingRub !== null) {
      start = pendingRub
      pendingRub = null
    }
    let cur = skeleton(tokens[i])
    while (cur === '' && i + 1 < tokens.length) cur = skeleton(tokens[++i])
    while (cur !== target && i + 1 < tokens.length) {
      const nxt = skeleton(tokens[i + 1])
      if (!nxt || !target.startsWith(cur + nxt)) break
      i++
      cur += nxt
    }
    groups.push([start, i])
    i++
    while (i < tokens.length && skeleton(tokens[i]) === '') {
      if (tokens[i].startsWith(RUB_EL_HIZB)) {
        pendingRub = i
        i++
        break
      }
      groups[groups.length - 1][1] = i
      i++
    }
  }
  if (i !== tokens.length || pendingRub !== null) throw new Error(`${tokens.length - i} tokens left over`)
  return groups.map(([a, b]) => [offs[a][0], offs[b][1]])
}

// ───────────────────────── class projection (00-gaps §2.1) ─────────────────────────

/** Innermost class per character of plain[a, b). */
export function charClasses(spans: RawSpan[], a: number, b: number): (string | null)[] {
  const out: (string | null)[] = new Array(Math.max(0, b - a)).fill(null)
  const depth: number[] = new Array(Math.max(0, b - a)).fill(-1)
  for (const s of spans) {
    const lo = Math.max(s.start, a)
    const hi = Math.min(s.end, b)
    for (let i = lo; i < hi; i++) {
      if (s.depth >= depth[i - a]) {
        out[i - a] = s.cls
        depth[i - a] = s.depth
      }
    }
  }
  return out
}

export type Opcode = ['equal' | 'replace' | 'delete' | 'insert', number, number, number, number]

/**
 * Python's difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes(), ported line by line (no junk, no
 * popularity pruning): longest matching block first, recursively on both sides, adjacent blocks collapsed.
 * The projection must match the research script exactly, and LCS would pair characters differently.
 */
export function opcodes(a: readonly string[], b: readonly string[]): Opcode[] {
  const b2j = new Map<string, number[]>()
  b.forEach((x, j) => {
    const list = b2j.get(x)
    if (list) list.push(j)
    else b2j.set(x, [j])
  })
  const NONE: number[] = []
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo
    let bestj = blo
    let bestsize = 0
    let j2len = new Map<number, number>()
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>()
      for (const j of b2j.get(a[i]) ?? NONE) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) ?? 0) + 1
        next.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
      j2len = next
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--
      bestj--
      bestsize++
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++
    return [besti, bestj, bestsize]
  }
  const blocks: [number, number, number][] = []
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number]
    const [i, j, k] = longest(alo, ahi, blo, bhi)
    if (k > 0) {
      blocks.push([i, j, k])
      if (alo < i && blo < j) queue.push([alo, i, blo, j])
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
    }
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2])
  const merged: [number, number, number][] = []
  let [i1, j1, k1] = [0, 0, 0]
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2
    else {
      if (k1) merged.push([i1, j1, k1])
      ;[i1, j1, k1] = [i2, j2, k2]
    }
  }
  if (k1) merged.push([i1, j1, k1])
  merged.push([a.length, b.length, 0])
  const out: Opcode[] = []
  let i = 0
  let j = 0
  for (const [ai, bj, size] of merged) {
    const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : null
    if (tag) out.push([tag, i, ai, j, bj])
    i = ai + size
    j = bj + size
    if (size) out.push(['equal', ai, i, bj, j])
  }
  return out
}

/** Canonical equivalence for matching (00-gaps §2.1 + the open tanween qpcToStandard writes). */
const PROJECT_CANON: Readonly<Record<string, string>> = {
  '\u{0657}': 'F',
  '\u{064B}': 'F',
  '\u{08F0}': 'F',
  '\u{065E}': 'D',
  '\u{064C}': 'D',
  '\u{08F1}': 'D',
  '\u{0656}': 'K',
  '\u{064D}': 'K',
  '\u{08F2}': 'K',
  '\u{0652}': 'S',
  '\u{06E1}': 'S',
  '\u{06DF}': 'S',
  '\u{064A}': 'Y',
  '\u{0649}': 'Y',
  '\u{066E}': 'Y',
  '\u{0672}': '\u{0670}',
}
const canon = (c: string): string => PROJECT_CANON[c] ?? c
/** dropped from the source side: tatweel, ZWNJ, RLM and the stray '>' of 32:3 */
const PROJECT_SRC_DROP = new Set(['\u{0640}', '\u{200C}', '\u{200F}', '>'])
const TATWEEL = '\u{0640}'

/**
 * Projects the per-character tajweed classes of a source word slice (verse-level plain text, `srcCls` from
 * charClasses) onto a target string — research/scripts/gaps/tajweed_projection_check.py project(), ported:
 * difflib opcodes over canonical keys (tatweel left out of the target); equal and equal-length replaced runs map
 * 1:1; in a longer/shorter replaced run a mark takes the class of the next source character, a letter the run's
 * first class; target-only marks (e.g. U+06ED) take the class of the next source character, other target-only
 * characters that of the previous one; a target tatweel takes the class of the mark after it (ـٰ), else of the
 * previous character; whitespace is never coloured. `clean` is false when a coloured source character had to be
 * matched to an unequal one (the script's "not exact"; the class still lands on the right letters).
 */
export function project(src: string, srcCls: (string | null)[], target: string): { classes: (string | null)[]; clean: boolean } {
  const t: [string, string | null][] = []
  for (let k = 0; k < src.length; k++) if (!PROJECT_SRC_DROP.has(src[k])) t.push([src[k], srcCls[k] ?? null])
  const qIdx: number[] = []
  for (let i = 0; i < target.length; i++) if (target[i] !== TATWEEL) qIdx.push(i)
  const qa = qIdx.map((i) => canon(target[i]))
  const ta = t.map(([c]) => canon(c))
  const out: (string | null)[] = new Array(target.length).fill(null)
  let clean = true
  const coloured = (j1: number, j2: number) => t.slice(j1, j2).some(([, k]) => !!k)
  for (const [op, i1, i2, j1, j2] of opcodes(qa, ta)) {
    if (op === 'equal' || (op === 'replace' && i2 - i1 === j2 - j1)) {
      for (let x = 0; x < i2 - i1; x++) out[qIdx[i1 + x]] = t[j1 + x][1]
      if (op === 'replace' && coloured(j1, j2)) clean = false
    } else if (op === 'replace') {
      if (coloured(j1, j2)) clean = false
      const ks = t
        .slice(j1, j2)
        .map(([, k]) => k)
        .filter((k): k is string => !!k)
      for (let x = i1; x < i2; x++) {
        const ch = target[qIdx[x]]
        if (IS_SPACE.test(ch)) continue
        if (IS_MN.test(ch)) out[qIdx[x]] = j2 < t.length ? t[j2][1] : ks.length ? ks[ks.length - 1] : null
        else out[qIdx[x]] = ks.length ? ks[0] : null
      }
    } else if (op === 'delete') {
      const nxt = j1 < t.length ? t[j1][1] : null
      const prv = j1 > 0 ? t[j1 - 1][1] : null
      for (let x = i1; x < i2; x++) {
        const ch = target[qIdx[x]]
        if (IS_SPACE.test(ch)) continue
        out[qIdx[x]] = IS_MN.test(ch) ? nxt : prv
      }
    }
    // 'insert' (source-only characters): nothing lands on the target
  }
  for (let i = 0; i < target.length; i++) {
    if (target[i] !== TATWEEL) continue
    const nxt = i + 1 < target.length ? target[i + 1] : ''
    if (nxt && IS_MN.test(nxt)) out[i] = out[i + 1]
    else if (i > 0) out[i] = out[i - 1]
  }
  for (let i = 0; i < target.length; i++) if (IS_SPACE.test(target[i])) out[i] = null
  return { classes: out, clean }
}

/** Consecutive equal classes → spans ([start, end) offsets into the text), non-overlapping, in order. */
export function classesToSpans(classes: (string | null)[]): TajweedSpan[] {
  const spans: TajweedSpan[] = []
  let k = 0
  while (k < classes.length) {
    const c = classes[k]
    if (!c) {
      k++
      continue
    }
    let e = k + 1
    while (e < classes.length && classes[e] === c) e++
    spans.push({ start: k, end: e, rule: c })
    k = e
  }
  return spans
}

/**
 * Parses one verse of text_uthmani_tajweed into word tokens (split on spaces, ayah-end span dropped).
 * Each token's text is normalised and carries its spans; a pause mark glued on with ZWNJ is returned
 * separately. NB tokens are not words[] entries in 216 verses (۞, ۩, 8:6, 37:130) — fetchAyahs groups them.
 */
export function parseTajweedVerse(html: string): { text: string; spans: TajweedSpan[]; waqfChar: string | null }[] {
  const { plain, spans } = parseQuranComTajweed(html)
  const out: { text: string; spans: TajweedSpan[]; waqfChar: string | null }[] = []
  let acc = 0
  for (const tok of plain.split(' ')) {
    const a = acc
    acc += tok.length + 1
    if (tok.length === 0) continue
    const split = splitWaqfRaw(tok)
    const body = split.text
    const cls = charClasses(spans, a, a + body.length)
    const norm = normalizeWithMap(body)
    const ncls: (string | null)[] = new Array(norm.text.length).fill(null)
    norm.map.forEach((to, from) => {
      if (to >= 0) ncls[to] = cls[from]
    })
    out.push({ text: norm.text, spans: classesToSpans(ncls), waqfChar: split.waqfChar })
  }
  return out
}

// ───────────────────────── building Word[] ─────────────────────────

/** One words[] entry of a verse. */
export interface WordSource {
  /** words[].text_uthmani (Tanzil encoding): the §3.7 grouping skeleton and the pause-mark guard (D1) */
  tanzil: string
  /**
   * words[].text_qpc_hafs → the display text and the printed pause mark. null = no QPC text (the alquran.cloud
   * fallback): the display is then tanzilToStandard(tanzil) and the printed mark Tanzil's.
   */
  qpc: string | null
}

/** A built word plus how its tajweed projection went (for audits). */
export interface BuiltWord {
  word: Word
  /** the standard-encoded display source the classes were projected onto (before the pause mark is split off) */
  display: string
  /** project() met no coloured mismatch (null without tajweed) */
  clean: boolean | null
  /** classes of the source slice that reached no character of `display` (the research script's "rule lost") */
  lostClasses: string[]
}

/**
 * Builds one display word: text = the standard-encoded display source without its trailing pause mark(s),
 * normalised; waqf = the Tanzil mark's kind (guard), waqfChar = the mark printed in the display source; tajweed =
 * spans of the classes projected from the source slice (when given).
 */
export function buildWord(position: number, src: WordSource, slice: { text: string; classes: (string | null)[] } | null): BuiltWord {
  const guard = splitWaqfRaw(src.tanzil)
  const display = src.qpc !== null ? qpcToStandard(src.qpc) : tanzilToStandard(src.tanzil)
  let classes: (string | null)[] | null = null
  let clean: boolean | null = null
  const lostClasses: string[] = []
  if (slice) {
    const p = project(slice.text, slice.classes, display)
    classes = p.classes
    clean = p.clean
    const got = new Set(classes.filter((c): c is string => !!c))
    for (const c of new Set(slice.classes.filter((k): k is string => !!k))) if (!got.has(c)) lostClasses.push(c)
  }
  const shown = splitWaqfRaw(display)
  const norm = normalizeWithMap(shown.text)
  const ncls: (string | null)[] = new Array(norm.text.length).fill(null)
  if (classes) {
    norm.map.forEach((to, from) => {
      if (to >= 0) ncls[to] = (classes as (string | null)[])[from]
    })
  }
  return {
    word: { position, text: norm.text, waqf: guard.waqf, waqfChar: shown.waqfChar, tajweed: classesToSpans(ncls) },
    display,
    clean,
    lostClasses,
  }
}

/**
 * Builds the display words of one ayah (buildWord for each words[] entry, positions 1..N). The tajweed markup is
 * grouped against the Tanzil skeletons (§3.7) and projected word by word. Never throws: when the markup cannot be
 * aligned the words carry no tajweed (alignmentFailed: true).
 */
export function buildWords(sources: WordSource[], tajweed: ParsedTajweed | null): { words: Word[]; built: BuiltWord[]; alignmentFailed: boolean } {
  let ranges: [number, number][] | null = null
  if (tajweed) {
    try {
      ranges = wordRanges(
        tajweed.plain,
        sources.map((s) => s.tanzil),
      )
    } catch {
      ranges = null
    }
  }
  const built = sources.map((src, k) => {
    if (!tajweed || !ranges) return buildWord(k + 1, src, null)
    const [a, b] = ranges[k]
    return buildWord(k + 1, src, { text: tajweed.plain.slice(a, b), classes: charClasses(tajweed.spans, a, b) })
  })
  return { words: built.map((b) => b.word), built, alignmentFailed: tajweed !== null && ranges === null }
}
