// Scene composition over the Painter contract. Everything is laid out ONCE in a reference space (1080 on the short
// side, ASPECT_SIZES) and drawn scaled to the scene size. Deterministic: no clock, no randomness (preview == export).
//
// Still (no timeline): paged, never truncated (research/00-gaps.md C13, D6, D3). The Quran text, the translation and
// the tafsir flow in reading order over as many pages as they need. Preference: everything on one page (the Quran
// as large as fits beside the whole commentary); else the Quran on page 1 with the whole translation (and the start
// of the tafsir) under it; else the Quran alone on page 1; else the Quran itself paged at a comfortable size. Text
// blocks break between whole lines, never leaving one line alone at the top of a page. Every page repeats the
// header with the reference line and the credits; a multi-page still adds a quiet indicator «١ / ٣» (same place on
// every page) and, on every page but the last, «يتبع ←». Page layers are built lazily by drawPage (two are kept).
//
// Video (a timeline): one page. Static layers (background + chrome, each Quran page, the opening lines, each
// translation / tafsir text) are cached in Surfaces at createScene time; draw(painter, t) composites them and paints
// what changes with time: the current Quran page, the recited word in gold (or the other ayahs dimmed), the
// isti'adha (timeline ayah -1) then the basmala (ayah 0) in the opening slot, and the current ayah's translation /
// tafsir — static when it fits, a slow scroll when that shows all of it, otherwise pages that switch evenly across
// the ayah's recitation. Nothing is cut.
import type { Aspect, DesignOptions, Graphics, ImageHandle, Painter, PathHandle, RenderModel, Scene, TafsirEntry, TextStyle } from '../core/types'
import { FONTS } from '../core/fonts'
import type { QuranFont, SceneAssets, ShapedRun } from './index'
import { blurByResampling, drawImageBackground, presetById } from './backgrounds'
import { scriptFont } from './fonts'
import { cartouche, circle, khatam, line as linePath } from './geometry'
import {
  BASMALA,
  ISTIADHA,
  blockHeight,
  buildUnits,
  fitQuran,
  inkExtents,
  pageStarts,
  unitStarts,
  type LineMetrics,
  type QPage,
  type QUnit,
  type QuranFit,
  type UnitGlyph,
} from './layout'
import { legendItems, ruleColor } from './tajweed'
import { NBSP, fitLineScale, wrapCredit, wrapText, type Measure } from './textwrap'
import { arabicDigits, clamp, ease } from './util'

interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// ── design tokens ──

interface AspectMetrics {
  padX: number
  /** top of the surah header; clears the preset frames (rules at 34–53 ref px) */
  padTop: number
  /** credits baseline, distance from the bottom edge (same clearance) */
  creditsInset: number
  quran: { min: number; max: number; page: number }
  /** longest Quran line, reference px */
  maxTextWidth: number
  /** longest translation line (shorter than the Quran line on wide frames — easier to read) */
  maxTranslationWidth: number
  surahSize: number
  sublineSize: number
  translationSize: number
  tafsirSize: number
  tafsirTitleSize: number
  legendSize: number
  creditsSize: number
  gap: number
  /** 16:9 puts the tafsir card beside the text */
  twoColumn: boolean
}

export const METRICS: Record<Aspect, AspectMetrics> = {
  '9:16': {
    padX: 84,
    padTop: 150,
    creditsInset: 96,
    quran: { min: 46, max: 104, page: 60 },
    maxTextWidth: 912,
    maxTranslationWidth: 912,
    surahSize: 50,
    sublineSize: 27,
    translationSize: 32,
    tafsirSize: 30,
    tafsirTitleSize: 25,
    legendSize: 23,
    creditsSize: 23,
    gap: 48,
    twoColumn: false,
  },
  '4:5': {
    padX: 80,
    padTop: 92,
    creditsInset: 84,
    quran: { min: 42, max: 96, page: 54 },
    maxTextWidth: 920,
    maxTranslationWidth: 920,
    surahSize: 46,
    sublineSize: 25,
    translationSize: 30,
    tafsirSize: 28,
    tafsirTitleSize: 24,
    legendSize: 22,
    creditsSize: 22,
    gap: 36,
    twoColumn: false,
  },
  '1:1': {
    padX: 76,
    padTop: 84,
    creditsInset: 80,
    quran: { min: 40, max: 92, page: 50 },
    maxTextWidth: 928,
    maxTranslationWidth: 928,
    surahSize: 42,
    sublineSize: 24,
    translationSize: 28,
    tafsirSize: 26,
    tafsirTitleSize: 22,
    legendSize: 21,
    creditsSize: 21,
    gap: 30,
    twoColumn: false,
  },
  '16:9': {
    padX: 120,
    padTop: 84,
    creditsInset: 80,
    quran: { min: 40, max: 92, page: 52 },
    maxTextWidth: 1440,
    maxTranslationWidth: 1240,
    surahSize: 44,
    sublineSize: 24,
    translationSize: 30,
    tafsirSize: 27,
    tafsirTitleSize: 23,
    legendSize: 21,
    creditsSize: 21,
    gap: 32,
    twoColumn: true,
  },
}

interface Palette {
  text: string
  secondary: string
  tertiary: string
  accent: string
  highlight: string
  band: string
  waqf: string
  cardFill: string
  cardStroke: string
  rule: string
  halo: string
  overlay: string
}

const LIGHT_TEXT: Palette = {
  text: '#F7F2E6',
  secondary: 'rgba(247,242,230,0.88)',
  tertiary: 'rgba(247,242,230,0.62)',
  accent: '#D8B566',
  highlight: '#F3C85A',
  band: 'rgba(243,200,90,0.2)',
  waqf: 'rgba(247,242,230,0.68)',
  cardFill: 'rgba(5,10,20,0.34)',
  cardStroke: 'rgba(216,181,102,0.36)',
  rule: 'rgba(216,181,102,0.75)',
  halo: '#000000',
  overlay: '0,0,0',
}

const DARK_TEXT: Palette = {
  text: '#18222E',
  secondary: 'rgba(24,34,46,0.86)',
  tertiary: 'rgba(24,34,46,0.62)',
  accent: '#93702A',
  highlight: '#A06A12',
  band: 'rgba(194,154,62,0.24)',
  waqf: 'rgba(24,34,46,0.64)',
  cardFill: 'rgba(255,253,247,0.5)',
  cardStroke: 'rgba(147,112,42,0.34)',
  rule: 'rgba(147,112,42,0.7)',
  halo: '#FFFFFF',
  overlay: '255,255,255',
}

/** non-recited ayahs when highlighting without word timings */
const DIM_ALPHA = 0.36
const FADE_MS = 360
/** a word stays gold this long after its window when the next word has not started */
const HOLD_MS = 350
/** tafsir/translation scroll speed limit, reference px per ms (≈ 38 px/s); faster than this → pages instead */
const MAX_SCROLL = 0.038
const TAFSIR_PARTIAL_LABEL = 'تفسير الآية كاملة'
/** tag of a tafsir card that continues the previous page's */
const CONTINUED_LABEL = 'تابع'
/** on every still page but the last (RTL: the arrow points to the next page) */
const NEXT_PAGE_HINT = 'يتبع ←'
/** QF Developer Terms + research/00-gaps.md §6.2: text, timing and QF audio, on every export */
const QF_CREDIT = 'Quran.com / Quran Foundation'
/** every catalogue reciter reads Hafs 'an 'Asim, the riwayah of the QPC Hafs display text (00-gaps §6.2: name + riwayah) */
const RIWAYAH = 'رواية حفص عن عاصم'
/** still page layers kept in memory (each is a full-frame surface) */
const STILL_CACHE = 2
/** prefix of a partly selected ayah's translation (it is the whole ayah's); Arabic when the language is not listed */
const FULL_VERSE: Record<string, string> = {
  ar: 'الآية كاملة',
  en: 'full verse',
  fr: 'verset complet',
  es: 'aleya completa',
  de: 'ganzer Vers',
  id: 'ayat lengkap',
  ms: 'ayat penuh',
  tr: 'ayetin tamamı',
  ur: 'مکمل آیت',
  fa: 'آیهٔ کامل',
  ru: 'весь аят',
  bn: 'সম্পূর্ণ আয়াত',
}

// ── helpers ──

const glyphPaths = new WeakMap<Graphics, WeakMap<QuranFont, Map<number, PathHandle | null>>>()

function pathCache(g: Graphics, font: QuranFont): Map<number, PathHandle | null> {
  let byFont = glyphPaths.get(g)
  if (!byFont) glyphPaths.set(g, (byFont = new WeakMap()))
  let m = byFont.get(font)
  if (!m) byFont.set(font, (m = new Map()))
  return m
}

const style = (family: string, sizePx: number, color: string, align: TextStyle['align'] = 'center', direction: TextStyle['direction'] = 'rtl'): TextStyle => ({
  family,
  sizePx,
  color,
  align,
  direction,
})

const recolor = (s: TextStyle, color: string | null): TextStyle => (color ? { ...s, color } : s)

const d = arabicDigits

/**
 * The reference line (D5, features M2): «الآية ٢٥٥», «جزء من الآية ٤٣», «الآيات ١–٧», and for a range whose first or
 * last ayah is partial «من جزء من الآية ٤١ إلى الآية ٤٣» / «من الآية ٤١ إلى جزء من الآية ٤٣».
 */
export function referenceLabel(model: RenderModel): string {
  const first = model.ayahs[0]?.number
  const last = model.ayahs[model.ayahs.length - 1]?.number
  if (first === undefined || last === undefined) return ''
  if (first === last) return model.partialStart || model.partialEnd ? `جزء من الآية ${d(first)}` : `الآية ${d(first)}`
  if (!model.partialStart && !model.partialEnd) return `الآيات ${d(first)}–${d(last)}`
  const from = model.partialStart ? `من جزء من الآية ${d(first)}` : `من الآية ${d(first)}`
  const to = model.partialEnd ? `إلى جزء من الآية ${d(last)}` : `إلى الآية ${d(last)}`
  return `${from} ${to}`
}

