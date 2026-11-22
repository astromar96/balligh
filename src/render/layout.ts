// Quran text layout over HarfBuzz-shaped words: units (word / ayah-number ornament), greedy RTL line
// breaking with the font's space advance, balanced lines, auto-fit by binary search, pagination that
// prefers ayah ends and pause marks, and the time at which each page starts. Pure: no Painter here.
import type { Ayah, RenderModel, TajweedRuleId, Timeline, WaqfKind } from '../core/types'
import type { QuranFont, ShapedRun } from './index'
import { charRules, glyphRules } from './tajweed'
import { arabicDigits, pathBounds } from './util'

export type GlyphRole = 'text' | 'waqf' | 'number'

export interface UnitGlyph {
  gid: number
  /** glyph origin, font units, from the unit's left edge (offsets applied) */
  x: number
  /** baseline shift, font units, positive = up */
  y: number
  role: GlyphRole
  rule: TajweedRuleId | null
}

export interface QUnit {
  kind: 'word' | 'number'
  /** index into model.ayahs */
  ayahIndex: number
  ayah: number
  /** word position (Quran.com numbering); 0 for an ayah number */
  position: number
  /** advance in font units */
  advance: number
  glyphs: UnitGlyph[]
  /** must stay on the same line as the unit before it (ayah numbers never start a line) */
  glue: boolean
  /** page-break quality after this unit: 2 = ayah end, 1 = pause mark where stopping is allowed */
  breakAfter: 0 | 1 | 2
  /** UTF-16 length of the word, to spread an ayah's duration when there are no word timings */
  weight: number
}

export interface QLine {
  units: QUnit[]
  /** font units, spaces included */
  width: number
}

export interface QPage {
  lines: QLine[]
  /** index of the first unit (into the units array) */
  first: number
  /** exclusive */
  end: number
}

export interface LineMetrics {
  /** ink above the first baseline, em */
  top: number
  /** ink below the last baseline, em */
  bottom: number
  /** baseline-to-baseline distance, em */
  pitch: number
}

const STOP_OK: ReadonlySet<WaqfKind> = new Set(['lazim', 'jaiz', 'waqf_awla', 'wasl_awla'])

export const AYAH_END = '۝'
/**
 * «بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ» in the encoding of the display text, qpcToStandard(text_qpc_hafs) of 1:1
 * (research/00-gaps.md §2.2; QPC writes sukun as U+06E1), so it matches the Quran text drawn under it.
 */
export const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ'
/**
 * «أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيۡطَٰنِ ٱلرَّجِيمِ», the wording of 16:98, in the same encoding: «أَعُوذُ» as QPC writes it
 * in 2:67, the rest as in 16:98. Not Quran text, so it is never coloured or highlighted per word.
 */
export const ISTIADHA = 'أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيۡطَٰنِ ٱلرَّجِيمِ'

function placeRun(run: ShapedRun): { gid: number; cluster: number; x: number; y: number }[] {
  let pen = 0
  return run.glyphs.map((g) => {
    const out = { gid: g.gid, cluster: g.cluster, x: pen + g.xOffset, y: g.yOffset }
    pen += g.xAdvance
    return out
  })
}

export interface UnitOptions {
  waqf: boolean
  numbers: boolean
  tajweed: boolean
}

const SAKT = 'ۜ'

/**
 * A word's pause marks (Word.waqfChar, e.g. "ۚ", "ۜ", or 36:52's "ۜ ۗ"): the sakt mark is written on the
 * word itself; the other mark (the last one, if several) sits in the gap after the word.
 */
export function splitPauseMarks(waqfChar: string | null): { sakt: string; gap: string | null } {
  const marks = [...(waqfChar ?? '').replace(/\s+/g, '')]
  const others = marks.filter((m) => m !== SAKT)
  return { sakt: marks.filter((m) => m === SAKT).join(''), gap: others.length ? others[others.length - 1] : null }
}

/** Pause-mark ink starts this far above the baseline (em): just over the letter tops, between words. */
const WAQF_BOTTOM_EM = 0.86
/** horizontal breathing room around a pause mark (em) */
const WAQF_PAD_EM = 0.08

