// Wrapping for non-Quran text (translation, tafsir, credits) measured through Painter.measureText. Nothing here
// shortens text: licensed tafsir and translations are paged, never cut with "…" (research/00-gaps.md C13/D6).
import type { TextStyle } from '../core/types'

export type Measure = (text: string, style: TextStyle) => number

type Granularity = 'word' | 'grapheme'

/** Word or grapheme segments (Intl.Segmenter where the engine has it — Thai, Khmer, CJK have no spaces); else code points. */
function segments(text: string, granularity: Granularity): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (typeof Seg === 'function') return Array.from(new Seg(undefined, { granularity }).segment(text), (x) => x.segment)
  return Array.from(text)
}

/** Packs pieces greedily into lines that fit; a piece that is still too wide is split into graphemes. */
function pack(pieces: string[], maxWidth: number, style: TextStyle, measure: Measure, granularity: Granularity): string[] {
  const out: string[] = []
  let cur = ''
  for (const piece of pieces) {
    if (!cur || measure(cur + piece, style) <= maxWidth) {
      cur += piece
      continue
    }
    out.push(cur)
    cur = piece
  }
  if (cur) out.push(cur)
  if (granularity === 'grapheme') return out
  return out.flatMap((line) => (measure(line, style) > maxWidth ? pack(segments(line, 'grapheme'), maxWidth, style, measure, 'grapheme') : [line]))
}

/** Splits a token wider than maxWidth into pieces that fit: at word boundaries first (scripts without spaces), then graphemes. */
function splitLong(token: string, maxWidth: number, style: TextStyle, measure: Measure): string[] {
  return pack(segments(token, 'word'), maxWidth, style, measure, 'word')
}

/** No-break space: glues an ayah number to its text so it never sits alone on a line. */
export const NBSP = '\u00A0'

/** Greedy wrap; paragraph breaks ("\n") start a new line; never breaks at a no-break space. */
export function wrapText(text: string, maxWidth: number, style: TextStyle, measure: Measure): string[] {
  const lines: string[] = []
  for (const para of text.split(/\n+/)) {
    const words = para.split(/[^\S\u00A0]+/).filter(Boolean)
    let cur = ''
    for (const word of words) {
      const candidate = cur ? cur + ' ' + word : word
      if (measure(candidate, style) <= maxWidth) {
        cur = candidate
        continue
      }
      if (cur) lines.push(cur)
      if (measure(word, style) <= maxWidth) cur = word
      else {
        const pieces = splitLong(word, maxWidth, style, measure)
        lines.push(...pieces.slice(0, -1))
        cur = pieces[pieces.length - 1] ?? ''
      }
    }
    if (cur) lines.push(cur)
  }
  return lines
}

/** Separators of a credit line ("work — author · host"), outermost first. */
export const CREDIT_SEPARATORS = [' · ', ' — '] as const

/**
 * Wraps a credit line between its parts only, never inside a name or a host ("Quran.com / Quran Foundation"): at
 * " · " first, then at " — " inside a part that is still too wide; at words only when a single part is wider than a
 * whole line. A break replaces its separator. Never shortens.
 */
export function wrapCredit(text: string, maxWidth: number, style: TextStyle, measure: Measure, separators: readonly string[] = CREDIT_SEPARATORS): string[] {
  const [sep, ...inner] = separators
  if (sep === undefined) return wrapText(text, maxWidth, style, measure)
  const lines: string[] = []
  let cur = ''
  for (const part of text.split(sep)) {
    const candidate = cur ? cur + sep + part : part
    if (measure(candidate, style) <= maxWidth) {
      cur = candidate
      continue
    }
    if (cur) lines.push(cur)
    if (measure(part, style) <= maxWidth) cur = part
    else {
      const pieces = wrapCredit(part, maxWidth, style, measure, inner)
      lines.push(...pieces.slice(0, -1))
      cur = pieces[pieces.length - 1] ?? ''
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Shrinks a single line's font size (down to minScale) until it fits; returns the scale used. */
export function fitLineScale(text: string, maxWidth: number, style: TextStyle, measure: Measure, minScale = 0.75): number {
  const w = measure(text, style)
  if (w <= maxWidth) return 1
  return Math.max(minScale, maxWidth / w)
}