/** The reference in the credits when the surah header is off: «البقرة ٢٥٥», «النساء — جزء من الآية ٤٣». */
function shortReference(model: RenderModel): string {
  const first = model.ayahs[0]?.number
  const last = model.ayahs[model.ayahs.length - 1]?.number
  const name = model.surah.nameArabic
  if (first === undefined || last === undefined) return name
  if (model.partialStart || model.partialEnd) return `${name} — ${referenceLabel(model)}`
  return `${name} ${first === last ? d(first) : `${d(first)}–${d(last)}`}`
}

function rangeLabel(from: number, to: number): string {
  return from === to ? `الآية ${d(from)}` : `الآيات ${d(from)}–${d(to)}`
}

/** «١ / ٣» */
export const pageIndicator = (page: number, count: number): string => `${d(page + 1)} / ${d(count)}`

/** Index of the active segment at t plus a crossfade weight; starts must be ascending. */
function segmentAt(starts: number[], t: number, fade: number): { i: number; prev: number; f: number } {
  let i = 0
  for (let k = 1; k < starts.length; k++) if (starts[k] - fade / 2 <= t) i = k
  if (i === 0) return { i: 0, prev: -1, f: 1 }
  const f = clamp((t - (starts[i] - fade / 2)) / fade, 0, 1)
  return { i, prev: i - 1, f }
}

// ── layout records ──

interface PlacedUnit {
  index: number
  unit: QUnit
  /** left edge and baseline, reference px */
  x: number
  baseline: number
}

export interface PageLayout {
  page: QPage
  placed: PlacedUnit[]
  /** ayahIndex → regions (reference px) */
  regions: Map<number, Rect[]>
  startMs: number
}

interface Layer {
  img: ImageHandle
  /** pixel rect in scene space */
  px: Rect
}

/** A translation / tafsir text of a video, shown while its ayah is recited. */
interface TimedText {
  /** static: fits its view; scroll: one slow scroll shows all of it; pages: switched evenly across the recitation */
  mode: 'static' | 'scroll' | 'pages'
  /** one layer (static, scroll) or one per page */
  layers: Layer[]
  /** content height of each layer, reference px */
  heights: number[]
  viewH: number
  /** audio window of the ayah(s) the text belongs to: the scroll / the page switches spread over it */
  start: number
  end: number
  tag: string
  /** a text shorter than its view sits in the middle of it (tafsir card) instead of at the top */
  centre: boolean
}

interface OpeningLine {
  run: ShapedRun
  /** font units → reference px */
  k: number
  /** left edge of the run and its baseline, reference px */
  x: number
  baseline: number
  /** ink box (reference px) */
  rect: Rect
}

/** One still page: what it shows and where (reference px). */
export interface StillPageLayout {
  /** index into layout.pages (the Quran pages), or null */
  quranPage: number | null
  opening: boolean
  /** [from, to) lines of the wrapped translation / tafsir */
  translationLines: [number, number] | null
  tafsirLines: [number, number] | null
  /** the tajweed legend sits on pages with Quran text */
  legend: boolean
  /** bottom of the page's content region: the legend, the pager and the credits sit below it */
  contentBottom: number
  quranZone: Rect | null
  translationZone: Rect | null
  /** y of the ornament that opens the translation (its first page only) */
  dividerY: number | null
  tafsirCard: Rect | null
  /** first fragment of the tafsir (the next ones are tagged «تابع») */
  tafsirFirst: boolean
  basmala: Rect | null
  istiadha: Rect | null
}

export interface SceneLayout {
  size: number
  /** Quran pages: timed on a video (startMs); on a still each sits on its own still page */
  pages: PageLayout[]
  paginated: boolean
  quranZone: Rect
  translationZone: Rect | null
  tafsirCard: Rect | null
  /** ink box of the basmala / isti'adha line (page 1 of a still) */
  basmala: Rect | null
  istiadha: Rect | null
  legendRows: number
  /** still pages (empty on a video) */
  stills: StillPageLayout[]
  /** a video's translation / tafsir texts and how each is shown (empty on a still) */
  timed: { kind: 'translation' | 'tafsir'; mode: TimedText['mode']; pages: number; start: number; end: number }[]
  /** how a still was planned: 'one' (everything on one page), 'quran-first', 'quran-alone', 'quran-paged'; 'video' */
  plan: 'one' | 'quran-first' | 'quran-alone' | 'quran-paged' | 'video'
}

/** What a still page holds before placement. */
interface Slot {
  quran: number | null
  opening: boolean
  tr: [number, number] | null
  divider: boolean
  tf: [number, number] | null
  legend: boolean
}

/**
 * Builds the scene (see file header). `size` = pixel size of the frames; `ref` = layout space for the aspect
 * (ASPECT_SIZES). Exposes the computed layout as `layout` for tests and the lab.
 */