/**
 * Shapes a word and places its pause mark in the gap after it (to its left). Fonts like Amiri Quran
 * draw these marks at 1.3–1.8 em — above the tallest harakat, which drifts into the line above at
 * Mushaf line spacing — so the mark is re-seated: centred in its own gap, ink bottom at WAQF_BOTTOM_EM.
 * The sakt mark (ۜ) is attached to the last letter by the font's anchors and is left as shaped.
 */
function shapeWord(font: QuranFont, text: string, waqfChar: string | null, showWaqf: boolean) {
  const marks = showWaqf ? splitPauseMarks(waqfChar) : { sakt: '', gap: null }
  const run = font.shape(text + marks.sakt, 'rtl')
  const word = placeRun(run)
  if (!marks.gap) return { advance: run.advance, glyphs: word }
  const markRun = font.shape(' ' + marks.gap, 'rtl')
  const mark = markRun.glyphs.find((g) => g.cluster >= 1 && font.glyphSvg(g.gid))
  const space = markRun.advance || font.upem * 0.3
  if (!mark) return { advance: run.advance, glyphs: word }
  const b = pathBounds(font.glyphSvg(mark.gid))
  const markW = b ? b.xMax - b.xMin : font.upem * 0.4
  const gap = Math.max(space, markW + 2 * WAQF_PAD_EM * font.upem)
  const mx = b ? gap / 2 - (b.xMin + b.xMax) / 2 : gap / 2
  const my = b ? WAQF_BOTTOM_EM * font.upem - b.yMin : 0
  return {
    advance: gap + run.advance,
    glyphs: [
      // cluster text.length + 1 marks it as the pause mark (beyond the word's characters)
      { gid: mark.gid, cluster: text.length + 1, x: mx, y: my },
      ...word.map((g) => ({ ...g, x: g.x + gap })),
    ],
  }
}

/** Shapes every selected word (+ ayah-number ornaments) into drawable units, in reading order. */
export function buildUnits(model: RenderModel, font: QuranFont, opts: UnitOptions): QUnit[] {
  const units: QUnit[] = []
  model.ayahs.forEach((ayah: Ayah, ayahIndex) => {
    const words = ayah.words.filter((w) => w.text.length > 0)
    const isLast = ayahIndex === model.ayahs.length - 1
    const endsAyah = !(isLast && model.partialEnd)
    words.forEach((w, wi) => {
      const shaped = shapeWord(font, w.text, w.waqfChar, opts.waqf)
      const placed = shaped.glyphs
      const rules = opts.tajweed && w.tajweed.length ? glyphRules(placed.map((g) => g.cluster), w.text.length, charRules(w.text.length, w.tajweed)) : null
      const lastWord = wi === words.length - 1
      units.push({
        kind: 'word',
        ayahIndex,
        ayah: ayah.number,
        position: w.position,
        advance: shaped.advance,
        glyphs: placed.map((g, i) => ({
          gid: g.gid,
          x: g.x,
          y: g.y,
          role: g.cluster >= w.text.length ? 'waqf' : 'text',
          rule: rules ? rules[i] : null,
        })),
        glue: false,
        breakAfter: lastWord && endsAyah && !opts.numbers ? 2 : w.waqf && STOP_OK.has(w.waqf) ? 1 : 0,
        weight: Math.max(1, w.text.length),
      })
    })
    if (opts.numbers && endsAyah && words.length) {
      const run = font.shape(AYAH_END + arabicDigits(ayah.number), 'ltr')
      units.push({
        kind: 'number',
        ayahIndex,
        ayah: ayah.number,
        position: 0,
        advance: run.advance,
        glyphs: placeRun(run).map((g) => ({ gid: g.gid, x: g.x, y: g.y, role: 'number' as const, rule: null })),
        glue: true,
        breakAfter: 2,
        weight: 0,
      })
    }
  })
  return units
}

/** Chunks = a unit plus the glued units after it; lines break only between chunks. */
function chunks(units: QUnit[], space: number): { units: QUnit[]; width: number }[] {
  const out: { units: QUnit[]; width: number }[] = []
  for (const u of units) {
    const last = out[out.length - 1]
    if (u.glue && last) {
      last.units.push(u)
      last.width += space + u.advance
    } else out.push({ units: [u], width: u.advance })
  }
  return out
}

export function widestChunk(units: QUnit[], space: number): number {
  let w = 0
  for (const c of chunks(units, space)) w = Math.max(w, c.width)
  return w
}

/** Greedy line breaking (font units). A chunk wider than maxWidth gets a line of its own. */
export function breakLines(units: QUnit[], maxWidth: number, space: number): QLine[] {
  const lines: QLine[] = []
  let cur: QUnit[] = []
  let w = 0
  for (const c of chunks(units, space)) {
    if (cur.length && w + space + c.width > maxWidth) {
      lines.push({ units: cur, width: w })
      cur = []
      w = 0
    }
    w += (cur.length ? space : 0) + c.width
    cur.push(...c.units)
  }
  if (cur.length) lines.push({ units: cur, width: w })
  return lines
}

/** Same line count as greedy at maxWidth, but the narrowest width that achieves it (even, calm lines). */
export function balancedLines(units: QUnit[], maxWidth: number, space: number): QLine[] {
  const greedy = breakLines(units, maxWidth, space)
  if (greedy.length <= 1) return greedy
  let lo = Math.max(widestChunk(units, space), maxWidth / 2)
  let hi = maxWidth
  if (breakLines(units, lo, space).length <= greedy.length) return breakLines(units, lo, space)
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (breakLines(units, mid, space).length <= greedy.length) hi = mid
    else lo = mid
  }
  return breakLines(units, hi, space)
}

export const blockHeight = (lines: number, size: number, m: LineMetrics): number =>
  lines <= 0 ? 0 : (m.top + (lines - 1) * m.pitch + m.bottom) * size

export const linesThatFit = (height: number, size: number, m: LineMetrics): number =>
  Math.max(1, Math.floor((height / size - m.top - m.bottom) / m.pitch + 1e-9) + 1)

/**
 * Pages of at most maxLines lines (the first page: firstMaxLines, e.g. under the basmala); a page prefers to end
 * after an ayah, then after a pause mark where stopping is allowed.
 */
export function paginate(units: QUnit[], maxWidth: number, space: number, maxLines: number, firstMaxLines = maxLines): QPage[] {
  const pages: QPage[] = []
  let start = 0
  while (start < units.length) {
    const rest = units.slice(start)
    const lines = breakLines(rest, maxWidth, space)
    const cap = Math.max(1, pages.length ? maxLines : firstMaxLines)
    if (lines.length <= cap) {
      pages.push({ lines: balancedLines(rest, maxWidth, space), first: start, end: units.length })
      break
    }
    let count = 0
    for (let i = 0; i < cap; i++) count += lines[i].units.length
    let cut = start + count
    const minCut = start + Math.max(1, Math.ceil(count * 0.55))
    search: for (const quality of [2, 1] as const) {
      for (let j = start + count - 1; j >= minCut - 1; j--) {
        if (units[j].breakAfter >= quality && !(units[j + 1]?.glue ?? false)) {
          cut = j + 1
          break search
        }
      }
    }
    const pageUnits = units.slice(start, cut)
    pages.push({ lines: balancedLines(pageUnits, maxWidth, space), first: start, end: cut })
    start = cut
  }
  return pages
}

export interface QuranFit {
  /** px in the layout's reference space */
  size: number
  pages: QPage[]
  /** true when the text needed more than one page */
  paginated: boolean
}

export interface FitBounds {
  min: number
  max: number
  /** size used when the text cannot fit on one page even at min */
  page: number
}

/**
 * Largest size in [min, max] at which everything fits on one page of `height`, times fontScale; when the text does
 * not fit at min (or fontScale pushes it over), it is paginated at page×fontScale (or the scaled size): the first
 * page holds what fits in `height`, every later page what fits in `restHeight` (default: the same).
 */