export function buildScene(model: RenderModel, design: DesignOptions, assets: SceneAssets, size: Size, ref: Size): Scene & { layout: SceneLayout } {
  const { font, graphics } = assets
  const M = METRICS[design.aspect] ?? METRICS['9:16']
  const P = design.textTone === 'dark' ? DARK_TEXT : LIGHT_TEXT
  const tone = design.textTone === 'dark' ? 'dark' : 'light'
  const W = ref.width
  const H = ref.height
  const ps = Math.min(size.width / W, size.height / H)
  const ox = (size.width - W * ps) / 2
  const oy = (size.height - H * ps) / 2
  const measurer = graphics.createSurface(1, 1).painter
  const measure: Measure = (t, s) => measurer.measureText(t, s)
  const timeline = model.timeline && model.timeline.durationMs > 0 ? model.timeline : null
  const isVideo = timeline !== null
  const paths = pathCache(graphics, font)
  const halo = design.background.kind === 'image' && assets.backgroundImage !== null

  const pathOf = (gid: number): PathHandle | null => {
    let p = paths.get(gid)
    if (p === undefined) {
      const svg = font.glyphSvg(gid)
      p = svg ? graphics.makePath(svg) : null
      paths.set(gid, p)
    }
    return p
  }

  const contentX = M.padX
  const contentW = W - 2 * M.padX
  const cx = W / 2

  // ── header (surah name + the reference line) ──
  const header = design.showSurahHeader
    ? (() => {
        const title = `سورة ${model.surah.nameArabic}`
        const titleStyle = style(FONTS.display, M.surahSize, P.accent)
        const cw = clamp(measure(title, titleStyle) + M.surahSize * 3.6, contentW * 0.46, contentW * 0.82)
        const ch = M.surahSize * 1.66
        const top = M.padTop
        return {
          title,
          titleStyle,
          subtitle: referenceLabel(model),
          subStyle: style(FONTS.uiMedium, M.sublineSize, P.tertiary),
          rect: { x: cx - cw / 2, y: top, w: cw, h: ch },
          bottom: top + ch + M.sublineSize * 1.95,
        }
      })()
    : null

  // ── credits (research/00-gaps.md §6.2; never shortened: a long line wraps between parts) ──
  const translationOn = design.showTranslation && !!model.translation?.some((e) => e.text.trim())
  const tafsirOn = design.showTafsir && !!model.tafsir?.some((e) => e.text.trim())
  const creditParts: string[] = []
  if (!header) creditParts.push(shortReference(model))
  // a recitation credits its reciter and riwayah, whatever design.showReciterName says (QF Developer Terms)
  if (isVideo && model.reciter) creditParts.push(`القارئ ${model.reciter.nameAr}`, RIWAYAH)
  if (translationOn && model.translationSource) creditParts.push(model.translationSource.name)
  const sources = isVideo && model.reciter ? model.reciter.sourceName.split('·').map((x) => x.trim()) : []
  for (const src of sources) if (src && src !== 'Quran.com' && !creditParts.includes(src)) creditParts.push(src)
  creditParts.push(QF_CREDIT)
  const CREDIT_SEP = '  ·  '
  const creditText = creditParts.join(CREDIT_SEP)
  const creditStyleBase = style(FONTS.ui, M.creditsSize, P.tertiary)
  const markStyle = style(FONTS.display, M.creditsSize * 1.12, P.accent)
  const markText = 'بلّغ'
  const markW = design.showWatermark ? measure(markText, markStyle) + M.creditsSize * 1.4 : 0
  // the credits sit between the preset's bottom corner ornaments (they reach ~100 ref px in from each side)
  const creditW = Math.min(contentW, W - 2 * 124) - markW
  /** credits break between parts only (never inside a name or a licence) */
  const creditWrap = (st: TextStyle): string[] => {
    const lines: string[] = []
    let cur = ''
    for (const part of creditParts) {
      const cand = cur ? cur + CREDIT_SEP + part : part
      if (!cur || measure(cand, st) <= creditW) cur = cand
      else {
        lines.push(cur)
        cur = part
      }
    }
    if (cur) lines.push(cur)
    return lines
  }
  const creditScale = fitLineScale(creditText, creditW, creditStyleBase, measure, 0.8)
  let creditStyle: TextStyle = { ...creditStyleBase, sizePx: M.creditsSize * creditScale }
  let creditLines = [creditText]
  if (measure(creditText, creditStyle) > creditW) {
    creditStyle = { ...creditStyleBase, sizePx: M.creditsSize * 0.9 }
    creditLines = creditWrap(creditStyle)
    if (creditLines.length > 2) {
      creditStyle = { ...creditStyleBase, sizePx: M.creditsSize * 0.8 }
      creditLines = creditWrap(creditStyle)
    }
  }
  const creditLineH = M.creditsSize * 1.45
  const creditsBaseline = H - M.creditsInset
  const creditsTop = creditsBaseline - M.creditsSize * 1.1 - creditLineH * (creditLines.length - 1)

  // ── legend (chips grouped by colour), anchored above the credits ──
  const legendOn = design.showRulesLegend && design.showTajweed && model.rules.length > 0
  const legendStyle = style(FONTS.ui, M.legendSize, P.secondary, 'right')
  const items = legendOn ? legendItems(model.rules, tone) : []
  const dotD = M.legendSize * 0.62
  const chipGap = M.legendSize * 1.5
  const chips = items.flatMap((it) => {
    // one chip per colour; split a colour's names over several chips if it would not fit a row
    const out: { color: string; label: string; w: number }[] = []
    let names: string[] = []
    const flush = () => {
      if (!names.length) return
      const label = names.join('، ')
      out.push({ color: it.color, label, w: dotD + M.legendSize * 0.5 + measure(label, legendStyle) })
      names = []
    }
    for (const n of it.names) {
      const label = [...names, n].join('، ')
      if (names.length && dotD + measure(label, legendStyle) > contentW * 0.9) flush()
      names.push(n)
    }
    flush()
    return out
  })
  const legendRows: (typeof chips)[] = []
  for (const c of chips) {
    const row = legendRows[legendRows.length - 1]
    const rowW = row ? row.reduce((s, x) => s + x.w, 0) + chipGap * row.length : 0
    if (row && rowW + c.w <= contentW) row.push(c)
    else legendRows.push([c])
  }

  // ── vertical frame: header … content region … [legend] [pager] credits (the pager keeps one place on every page) ──
  const midTop = header ? header.bottom + M.gap : M.padTop * 0.75
  const midBottom = creditsTop - M.gap * 0.8
  const legendRowH = M.legendSize * 1.75
  const legendH = legendRows.length * legendRowH
  const legendBlock = legendRows.length ? legendH + M.gap * 0.7 : 0
  const pagerH = M.creditsSize * 2.3
  /** top of the legend rows: right above the credits, or above the pager of a paged still */
  const legendTop = (pager: boolean): number => midBottom - (pager ? pagerH : 0) - legendH
  /** bottom of the content region of a page */
  const regionBottom = (legend: boolean, pager: boolean): number => midBottom - (legend ? legendBlock : 0) - (pager ? pagerH : 0)

  // ── columns (16:9 puts the tafsir card beside the text) ──
  const twoCol = M.twoColumn && tafsirOn
  const colGap = M.gap * 1.4
  const textColW = twoCol ? contentW * 0.56 - colGap / 2 : contentW
  const textColX = twoCol ? contentX + contentW * 0.44 + colGap / 2 : contentX
  const sideColW = contentW * 0.44 - colGap / 2
  const sideColX = contentX

  // ── Quran units & metrics ──
  const units = buildUnits(model, font, { waqf: design.showWaqfMarks, numbers: design.showAyahNumbers, tajweed: design.showTajweed })
  const space = font.shape(' ', 'rtl').advance || font.upem * 0.3
  const ink = inkExtents(units, font)
  const metrics: LineMetrics = {
    top: clamp(ink.top, 0.95, 1.5),
    bottom: clamp(ink.bottom, 0.5, 0.95),
    pitch: 2.02,
  }
  const quranW = Math.min(textColW, M.maxTextWidth)
  const fitIn = (h: number, rest = h): QuranFit => fitQuran(units, font, space, quranW, h, M.quran, design.fontScale, metrics, rest)

  // ── opening lines: isti'adha (timeline ayah -1) and basmala (ayah 0), as the model says ──
  const istiadhaWin = timeline?.ayahs.find((a) => a.ayah === -1) ?? null
  const basmalaWin = timeline?.ayahs.find((a) => a.ayah === 0) ?? null
  // a video shows the isti'adha only while it is recited, so without its window there is nothing to time it by
  const showIstiadha = model.istiadha && (!isVideo || istiadhaWin !== null)
  const showBasmala = model.basmala
  const basmalaSize = M.surahSize * 1.14
  const istiadhaSize = basmalaSize * 0.8
  const basmalaSlotH = basmalaSize * 2.6
  const istiadhaSlotH = istiadhaSize * 2.4
  // video: one slot that shows the isti'adha while it is recited, then the basmala; still: both, stacked
  const openingH = isVideo
    ? Math.max(showIstiadha ? istiadhaSlotH : 0, showBasmala ? basmalaSlotH : 0)
    : (showIstiadha ? istiadhaSlotH : 0) + (showBasmala ? basmalaSlotH : 0)
  const basmalaRun = showBasmala ? font.shape(BASMALA, 'rtl') : null
  const istiadhaRun = showIstiadha ? font.shape(ISTIADHA, 'rtl') : null

  const openingLine = (run: ShapedRun, sizePx: number, slot: Rect): OpeningLine => {
    const k = Math.min(sizePx, (slot.w * 0.9 * font.upem) / Math.max(1, run.advance)) / font.upem
    const w = run.advance * k
    const s = k * font.upem
    const baseline = slot.y + slot.h * 0.508
    const x = slot.x + slot.w / 2 - w / 2
    return { run, k, x, baseline, rect: { x, y: baseline - s * 1.25, w, h: s * 1.85 } }
  }
  const openingLines = (top: number, colX: number, colW: number): { istiadha: OpeningLine | null; basmala: OpeningLine | null } => {
    if (isVideo) {
      const slot = { x: colX, y: top, w: colW, h: openingH }
      return {
        istiadha: istiadhaRun ? openingLine(istiadhaRun, istiadhaSize, slot) : null,
        basmala: basmalaRun ? openingLine(basmalaRun, basmalaSize, slot) : null,
      }
    }
    const istiadha = istiadhaRun ? openingLine(istiadhaRun, istiadhaSize, { x: colX, y: top, w: colW, h: istiadhaSlotH }) : null
    const y = top + (istiadha ? istiadhaSlotH : 0)
    return { istiadha, basmala: basmalaRun ? openingLine(basmalaRun, basmalaSize, { x: colX, y, w: colW, h: basmalaSlotH }) : null }
  }

  // ── translation texts (Noto per script — render/fonts.ts) ──
  const trFont = scriptFont(model.translationSource?.script)
  const trSize = M.translationSize * (trFont?.sizeScale ?? 1)
  const trLineH = trSize * (trFont?.lineHeight ?? 1.5)
  const trDir = model.translationSource?.dir ?? 'ltr'
  const trStyle = style(trFont?.family ?? FONTS.ui, trSize, P.secondary, 'center', trDir)
  /** baseline of line i, from the top of the block */
  const trBaseline = (i: number) => i * trLineH + (trLineH + trSize * 0.72) / 2
  const trWidth = Math.min(textColW, M.maxTranslationWidth)
  const trNumber = (n: number) => (trDir === 'rtl' ? `(${d(n)})` : `(${n})`)
  const trEntries = translationOn ? (model.translation ?? []).filter((e) => e.text.trim()) : []
  const firstAyah = model.ayahs[0]?.number ?? 1
  const lastAyah = model.ayahs[model.ayahs.length - 1]?.number ?? firstAyah
  const isPartialAyah = (n: number) => (model.partialStart && n === firstAyah) || (model.partialEnd && n === lastAyah)
  // a partly selected ayah still shows its whole translation — say so, in the translation's language
  const fullVerse = FULL_VERSE[model.translationSource?.lang ?? ''] ?? FULL_VERSE.ar
  const trText = (e: { ayah: number; text: string }) => (isPartialAyah(e.ayah) ? `(${fullVerse}) ${e.text.trim()}` : e.text.trim())
  const trTexts: { ayahs: number[]; text: string }[] = isVideo
    ? trEntries.map((e) => ({ ayahs: [e.ayah], text: trText(e) }))
    : trEntries.length
      ? [
          {
            ayahs: trEntries.map((e) => e.ayah),
            text: trEntries.length > 1 ? trEntries.map((e) => `${trText(e)}${NBSP}${trNumber(e.ayah)}`).join(' ') : trText(trEntries[0]),
          },
        ]
      : []
  const trWrapped = trTexts.map((t) => ({ ...t, lines: wrapText(t.text, trWidth, trStyle, measure) }))
  const dividerH = M.gap * 1.1

  // ── tafsir texts ──
  const tfStyle = style(FONTS.ui, M.tafsirSize, P.secondary, 'right', 'rtl')
  const tfLineH = M.tafsirSize * 1.72
  const tfTitleStyle = style(FONTS.uiSemiBold, M.tafsirTitleSize, P.accent, 'right', 'rtl')
  const tfTagStyle = style(FONTS.ui, M.tafsirTitleSize * 0.88, P.tertiary, 'left', 'rtl')
  const tfCreditStyle = style(FONTS.ui, M.tafsirTitleSize * 0.78, P.tertiary, 'center', 'rtl')
  const tfPad = M.tafsirSize * 0.95
  const tfTitleH = M.tafsirTitleSize * 2.1
  const cardW = twoCol ? sideColW : Math.min(textColW, M.maxTextWidth + 40)
  const tfInnerW = cardW - 2 * tfPad
  const tfTitle = model.tafsirSource?.nameAr ?? 'التفسير'
  // the credit of the provider that actually served the text (TafsirResult.creditAr); all of it, on every card
  const tafsirCredit = tafsirOn ? (model.tafsirCreditAr ?? model.tafsirSource?.creditAr ?? '') : ''
  // breaks between the credit's parts only (never inside "Quran.com / Quran Foundation" or a name)
  const tfCreditLines = tafsirCredit ? wrapCredit(tafsirCredit, tfInnerW, tfCreditStyle, measure) : []
  const tfCreditLineH = M.tafsirTitleSize * 1.15
  const tfCreditH = tfCreditLines.length ? tfCreditLines.length * tfCreditLineH + M.tafsirTitleSize * 0.5 : 0
  const cardChrome = 2 * tfPad + tfTitleH + tfCreditH
  const tfEntries: TafsirEntry[] = tafsirOn ? (model.tafsir ?? []).filter((e) => e.text.trim()) : []
  const tfTexts: { from: number; to: number; text: string; tag: string }[] = isVideo
    ? tfEntries.map((e) => {
        const from = Math.max(e.ayahFrom, firstAyah)
        const to = Math.min(e.ayahTo, lastAyah)
        let partial = false
        for (let n = from; n <= to; n++) if (isPartialAyah(n)) partial = true
        return { from: e.ayahFrom, to: e.ayahTo, text: e.text.trim(), tag: partial ? TAFSIR_PARTIAL_LABEL : rangeLabel(e.ayahFrom, e.ayahTo) }
      })
    : tfEntries.length
      ? [
          {
            from: tfEntries[0].ayahFrom,
            to: tfEntries[tfEntries.length - 1].ayahTo,
            text:
              tfEntries.length > 1
                ? tfEntries.map((e) => `(${e.ayahFrom === e.ayahTo ? d(e.ayahFrom) : `${d(e.ayahFrom)}–${d(e.ayahTo)}`})${NBSP}${e.text.trim()}`).join('\n')
                : tfEntries[0].text.trim(),
            tag: model.partialStart || model.partialEnd ? TAFSIR_PARTIAL_LABEL : '',
          },
        ]
      : []
  const tfWrapped = tfTexts.map((t) => ({ ...t, lines: wrapText(t.text, tfInnerW, tfStyle, measure) }))

  // ── layer helpers ──
  const toPx = (r: Rect, clampToFrame: boolean): Rect => {
    let x0 = Math.floor(ox + r.x * ps)
    let y0 = Math.floor(oy + r.y * ps)
    let x1 = Math.ceil(ox + (r.x + r.w) * ps)
    let y1 = Math.ceil(oy + (r.y + r.h) * ps)
    if (clampToFrame) {
      x0 = clamp(x0, 0, size.width)
      y0 = clamp(y0, 0, size.height)
      x1 = clamp(x1, x0 + 1, size.width)
      y1 = clamp(y1, y0 + 1, size.height)
    }
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
  }

  /** Renders `content` (reference coordinates) into a surface covering `r`; optional soft halo. */
  const makeLayer = (r: Rect, content: (p: Painter, shadow: string | null) => void, clampToFrame = true, withHalo = halo): Layer => {
    const px = toPx(r, clampToFrame)
    const s = graphics.createSurface(px.w, px.h)
    if (withHalo) {
      const q = 4
      const sw = Math.max(1, Math.ceil(px.w / q))
      const sh = Math.max(1, Math.ceil(px.h / q))
      const small = graphics.createSurface(sw, sh)
      small.painter.save()
      small.painter.scale(1 / q, 1 / q)
      small.painter.translate(ox - px.x, oy - px.y)
      small.painter.scale(ps, ps)
      content(small.painter, P.halo)
      small.painter.restore()
      const soft = blurByResampling(graphics, small.snapshot(), sw, sh, 2)
      s.painter.save()
      s.painter.alpha(design.textTone === 'dark' ? 0.7 : 0.62)
      s.painter.drawImage(soft, 0, 0, px.w, px.h)
      s.painter.restore()
    }
    s.painter.save()
    s.painter.translate(ox - px.x, oy - px.y)
    s.painter.scale(ps, ps)
    content(s.painter, null)
    s.painter.restore()
    return { img: s.snapshot(), px }
  }

  const drawLayer = (p: Painter, l: Layer, alpha: number) => {
    if (alpha <= 0.001) return
    if (alpha < 0.999) {
      p.save()
      p.alpha(alpha)
      p.drawImage(l.img, l.px.x, l.px.y, l.px.w, l.px.h)
      p.restore()
    } else p.drawImage(l.img, l.px.x, l.px.y, l.px.w, l.px.h)
  }

  // ── drawing pieces (reference coordinates) ──
  const glyphColor = (g: UnitGlyph): string => {
    if (g.role === 'number') return P.accent
    if (g.role === 'waqf') return P.waqf
    if (g.rule) return ruleColor(g.rule, tone) ?? P.text
    return P.text
  }

  const drawUnit = (p: Painter, pu: PlacedUnit, k: number, color: ((g: UnitGlyph) => string) | string) => {
    for (const g of pu.unit.glyphs) {
      const path = pathOf(g.gid)
      if (!path) continue
      p.save()
      p.translate(pu.x + g.x * k, pu.baseline - g.y * k)
      p.scale(k, -k)
      p.fillPath(path, typeof color === 'string' ? color : color(g))
      p.restore()
    }
  }

  const drawOpeningLine = (p: Painter, ol: OpeningLine, color: string) => {
    let x = ol.x
    for (const g of ol.run.glyphs) {
      const path = pathOf(g.gid)
      if (path) {
        p.save()
        p.translate(x + g.xOffset * ol.k, ol.baseline - g.yOffset * ol.k)
        p.scale(ol.k, -ol.k)
        p.fillPath(path, color)
        p.restore()
      }
      x += g.xAdvance * ol.k
    }
  }

  /** Places a Quran page's lines in `zone` (the block is centred vertically in it), right to left. */
  const placeQuran = (page: QPage, zone: Rect, sizePx: number, startMs: number): PageLayout => {
    const k = sizePx / font.upem
    const top = zone.y + (zone.h - blockHeight(page.lines.length, sizePx, metrics)) / 2
    const placed: PlacedUnit[] = []
    const regions = new Map<number, Rect[]>()
    let index = page.first
    page.lines.forEach((ln, li) => {
      const baseline = top + (metrics.top + li * metrics.pitch) * sizePx
      let right = zone.x + zone.w / 2 + (ln.width * k) / 2
      const spans = new Map<number, { x0: number; x1: number }>()
      for (const unit of ln.units) {
        const x = right - unit.advance * k
        placed.push({ index, unit, x, baseline })
        index++
        const s = spans.get(unit.ayahIndex)
        if (s) {
          s.x0 = Math.min(s.x0, x)
          s.x1 = Math.max(s.x1, right)
        } else spans.set(unit.ayahIndex, { x0: x, x1: right })
        right = x - space * k
      }
      const padX = space * k * 0.45
      for (const [ai, s] of spans) {
        const r: Rect = { x: s.x0 - padX, y: baseline - metrics.pitch * sizePx * 0.6, w: s.x1 - s.x0 + 2 * padX, h: metrics.pitch * sizePx }
        const list = regions.get(ai)
        if (list) list.push(r)
        else regions.set(ai, [r])
      }
    })
    return { page, placed, regions, startMs }
  }

  const drawHeader = (p: Painter, shadow: string | null) => {
    if (!header) return
    const { rect } = header
    const ccy = rect.y + rect.h / 2
    const point = rect.h * 0.42
    if (!shadow) {
      p.fillPath(graphics.makePath(cartouche(cx, ccy, rect.w, rect.h, point)), design.textTone === 'dark' ? 'rgba(147,112,42,0.07)' : 'rgba(216,181,102,0.08)')
      p.strokePath(graphics.makePath(cartouche(cx, ccy, rect.w, rect.h, point)), P.rule, 2)
      p.strokePath(graphics.makePath(cartouche(cx, ccy, rect.w - 18, rect.h - 14, point - 4)), P.cardStroke, 1.2)
      const sr = rect.h * 0.13
      const ends = [cx - rect.w / 2 - sr * 2.2, cx + rect.w / 2 + sr * 2.2]
      p.fillPath(graphics.makePath(ends.map((x) => khatam(x, ccy, sr, Math.PI / 8)).join('')), P.rule)
      p.strokePath(
        graphics.makePath(linePath(ends[0] - sr * 1.6, ccy, ends[0] - sr * 7, ccy) + linePath(ends[1] + sr * 1.6, ccy, ends[1] + sr * 7, ccy)),
        P.rule,
        1.2,
      )
    }
    p.fillText(header.title, cx, ccy + M.surahSize * 0.3, recolor(header.titleStyle, shadow))
    p.fillText(header.subtitle, cx, rect.y + rect.h + M.sublineSize * 1.45, recolor(header.subStyle, shadow))
  }

  const drawLegend = (p: Painter, shadow: string | null, top: number) => {
    legendRows.forEach((row, ri) => {
      const rowW = row.reduce((s, c) => s + c.w, 0) + chipGap * (row.length - 1)
      let right = cx + rowW / 2
      const baseline = top + ri * legendRowH + M.legendSize * 1.15
      for (const c of row) {
        p.fillPath(graphics.makePath(circle(right - dotD / 2, baseline - M.legendSize * 0.36, dotD / 2)), shadow ?? c.color)
        p.fillText(c.label, right - dotD - M.legendSize * 0.5, baseline, recolor(legendStyle, shadow))
        right -= c.w + chipGap
      }
    })
  }

  /** credits (+ the small «بلّغ» mark at the end of the line) */
  const drawCredits = (p: Painter, shadow: string | null) => {
    creditLines.forEach((ln, i) => {
      const yb = creditsBaseline - (creditLines.length - 1 - i) * creditLineH
      if (i === creditLines.length - 1 && design.showWatermark) {
        const lw = measure(ln, creditStyle)
        const total = lw + markW
        p.fillText(ln, cx + total / 2, yb, recolor({ ...creditStyle, align: 'right' }, shadow))
        p.fillText(markText, cx - total / 2, yb + M.creditsSize * 0.06, recolor({ ...markStyle, align: 'left' }, shadow))
      } else p.fillText(ln, cx, yb, recolor(creditStyle, shadow))
    })
  }

  const drawDivider = (p: Painter, y: number) => {
    const dw = Math.min(110, contentW * 0.12)
    p.strokePath(graphics.makePath(linePath(cx - dw / 2, y, cx + dw / 2, y)), P.rule, 1.6)
    p.fillPath(graphics.makePath(khatam(cx, y, 5.5, Math.PI / 8)), P.rule)
  }

  /** card fill + frame, title (right), optional tag (left) and the licence credit at the bottom */
  const drawCard = (p: Painter, shadow: string | null, r: Rect, tag: string) => {
    if (!shadow) {
      p.fillRoundRect(r.x, r.y, r.w, r.h, 18, P.cardFill)
      p.strokeRoundRect(r.x, r.y, r.w, r.h, 18, P.cardStroke, 1.4)
    }
    p.fillText(tfTitle, r.x + r.w - tfPad, r.y + tfPad + M.tafsirTitleSize * 1.05, recolor(tfTitleStyle, shadow))
    if (tag) p.fillText(tag, r.x + tfPad, r.y + tfPad + M.tafsirTitleSize * 1.05, recolor(tfTagStyle, shadow))
    tfCreditLines.forEach((ln, i) => {
      p.fillText(ln, r.x + r.w / 2, r.y + r.h - tfPad - (tfCreditLines.length - 1 - i) * tfCreditLineH, recolor(tfCreditStyle, shadow))
    })
  }

  const drawTafsirLines = (p: Painter, shadow: string | null, r: Rect, lines: string[]) => {
    const top = r.y + tfPad + tfTitleH
    lines.forEach((ln, i) => p.fillText(ln, r.x + r.w - tfPad, top + i * tfLineH + M.tafsirSize * 1.18, recolor(tfStyle, shadow)))
  }

  // ── background (shared by every page / frame) ──
  const bgSurface = graphics.createSurface(size.width, size.height)
  {
    const p = bgSurface.painter
    const bg = design.background
    if (bg.kind === 'image' && assets.backgroundImage) {
      drawImageBackground(p, graphics, assets.backgroundImage, size.width, size.height, bg.focusX, bg.focusY, design.blur * (Math.min(size.width, size.height) / 1080))
    } else {
      presetById(bg.kind === 'preset' ? bg.id : 'lapis-night').draw(p, graphics, size.width, size.height)
    }
    if (design.overlay > 0) p.fillRect(0, 0, size.width, size.height, `rgba(${P.overlay},${clamp(design.overlay, 0, 0.85)})`)
    if (bg.kind === 'image' && assets.backgroundImage) {
      // gentle vignette keeps the eye on the text over busy photos
      p.fillRect(0, 0, size.width, size.height, {
        type: 'radial',
        cx: size.width / 2,
        cy: size.height / 2,
        r: Math.hypot(size.width, size.height) / 2,
        stops: [
          { offset: 0.5, color: `rgba(${P.overlay},0)` },
          { offset: 1, color: `rgba(${P.overlay},0.32)` },
        ],
      })
      // scrims under the header and the credits (bright skies, snow, sand)
      const sh = size.height
      const top = sh * 0.24
      const bottom = sh * 0.8
      p.fillRect(0, 0, size.width, top, {
        type: 'linear',
        x0: 0,
        y0: 0,
        x1: 0,
        y1: top,
        stops: [
          { offset: 0, color: `rgba(${P.overlay},0.42)` },
          { offset: 1, color: `rgba(${P.overlay},0)` },
        ],
      })
      p.fillRect(0, bottom, size.width, sh - bottom, {
        type: 'linear',
        x0: 0,
        y0: bottom,
        x1: 0,
        y1: sh,
        stops: [
          { offset: 0, color: `rgba(${P.overlay},0)` },
          { offset: 1, color: `rgba(${P.overlay},0.45)` },
        ],
      })
    }
  }

  const fitPainter = (painter: Painter) => {
    if (painter.width !== size.width || painter.height !== size.height) painter.scale(painter.width / size.width, painter.height / size.height)
  }

  const scene = isVideo ? buildVideo() : buildStill()
  return { width: size.width, height: size.height, ...scene }

  // ───────────────────────── still: pages ─────────────────────────

  function buildStill(): Pick<Scene, 'durationMs' | 'pageCount' | 'draw' | 'drawPage'> & { layout: SceneLayout } {
    const trLines = trWrapped[0]?.lines ?? []
    const tfLines = tfWrapped[0]?.lines ?? []
    const tfTag = tfTexts[0]?.tag ?? ''
    const legendQ = legendRows.length > 0
    const trNat = trLines.length ? dividerH + trLines.length * trLineH : 0
    const tfNat = tfLines.length ? cardChrome + tfLines.length * tfLineH : 0

    /** Quran pages first (one per still page), then the translation and the in-column tafsir in whole lines. */
    /**
     * Lines of a text block a page takes when `fits` of the `rest` lines fit there: no lone last line on the next
     * page (two or more go over), and under other content at least `minStart` lines or none; a fresh page always
     * takes one so the flow moves on.
     */
    const splitLines = (fits: number, rest: number, minStart: number): number => {
      let n = Math.max(0, Math.min(fits, rest))
      if (n < rest && rest - n < 2) n = rest - 2
      if (n < Math.min(minStart, rest)) n = 0
      return minStart === 1 ? Math.max(1, n) : n
    }

    const flow = (fit: QuranFit, paged: boolean): Slot[] => {
      const slots: Slot[] = []
      const used: number[] = []
      const add = (s: Partial<Slot>, h: number) => {
        slots.push({ quran: null, opening: false, tr: null, divider: false, tf: null, legend: false, ...s })
        used.push(h)
      }
      if (fit.pages.length) fit.pages.forEach((pg, i) => add({ quran: i, opening: i === 0, legend: legendQ }, (i === 0 ? openingH : 0) + blockHeight(pg.lines.length, fit.size, metrics)))
      else add({ opening: true }, openingH)
      const cap = (k: number) => regionBottom(slots[k].legend, paged) - midTop - used[k]
      for (let i = 0; i < trLines.length; ) {
        const k = slots.length - 1
        const divider = i === 0 && used[k] > 0
        const head = divider ? dividerH : used[k] > 0 ? M.gap * 0.5 : 0
        const rest = trLines.length - i
        let n = Math.min(rest, Math.floor((cap(k) - head) / trLineH + 1e-6))
        n = splitLines(n, rest, used[k] > 0 ? 2 : 1)
        if (n >= 1) {
          slots[k].tr = [i, i + n]
          slots[k].divider = divider
          used[k] += head + n * trLineH
          i += n
        }
        if (i < trLines.length) add({}, 0)
      }
      if (!twoCol) {
        for (let j = 0; j < tfLines.length; ) {
          const k = slots.length - 1
          const head = (used[k] > 0 ? M.gap : 0) + cardChrome
          const rest = tfLines.length - j
          // under other content a card starts with at least three lines (or all of it)
          const n = splitLines(Math.min(rest, Math.floor((cap(k) - head) / tfLineH + 1e-6)), rest, used[k] > 0 ? 3 : 1)
          if (n >= 1) {
            slots[k].tf = [j, j + n]
            used[k] += head + n * tfLineH
            j += n
          }
          if (j < tfLines.length) add({}, 0)
        }
      } else if (tfLines.length) {
        // side column: its own flow, one card per page, beside whatever the text column has there
        let k = 0
        for (let j = 0; j < tfLines.length; k++) {
          if (k >= slots.length) add({}, 0)
          const room = regionBottom(slots[k].legend, paged) - midTop - cardChrome
          const n = Math.max(1, Math.min(tfLines.length - j, Math.floor(room / tfLineH + 1e-6)))
          slots[k].tf = [j, j + n]
          j += n
        }
      }
      return slots
    }

    // plan (file header): one page → Quran first → Quran alone → Quran paged
    let plan: SceneLayout['plan'] = 'one'
    let fit: QuranFit | null = null
    let slots: Slot[] = []
    let paged = false
    {
      const region = regionBottom(legendQ, false) - midTop
      const h = region - openingH - trNat - (tfLines.length && !twoCol ? M.gap + tfNat : 0)
      if ((!twoCol || tfNat <= region + 1e-6) && (h > 0 || !units.length)) {
        const f = fitIn(Math.max(1, h))
        if (!f.paginated) {
          const s = flow(f, false)
          if (s.length === 1) {
            fit = f
            slots = s
          }
        }
      }
    }
    if (!fit) {
      paged = true
      const region = regionBottom(legendQ, true) - midTop
      const avail = region - openingH
      const tfInCol = tfLines.length > 0 && !twoCol
      // Quran first: page 1 also takes the WHOLE translation (never a fragment of it) and, room permitting, the start
      // of the tafsir card (three lines or more); a translation too long for that starts on page 2 instead. Each
      // candidate is checked by the flow itself, so the Quran never shrinks for commentary that does not land.
      const tfH = Math.min(M.gap + tfNat, Math.max(M.gap + cardChrome + 3 * tfLineH, avail * (trLines.length ? 0.34 : 0.42)))
      const candidates: { budget: number; ok: (s: Slot) => boolean }[] = []
      if (trLines.length && trNat <= avail * 0.3) {
        const whole = (s: Slot) => s.tr !== null && s.tr[0] === 0 && s.tr[1] === trLines.length
        if (tfInCol) candidates.push({ budget: avail - trNat - tfH, ok: (s) => whole(s) && s.tf !== null })
        candidates.push({ budget: avail - trNat, ok: whole })
      } else if (!trLines.length && tfInCol) candidates.push({ budget: avail - tfH, ok: (s) => s.tf !== null })
      for (const c of candidates) {
        if (c.budget < M.quran.min * 2.5) continue
        const f = fitIn(c.budget)
        if (f.paginated) continue
        const s = flow(f, true)
        if (!c.ok(s[0])) continue
        plan = 'quran-first'
        fit = f
        slots = s
        break
      }
      if (!fit) {
        const alone = fitIn(avail)
        if (!alone.paginated) {
          plan = 'quran-alone'
          fit = alone
        } else {
          plan = 'quran-paged'
          fit = fitIn(avail, region)
        }
        slots = flow(fit, true)
      }
    }
    const qfit = fit
    const pageCount = Math.max(1, slots.length)
    const withPager = paged && pageCount > 1
    const sizeK = qfit.size / font.upem

    // placement: each page's text group is centred in its region; a column alone on its page is centred too
    const quranPages: PageLayout[] = []
    const openings: ReturnType<typeof openingLines>[] = []
    const stills: StillPageLayout[] = slots.map((s) => {
      const bottom = regionBottom(s.legend, paged)
      const regionH = bottom - midTop
      const textHas = (s.opening && openingH > 0) || s.quran !== null || s.tr !== null || (s.tf !== null && !twoCol)
      const sideHas = twoCol && s.tf !== null
      const tx = twoCol && !sideHas ? cx - textColW / 2 : textColX
      const sx = twoCol && !textHas ? cx - sideColW / 2 : sideColX
      const qH = s.quran !== null ? blockHeight(qfit.pages[s.quran].lines.length, qfit.size, metrics) : 0
      let groupH = (s.opening ? openingH : 0) + qH
      if (s.tr) groupH += (s.divider ? dividerH : groupH > 0 ? M.gap * 0.5 : 0) + (s.tr[1] - s.tr[0]) * trLineH
      if (s.tf && !twoCol) groupH += (groupH > 0 ? M.gap : 0) + cardChrome + (s.tf[1] - s.tf[0]) * tfLineH
      const top = midTop + Math.max(0, (regionH - groupH) / 2)
      let y = top
      const opening = s.opening ? openingLines(y, tx, textColW) : { istiadha: null, basmala: null }
      openings.push(opening)
      if (s.opening) y += openingH
      let quranZone: Rect | null = null
      let quranPage: number | null = null
      if (s.quran !== null) {
        quranZone = { x: tx + (textColW - quranW) / 2, y, w: quranW, h: qH }
        quranPage = quranPages.length
        quranPages.push(placeQuran(qfit.pages[s.quran], quranZone, qfit.size, 0))
        y += qH
      }
      let dividerY: number | null = null
      let translationZone: Rect | null = null
      if (s.tr) {
        if (s.divider) {
          dividerY = y + dividerH / 2
          y += dividerH
        } else if (y > top) y += M.gap * 0.5
        translationZone = { x: tx + (textColW - trWidth) / 2, y, w: trWidth, h: (s.tr[1] - s.tr[0]) * trLineH }
        y += translationZone.h
      }
      let tafsirCard: Rect | null = null
      if (s.tf) {
        const h = cardChrome + (s.tf[1] - s.tf[0]) * tfLineH
        if (twoCol) tafsirCard = { x: sx, y: midTop + Math.max(0, (regionH - h) / 2), w: sideColW, h }
        else {
          if (y > top) y += M.gap
          tafsirCard = { x: tx + (textColW - cardW) / 2, y, w: cardW, h }
        }
      }
      return {
        quranPage,
        opening: s.opening,
        translationLines: s.tr,
        tafsirLines: s.tf,
        legend: s.legend,
        contentBottom: bottom,
        quranZone,
        translationZone,
        dividerY,
        tafsirCard,
        tafsirFirst: s.tf !== null && s.tf[0] === 0,
        basmala: opening.basmala?.rect ?? null,
        istiadha: opening.istiadha?.rect ?? null,
      }
    })

    const pagerStyle = style(FONTS.ui, M.creditsSize * 0.95, P.tertiary)
    const drawStill = (p: Painter, shadow: string | null, k: number) => {
      const sp = stills[k]
      const opening = openings[k]
      drawHeader(p, shadow)
      if (sp.legend) drawLegend(p, shadow, legendTop(withPager))
      drawCredits(p, shadow)
      if (withPager) {
        const y = midBottom - pagerH * 0.38
        p.fillText(pageIndicator(k, pageCount), cx, y, recolor(pagerStyle, shadow))
        if (k < pageCount - 1) p.fillText(NEXT_PAGE_HINT, contentX, y, recolor({ ...pagerStyle, align: 'left' }, shadow))
      }
      if (opening.istiadha) drawOpeningLine(p, opening.istiadha, shadow ?? P.text)
      if (opening.basmala) drawOpeningLine(p, opening.basmala, shadow ?? P.text)
      if (sp.quranPage !== null) for (const pu of quranPages[sp.quranPage].placed) drawUnit(p, pu, sizeK, shadow ?? glyphColor)
      if (sp.dividerY !== null && !shadow) drawDivider(p, sp.dividerY)
      if (sp.translationZone && sp.translationLines) {
        const z = sp.translationZone
        trLines.slice(sp.translationLines[0], sp.translationLines[1]).forEach((ln, i) => p.fillText(ln, z.x + z.w / 2, z.y + trBaseline(i), recolor(trStyle, shadow)))
      }
      if (sp.tafsirCard && sp.tafsirLines) {
        drawCard(p, shadow, sp.tafsirCard, sp.tafsirFirst ? tfTag : CONTINUED_LABEL)
        drawTafsirLines(p, shadow, sp.tafsirCard, tfLines.slice(sp.tafsirLines[0], sp.tafsirLines[1]))
      }
    }

    const bgImg = bgSurface.snapshot()
    const cache = new Map<number, Layer>()
    const pageLayer = (k: number): Layer => {
      let l = cache.get(k)
      if (l) {
        cache.delete(k)
        cache.set(k, l) // most recent last
        return l
      }
      l = makeLayer({ x: 0, y: 0, w: W, h: H }, (p, shadow) => drawStill(p, shadow, k))
      cache.set(k, l)
      while (cache.size > STILL_CACHE) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return l
    }
    const drawPage = (painter: Painter, page: number) => {
      const k = clamp(Math.floor(Number.isFinite(page) ? page : 0), 0, pageCount - 1)
      painter.save()
      fitPainter(painter)
      painter.drawImage(bgImg, 0, 0, size.width, size.height)
      drawLayer(painter, pageLayer(k), 1)
      painter.restore()
    }
    const s0 = stills[0]
    const layout: SceneLayout = {
      size: qfit.size,
      pages: quranPages,
      paginated: qfit.paginated,
      quranZone: s0?.quranZone ?? { x: textColX + (textColW - quranW) / 2, y: midTop, w: quranW, h: 0 },
      translationZone: s0?.translationZone ?? null,
      tafsirCard: s0?.tafsirCard ?? null,
      basmala: s0?.basmala ?? null,
      istiadha: s0?.istiadha ?? null,
      legendRows: legendRows.length,
      stills,
      timed: [],
      plan,
    }
    return {
      durationMs: 0,
      pageCount,
      layout,
      draw: (painter) => drawPage(painter, 0),
      drawPage,
    }
  }

  // ───────────────────────── video: one page in time ─────────────────────────

  function buildVideo(): Pick<Scene, 'durationMs' | 'pageCount' | 'draw' | 'drawPage'> & { layout: SceneLayout } {
    const tl = timeline!
    // allocation in the text column: the Quran gets what the (capped) translation and tafsir views leave
    const regionH = regionBottom(legendRows.length > 0, false) - midTop
    const avail = regionH - openingH
    const trGapTotal = translationOn ? dividerH : 0
    const tfInCol = tafsirOn && !twoCol
    const tfGapTotal = tfInCol ? M.gap : 0
    const trNatural = trWrapped.reduce((m, t) => Math.max(m, t.lines.length * trLineH), 0)
    const tfNatural = tafsirOn ? cardChrome + Math.max(1, tfWrapped.reduce((m, t) => Math.max(m, t.lines.length), 0)) * tfLineH : 0
    const trCapFrac = tfInCol ? 0.2 : 0.3
    const tfCapFrac = translationOn ? 0.34 : 0.42
    let trH = translationOn ? Math.min(trNatural, avail * trCapFrac) : 0
    let tfH = tfInCol ? Math.min(tfNatural, Math.max(cardChrome + 2 * tfLineH, avail * tfCapFrac)) : 0
    // whole lines only
    if (translationOn) trH = Math.max(trLineH, Math.floor(trH / trLineH + 1e-6) * trLineH)
    const tfLinesFor = (h: number) => Math.max(1, Math.floor((h - cardChrome) / tfLineH + 1e-6))
    if (tfInCol) tfH = cardChrome + tfLinesFor(tfH) * tfLineH

    let quranZoneH = Math.max(M.quran.min * 2.5, avail - trH - tfH - trGapTotal - tfGapTotal)
    const fit = fitIn(quranZoneH)
    const usedH = Math.max(0, ...fit.pages.map((p) => blockHeight(p.lines.length, fit.size, metrics)))
    // give spare height back to the translation / tafsir views (less paging and scrolling)
    let spare = Math.max(0, quranZoneH - usedH)
    if (spare > 0 && tfInCol && tfH < tfNatural) {
      const add = Math.min(spare, tfNatural - tfH)
      const newH = cardChrome + tfLinesFor(tfH + add) * tfLineH
      spare -= newH - tfH
      tfH = newH
    }
    if (spare > 0 && translationOn && trH < trNatural) {
      const add = Math.min(spare, trNatural - trH)
      const newH = Math.floor((trH + add) / trLineH + 1e-6) * trLineH
      spare -= newH - trH
      trH = newH
    }
    quranZoneH = usedH
    // vertical placement: the group (opening + Quran + translation + tafsir) is centred in the text column
    const groupH = openingH + quranZoneH + (translationOn ? dividerH + trH : 0) + (tfInCol ? M.gap + tfH : 0)
    let y = midTop + Math.max(0, (regionH - groupH) / 2)
    const opening = openingLines(y, textColX, textColW)
    y += openingH
    const quranZone: Rect = { x: textColX + (textColW - quranW) / 2, y, w: quranW, h: quranZoneH }
    y += quranZoneH
    let translationZone: Rect | null = null
    let dividerY = 0
    if (translationOn) {
      dividerY = y + dividerH / 2
      y += dividerH
      translationZone = { x: textColX + (textColW - trWidth) / 2, y, w: trWidth, h: trH }
      y += trH
    }
    let tafsirCard: Rect | null = null
    if (tfInCol) {
      y += M.gap
      tafsirCard = { x: textColX + (textColW - cardW) / 2, y, w: cardW, h: tfH }
    } else if (tafsirOn) {
      const hh = cardChrome + tfLinesFor(Math.min(tfNatural, regionH)) * tfLineH
      tafsirCard = { x: sideColX, y: midTop + (regionH - hh) / 2, w: sideColW, h: hh }
    }

    // ── Quran pages: placement, regions, timing ──
    const k = fit.size / font.upem
    const starts = unitStarts(units, tl)
    const pStarts = pageStarts(fit.pages, starts)
    const pages: PageLayout[] = fit.pages.map((page, pi) => placeQuran(page, quranZone, fit.size, pStarts[pi] ?? 0))

    // ── base layer: background + chrome (header, legend, credits, divider, card chrome) ──
    const base = graphics.createSurface(size.width, size.height)
    base.painter.drawImage(bgSurface.snapshot(), 0, 0, size.width, size.height)
    {
      const chrome = makeLayer({ x: 0, y: 0, w: W, h: H }, (p, shadow) => {
        drawHeader(p, shadow)
        drawLegend(p, shadow, legendTop(false))
        drawCredits(p, shadow)
        if (translationZone && !shadow) drawDivider(p, dividerY)
        if (tafsirCard) drawCard(p, shadow, tafsirCard, '')
      })
      base.painter.drawImage(chrome.img, chrome.px.x, chrome.px.y, chrome.px.w, chrome.px.h)
    }
    const baseImg = base.snapshot()

    // ── Quran page layers ──
    const padY = fit.size * 0.9
    const padX = fit.size * 1.2
    const pageRect: Rect = { x: quranZone.x - padX, y: quranZone.y - padY, w: quranZone.w + 2 * padX, h: quranZone.h + 2 * padY }
    const pageLayers: Layer[] = pages.map((pl) => makeLayer(pageRect, (p, shadow) => pl.placed.forEach((pu) => drawUnit(p, pu, k, shadow ?? glyphColor))))

    // ── opening lines: their own layers (bright while recited, gold with word highlighting) ──
    const words = tl.words
    const highlightWords = design.highlightWords && words.length > 0
    const dimAyahs = design.highlightWords && words.length === 0
    const goldOpening = highlightWords && !design.showTajweed
    const lineBox = (ol: OpeningLine): Rect => {
      const s = ol.k * font.upem
      return { x: ol.rect.x - s, y: ol.rect.y - s * 0.5, w: ol.rect.w + 2 * s, h: ol.rect.h + s }
    }
    const openingLayer = (ol: OpeningLine | null, gold: boolean) =>
      ol ? { ol, plain: makeLayer(lineBox(ol), (p, shadow) => drawOpeningLine(p, ol, shadow ?? P.text)), gold: gold ? makeLayer(lineBox(ol), (p) => drawOpeningLine(p, ol, P.highlight), true, false) : null } : null
    const istiadhaL = openingLayer(opening.istiadha, goldOpening)
    const basmalaL = openingLayer(opening.basmala, goldOpening)
    const within = (w: { startMs: number; endMs: number } | null, t: number) => w !== null && t >= w.startMs && t < w.endMs
    /** visible while recited: fades in at its start (unless that is the very beginning) and out at its end */
    const istiadhaAlpha = (t: number): number => {
      if (!istiadhaWin) return 0
      const fadeIn = istiadhaWin.startMs <= 0 ? 1 : clamp((t - (istiadhaWin.startMs - FADE_MS / 2)) / FADE_MS, 0, 1)
      const fadeOut = clamp((istiadhaWin.endMs + FADE_MS / 2 - t) / FADE_MS, 0, 1)
      return Math.min(fadeIn, fadeOut)
    }

    // ── translation / tafsir: static, slow scroll or pages, in sync with the recitation ──
    const ayahWindows = new Map<number, { startMs: number; endMs: number }>()
    for (const a of tl.ayahs) if (a.ayah > 0 && !ayahWindows.has(a.ayah)) ayahWindows.set(a.ayah, a)
    const spanOf = (from: number, to: number): { start: number; end: number } => {
      let start = Number.POSITIVE_INFINITY
      let end = 0
      for (let n = from; n <= to; n++) {
        const w = ayahWindows.get(n)
        if (w) {
          start = Math.min(start, w.startMs)
          end = Math.max(end, w.endMs)
        }
      }
      return Number.isFinite(start) ? { start, end } : { start: 0, end: tl.durationMs }
    }

    const timedText = (
      lines: string[],
      lineH: number,
      view: Rect,
      span: { start: number; end: number },
      drawLine: (p: Painter, ln: string, i: number, shadow: string | null) => void,
      tag: string,
      centre: boolean,
    ): TimedText => {
      const contentH = lines.length * lineH
      const dur = Math.max(1, span.end - span.start)
      const hold = Math.min(dur * 0.18, 2200)
      const moving = Math.max(0, dur - 2 * hold)
      const layerOf = (ls: string[]) =>
        makeLayer({ x: 0, y: 0, w: view.w, h: Math.max(lineH, ls.length * lineH) }, (p, shadow) => ls.forEach((ln, i) => drawLine(p, ln, i, shadow)), false)
      const common = { viewH: view.h, start: span.start, end: span.end, tag, centre }
      if (contentH <= view.h + 0.5) return { mode: 'static', layers: [layerOf(lines)], heights: [contentH], ...common }
      if (view.h + MAX_SCROLL * moving >= contentH - 0.5) return { mode: 'scroll', layers: [layerOf(lines)], heights: [contentH], ...common }
      const per = Math.max(1, Math.floor(view.h / lineH + 1e-6))
      const chunks: string[][] = []
      for (let i = 0; i < lines.length; i += per) chunks.push(lines.slice(i, i + per))
      return { mode: 'pages', layers: chunks.map(layerOf), heights: chunks.map((c) => c.length * lineH), ...common }
    }

    const trTimed: TimedText[] = translationZone
      ? trWrapped.map((t) =>
          timedText(
            t.lines,
            trLineH,
            translationZone!,
            spanOf(Math.min(...t.ayahs), Math.max(...t.ayahs)),
            (p, ln, i, shadow) => p.fillText(ln, translationZone!.w / 2, trBaseline(i), recolor(trStyle, shadow)),
            '',
            false,
          ),
        )
      : []
    const tfView: Rect | null = tafsirCard ? { x: tafsirCard.x + tfPad, y: tafsirCard.y + tfPad + tfTitleH, w: tfInnerW, h: tafsirCard.h - cardChrome } : null
    const tfTimed: TimedText[] = tfView
      ? tfWrapped.map((t) =>
          timedText(
            t.lines,
            tfLineH,
            tfView,
            spanOf(Math.max(t.from, firstAyah), Math.min(t.to, lastAyah)),
            (p, ln, i, shadow) => p.fillText(ln, tfView.w, i * tfLineH + M.tafsirSize * 1.18, recolor(tfStyle, shadow)),
            t.tag,
            true,
          ),
        )
      : []

    // ── time → state ──
    const ayahIndexStarts: number[] = model.ayahs.map((a, i) => {
      const w = ayahWindows.get(a.number)
      if (w) return w.startMs
      const firstUnit = units.findIndex((u) => u.ayahIndex === i)
      return firstUnit >= 0 ? starts[firstUnit] : 0
    })
    const currentAyahIndex = (t: number): number => {
      let i = 0
      for (let k2 = 1; k2 < ayahIndexStarts.length; k2++) if (Number.isFinite(ayahIndexStarts[k2]) && ayahIndexStarts[k2] <= t) i = k2
      return i
    }
    const unitByWord = new Map<string, number>()
    units.forEach((u, i) => {
      if (u.kind === 'word') unitByWord.set(`${u.ayah}:${u.position}`, i)
    })
    const activeWord = (t: number): number => {
      // binary search: last word with startMs <= t
      let lo = 0
      let hi = words.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (words[mid].startMs <= t) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      if (found < 0) return -1
      const w = words[found]
      if (t >= w.endMs + HOLD_MS) return -1
      return unitByWord.get(`${w.ayah}:${w.word}`) ?? -1
    }
    const pageStartTimes = pages.map((pl) => pl.startMs)

    // which translation / tafsir text belongs to an ayah index
    const trIndexOfAyah = model.ayahs.map((a) => trWrapped.findIndex((t) => t.ayahs.includes(a.number)))
    const tfIndexOfAyah = model.ayahs.map((a) => tfTexts.findIndex((t) => t.from <= a.number && a.number <= t.to))

    const inOpening = (t: number) => within(istiadhaWin, t) || within(basmalaWin, t)

    const drawQuranPage = (p: Painter, pi: number, alpha: number, t: number) => {
      const layer = pageLayers[pi]
      if (!layer) return
      if (!dimAyahs) {
        drawLayer(p, layer, alpha)
        return
      }
      drawLayer(p, layer, alpha * DIM_ALPHA)
      if (inOpening(t)) return
      const regions = pages[pi].regions.get(currentAyahIndex(t)) ?? []
      p.save()
      if (alpha < 0.999) p.alpha(alpha)
      for (const r of regions) {
        const px = toPx(r, false)
        const sx = px.x - layer.px.x
        const sy = px.y - layer.px.y
        const x0 = clamp(sx, 0, layer.px.w)
        const y0 = clamp(sy, 0, layer.px.h)
        const x1 = clamp(sx + px.w, 0, layer.px.w)
        const y1 = clamp(sy + px.h, 0, layer.px.h)
        if (x1 - x0 < 1 || y1 - y0 < 1) continue
        p.drawImage(layer.img, layer.px.x + x0, layer.px.y + y0, x1 - x0, y1 - y0, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      }
      p.restore()
    }

    /** one line of the opening slot: band (tajweed highlighting) or gold layer while recited; dimmed after it */
    const drawOpening = (p: Painter, l: NonNullable<ReturnType<typeof openingLayer>>, win: { startMs: number; endMs: number } | null, alpha: number, t: number) => {
      if (alpha <= 0.001) return
      const reciting = within(win, t)
      if (reciting && highlightWords && design.showTajweed) {
        p.save()
        p.translate(ox, oy)
        p.scale(ps, ps)
        if (alpha < 0.999) p.alpha(alpha)
        const r = l.ol.rect
        const s = l.ol.k * font.upem
        p.fillRoundRect(r.x - s * 0.3, r.y, r.w + s * 0.6, r.h, s * 0.22, P.band)
        p.restore()
      }
      drawLayer(p, l.plain, alpha * (dimAyahs && !reciting ? DIM_ALPHA : 1))
      if (reciting && l.gold) drawLayer(p, l.gold, alpha)
    }

    /** a timed text in its view: static, scrolled to t, or the page of t (crossfading between pages) */
    const drawTimed = (p: Painter, tt: TimedText, view: Rect, alpha: number, t: number) => {
      if (alpha <= 0.001) return
      if (tt.mode === 'pages') {
        const n = tt.layers.length
        const dur = Math.max(1, tt.end - tt.start)
        // a page slot shorter than two fades still shows its page fully for most of it
        const seg = segmentAt(
          tt.layers.map((_, i) => tt.start + (dur * i) / n),
          t,
          Math.min(FADE_MS, (dur / n) * 0.4),
        )
        if (seg.prev >= 0 && seg.f < 1) drawSlice(p, tt, seg.prev, view, alpha * (1 - seg.f), 0)
        drawSlice(p, tt, seg.i, view, alpha * seg.f, 0)
        return
      }
      let offset = 0
      const extra = tt.heights[0] - tt.viewH
      if (tt.mode === 'scroll' && extra > 0.5) {
        const dur = Math.max(1, tt.end - tt.start)
        const hold = Math.min(dur * 0.18, 2200)
        const moving = Math.max(1, dur - 2 * hold)
        offset = extra * ease((t - tt.start - hold) / moving)
      }
      drawSlice(p, tt, 0, view, alpha, offset)
    }

    const drawSlice = (p: Painter, tt: TimedText, li: number, view: Rect, alpha: number, offset: number) => {
      const l = tt.layers[li]
      if (!l || alpha <= 0.001) return
      const contentH = tt.heights[li]
      const vpx = toPx(view, false)
      const extra = contentH - tt.viewH
      const visibleH = Math.min(contentH, tt.viewH)
      const srcY = offset * ps
      const h = Math.min(l.px.h - srcY, visibleH * ps)
      if (h < 1) return
      // whole pixels keep the text crisp
      const top = vpx.y + (tt.centre && extra < -0.5 ? Math.round((-extra / 2) * ps) : 0)
      p.save()
      p.alpha(alpha)
      const fadeH = Math.min(visibleH * 0.14, 44) * ps
      const scrolling = tt.mode === 'scroll' && extra > 0.5
      const topFade = scrolling && offset > 0.5 ? fadeH * clamp(offset / 30, 0, 1) : 0
      const bottomFade = scrolling && offset < extra - 0.5 ? fadeH * clamp((extra - offset) / 30, 0, 1) : 0
      const SLICES = 6
      const slice = (from: number, to: number, a: number) => {
        if (to - from < 0.5) return
        if (a < 0.999) {
          p.save()
          p.alpha(a)
        }
        p.drawImage(l.img, vpx.x, top + from, l.px.w, to - from, { x: 0, y: srcY + from, w: l.px.w, h: to - from })
        if (a < 0.999) p.restore()
      }
      if (topFade > 0) for (let s = 0; s < SLICES; s++) slice((topFade * s) / SLICES, (topFade * (s + 1)) / SLICES, (s + 0.5) / SLICES)
      slice(topFade, h - bottomFade, 1)
      if (bottomFade > 0) for (let s = 0; s < SLICES; s++) slice(h - bottomFade + (bottomFade * s) / SLICES, h - bottomFade + (bottomFade * (s + 1)) / SLICES, 1 - (s + 0.5) / SLICES)
      p.restore()
    }

    const drawTafsirTag = (p: Painter, tag: string, alpha: number) => {
      if (!tafsirCard || !tag || alpha <= 0.001) return
      p.save()
      p.translate(ox, oy)
      p.scale(ps, ps)
      p.alpha(alpha)
      p.fillText(tag, tafsirCard.x + tfPad, tafsirCard.y + tfPad + M.tafsirTitleSize * 1.05, tfTagStyle)
      p.restore()
    }

    /** Switch times between distinct per-ayah contents (translation / tafsir index per ayah). */
    const switchesOf = (indexOfAyah: number[]) => {
      const seq: { idx: number; start: number }[] = []
      indexOfAyah.forEach((idx, ai) => {
        if (!seq.length || seq[seq.length - 1].idx !== idx) seq.push({ idx, start: ai === 0 ? 0 : ayahIndexStarts[ai] })
      })
      return { idx: seq.map((s) => s.idx), starts: seq.map((s) => s.start) }
    }
    const trSwitches = switchesOf(trIndexOfAyah)
    const tfSwitches = switchesOf(tfIndexOfAyah)

    /** Crossfading pair of indices for per-ayah content (translation, tafsir) at time t. */
    const contentAt = (sw: { idx: number[]; starts: number[] }, t: number): { idx: number; a: number }[] => {
      const seg = segmentAt(sw.starts, t, FADE_MS)
      const out = [{ idx: sw.idx[seg.i] ?? -1, a: seg.f }]
      if (seg.prev >= 0 && seg.f < 1) out.push({ idx: sw.idx[seg.prev], a: 1 - seg.f })
      return out
    }

    const draw = (painter: Painter, tMs: number) => {
      const t = clamp(Number.isFinite(tMs) ? tMs : 0, 0, tl.durationMs)
      painter.save()
      fitPainter(painter)
      painter.drawImage(baseImg, 0, 0, size.width, size.height)

      // Quran page(s)
      const seg = segmentAt(pageStartTimes, t, FADE_MS)
      if (seg.prev >= 0 && seg.f < 1) drawQuranPage(painter, seg.prev, 1 - seg.f, t)
      drawQuranPage(painter, seg.i, seg.f, t)

      // opening slot: the isti'adha while it is recited, then the basmala
      const ia = istiadhaL ? istiadhaAlpha(t) : 0
      if (istiadhaL) drawOpening(painter, istiadhaL, istiadhaWin, ia, t)
      if (basmalaL) drawOpening(painter, basmalaL, basmalaWin, istiadhaL ? 1 - ia : 1, t)

      // the recited word in gold (tajweed: a soft gold band, glyphs keep their rule colours)
      if (highlightWords) {
        const ui = activeWord(t)
        const pl = pages[seg.i]
        if (ui >= 0 && pl && ui >= pl.page.first && ui < pl.page.end) {
          const pu = pl.placed[ui - pl.page.first]
          painter.save()
          painter.translate(ox, oy)
          painter.scale(ps, ps)
          if (seg.f < 1) painter.alpha(seg.f)
          if (design.showTajweed) {
            const w = pu.unit.advance * k
            painter.fillRoundRect(pu.x - fit.size * 0.12, pu.baseline - fit.size * 1.12, w + fit.size * 0.24, fit.size * 1.62, fit.size * 0.22, P.band)
            drawUnit(painter, pu, k, glyphColor)
          } else drawUnit(painter, pu, k, (g) => (g.role === 'text' ? P.highlight : glyphColor(g)))
          painter.restore()
        }
      }

      // translation of the current ayah
      if (translationZone && trTimed.length) {
        for (const { idx, a } of contentAt(trSwitches, t)) {
          const tt = trTimed[idx]
          if (tt) drawTimed(painter, tt, translationZone, a, t)
        }
      }
      // tafsir of the current ayah
      if (tfView && tfTimed.length) {
        for (const { idx, a } of contentAt(tfSwitches, t)) {
          const tt = tfTimed[idx]
          if (!tt) continue
          drawTimed(painter, tt, tfView, a, t)
          drawTafsirTag(painter, tt.tag, a)
        }
      }
      painter.restore()
    }

    const layout: SceneLayout = {
      size: fit.size,
      pages,
      paginated: fit.paginated,
      quranZone,
      translationZone,
      tafsirCard,
      basmala: opening.basmala?.rect ?? null,
      istiadha: opening.istiadha?.rect ?? null,
      legendRows: legendRows.length,
      stills: [],
      timed: [
        ...trTimed.map((tt) => ({ kind: 'translation' as const, mode: tt.mode, pages: tt.layers.length, start: tt.start, end: tt.end })),
        ...tfTimed.map((tt) => ({ kind: 'tafsir' as const, mode: tt.mode, pages: tt.layers.length, start: tt.start, end: tt.end })),
      ],
      plan: 'video',
    }
    return {
      durationMs: tl.durationMs,
      pageCount: 1,
      layout,
      draw,
      drawPage: (painter) => draw(painter, 0),
    }
  }
}