export function fitQuran(
  units: QUnit[],
  font: QuranFont,
  space: number,
  width: number,
  height: number,
  bounds: FitBounds,
  fontScale: number,
  metrics: LineMetrics,
  restHeight = height,
): QuranFit {
  const upem = font.upem
  if (!units.length) return { size: bounds.max, pages: [], paginated: false }
  const widest = widestChunk(units, space)
  // never let one chunk (a long word + its ayah number) overflow the line
  const widthCap = (width * upem) / Math.max(1, widest)
  const fitsOnePage = (s: number) =>
    s <= widthCap && blockHeight(breakLines(units, (width * upem) / s, space).length, s, metrics) <= height + 1e-6
  let fitted: number | null = null
  const hiBound = Math.min(bounds.max, widthCap)
  if (fitsOnePage(hiBound)) fitted = hiBound
  else if (fitsOnePage(Math.min(bounds.min, widthCap))) {
    let lo = Math.min(bounds.min, widthCap)
    let hi = hiBound
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2
      if (fitsOnePage(mid)) lo = mid
      else hi = mid
    }
    fitted = lo
  }
  const scale = fontScale > 0 ? fontScale : 1
  let size = Math.min((fitted ?? bounds.page) * scale, widthCap)
  if (fitted !== null && fitsOnePage(size)) {
    return { size, pages: [{ lines: balancedLines(units, (width * upem) / size, space), first: 0, end: units.length }], paginated: false }
  }
  size = Math.min(size, widthCap)
  const pages = paginate(units, (width * upem) / size, space, linesThatFit(restHeight, size, metrics), linesThatFit(height, size, metrics))
  return { size, pages, paginated: pages.length > 1 }
}

/** Ink extents (em) of the given units' glyphs, from the outlines' bounding boxes. */
export function inkExtents(units: QUnit[], font: QuranFont): { top: number; bottom: number } {
  let top = 0
  let bottom = 0
  const seen = new Map<number, { yMin: number; yMax: number } | null>()
  for (const u of units) {
    for (const g of u.glyphs) {
      let b = seen.get(g.gid)
      if (b === undefined) {
        const pb = pathBounds(font.glyphSvg(g.gid))
        b = pb ? { yMin: pb.yMin, yMax: pb.yMax } : null
        seen.set(g.gid, b)
      }
      if (!b) continue
      top = Math.max(top, b.yMax + g.y)
      bottom = Math.max(bottom, -(b.yMin + g.y))
    }
  }
  return { top: top / font.upem, bottom: bottom / font.upem }
}

// ── timing ──

export interface UnitTiming {
  /** start of each unit in output ms (NaN when unknown), monotone after fill */
  starts: number[]
}

/**
 * When each unit starts being recited: the word's own window when the timeline has word timings,
 * otherwise its ayah's window spread by word length. Ayah-number units take the previous word's time.
 */
export function unitStarts(units: QUnit[], timeline: Timeline | null): number[] {
  const starts = units.map(() => Number.NaN)
  if (!timeline) return starts
  const wordStart = new Map<string, number>()
  for (const w of timeline.words) {
    const k = `${w.ayah}:${w.word}`
    if (!wordStart.has(k)) wordStart.set(k, w.startMs)
  }
  const ayahWin = new Map<number, { startMs: number; endMs: number }>()
  for (const a of timeline.ayahs) if (a.ayah > 0 && !ayahWin.has(a.ayah)) ayahWin.set(a.ayah, a)
  // per-ayah weights for the estimate
  const totals = new Map<number, number>()
  for (const u of units) totals.set(u.ayah, (totals.get(u.ayah) ?? 0) + u.weight)
  const done = new Map<number, number>()
  units.forEach((u, i) => {
    const before = done.get(u.ayah) ?? 0
    done.set(u.ayah, before + u.weight)
    const ws = u.kind === 'word' ? wordStart.get(`${u.ayah}:${u.position}`) : undefined
    if (ws !== undefined) starts[i] = ws
    else {
      const win = ayahWin.get(u.ayah)
      const total = totals.get(u.ayah) ?? 0
      if (win && total > 0 && u.kind === 'word') starts[i] = win.startMs + ((win.endMs - win.startMs) * before) / total
    }
  })
  // fill unknowns from the previous known start; keep monotone
  let last = 0
  for (let i = 0; i < starts.length; i++) {
    if (Number.isNaN(starts[i])) starts[i] = last
    else starts[i] = Math.max(starts[i], last)
    last = starts[i]
  }
  return starts
}

/** Page start times: page 0 starts at 0; page k at the time of its first unit (monotone). */
export function pageStarts(pages: QPage[], starts: number[]): number[] {
  const out: number[] = []
  pages.forEach((p, k) => {
    if (k === 0) {
      out.push(0)
      return
    }
    const s = starts[p.first]
    out.push(Number.isFinite(s) ? Math.max(s, out[k - 1]) : out[k - 1])
  })
  return out
}
