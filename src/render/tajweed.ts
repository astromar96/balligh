// Tajweed colours for drawn glyphs and the legend.
// Palette: KFGQPC V4 (the printed colour-coded mushaf) — research/fonts-rendering.md §8.3 and
// research/fixtures/fonts-rendering/tajweed-rules.json. 'light' = palette 0 (for DARK text on light
// backgrounds), 'dark' = palette 1 (for LIGHT text on dark backgrounds).
// domain/ruleInfo is the source of truth (names, color, colorDark, group); the local table below is
// the same palette, used only when domain/ cannot answer.
import type { TajweedRuleId, TajweedSpan } from '../core/types'
import { ruleInfo } from '../domain'

interface RuleStyle {
  light: string
  dark: string
  /** legend grouping, in the printed key's order: silent, madd, ghunnah, qalqalah */
  group: number
  /** fallback Arabic name (domain/ruleInfo is the source of truth) */
  nameAr: string
}

const SILENT = 0
const MADD = 1
const GHUNNAH = 2
const QALQALAH = 3

const GREY = { light: '#A3A5A5', dark: '#999999' }
const GREEN = { light: '#09B000', dark: '#26B55D' }
const RED = { light: '#F40000', dark: '#FF5E8E' }

export const RULE_STYLES: Record<string, RuleStyle> = {
  ham_wasl: { light: '#9FA5A5', dark: '#919999', group: SILENT, nameAr: 'همزة الوصل' },
  laam_shamsiyah: { ...GREY, group: SILENT, nameAr: 'اللام الشمسية' },
  slnt: { ...GREY, group: SILENT, nameAr: 'حرف لا يُنطق' },
  idgham_wo_ghunnah: { ...GREY, group: SILENT, nameAr: 'الإدغام بغير غنة' },
  idgham_mutajanisayn: { ...GREY, group: SILENT, nameAr: 'إدغام المتجانسين' },
  idgham_mutaqaribayn: { ...GREY, group: SILENT, nameAr: 'إدغام المتقاربين' },
  madda_necessary: { light: '#B50000', dark: '#E30000', group: MADD, nameAr: 'المد اللازم' },
  madda_obligatory: { ...RED, group: MADD, nameAr: 'المد الواجب والجائز' },
  madda_obligatory_mottasel: { ...RED, group: MADD, nameAr: 'المد الواجب المتصل' },
  madda_obligatory_monfasel: { ...RED, group: MADD, nameAr: 'المد الجائز المنفصل' },
  madda_permissible: { light: '#FF7B00', dark: '#FF8E3B', group: MADD, nameAr: 'المد العارض للسكون' },
  madda_normal: { light: '#CE9E00', dark: '#FFC1E0', group: MADD, nameAr: 'المد الطبيعي' },
  ghunnah: { ...GREEN, group: GHUNNAH, nameAr: 'الغنة' },
  ikhafa: { ...GREEN, group: GHUNNAH, nameAr: 'الإخفاء' },
  ikhafa_shafawi: { ...GREEN, group: GHUNNAH, nameAr: 'الإخفاء الشفوي' },
  idgham_ghunnah: { ...GREEN, group: GHUNNAH, nameAr: 'الإدغام بغنة' },
  idgham_shafawi: { ...GREEN, group: GHUNNAH, nameAr: 'الإدغام الشفوي' },
  iqlab: { ...GREEN, group: GHUNNAH, nameAr: 'الإقلاب' },
  qalaqah: { light: '#2FADFF', dark: '#00DEFF', group: QALQALAH, nameAr: 'القلقلة' },
}

/** Helper classes in QF markup that are not rules (inherit the parent colour, never in the legend). */
const NOT_A_RULE = new Set(['custom-alef-maksora', 'end'])

export function isLegendRule(rule: TajweedRuleId): boolean {
  return !NOT_A_RULE.has(rule)
}

const GROUP_ORDER: Record<string, number> = { silent: SILENT, madd: MADD, ghunnah: GHUNNAH, qalqalah: QALQALAH }

/** Style of a rule: domain's catalogue first, the local table when domain/ throws; null = plain text. */
function styleOf(rule: TajweedRuleId): RuleStyle | null {
  if (NOT_A_RULE.has(rule)) return null
  const local = RULE_STYLES[rule]
  try {
    const info = ruleInfo(rule)
    // an unknown class: drawn like ordinary text, kept out of the legend
    if (info?.fallback) return null
    if (info?.color) {
      return {
        light: info.color,
        dark: info.colorDark ?? local?.dark ?? info.color,
        group: info.group ? (GROUP_ORDER[info.group] ?? 9) : (local?.group ?? 9),
        nameAr: info.nameAr || local?.nameAr || String(rule),
      }
    }
  } catch {
    // domain/ unavailable — the local table has the same palette
  }
  return local ?? null
}

/**
 * Colour for a rule's glyphs. `textTone` is the tone of the base text: light text sits on a dark
 * background and gets the V4 dark palette; dark text gets palette 0. null → draw as plain text.
 */
export function ruleColor(rule: TajweedRuleId, textTone: 'light' | 'dark'): string | null {
  const s = styleOf(rule)
  return s ? (textTone === 'light' ? s.dark : s.light) : null
}

export function ruleNameAr(rule: TajweedRuleId): string {
  return styleOf(rule)?.nameAr ?? String(rule)
}

/**
 * Per-character rule for a word: inner (shorter) spans win over the spans that contain them;
 * helper classes are ignored so they inherit the enclosing rule.
 */
export function charRules(textLength: number, spans: TajweedSpan[]): (TajweedRuleId | null)[] {
  const out: (TajweedRuleId | null)[] = new Array(textLength).fill(null)
  const ordered = spans
    .filter((s) => !NOT_A_RULE.has(s.rule) && s.end > s.start)
    .slice()
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  for (const s of ordered) {
    const a = Math.max(0, s.start)
    const b = Math.min(textLength, s.end)
    for (let i = a; i < b; i++) out[i] = s.rule
  }
  return out
}

/**
 * Rule of each shaped glyph: a glyph covers the characters [cluster, next cluster start); it takes the
 * first non-null rule in that range (a ligature that straddles a colour edge — fonts-rendering §4).
 * Glyphs whose cluster lies beyond `textLength` (an appended pause mark) get null.
 */
export function glyphRules(clusters: number[], textLength: number, rules: (TajweedRuleId | null)[]): (TajweedRuleId | null)[] {
  const starts = [...new Set(clusters)].sort((a, b) => a - b)
  const nextStart = new Map<number, number>()
  for (let i = 0; i < starts.length; i++) nextStart.set(starts[i], i + 1 < starts.length ? starts[i + 1] : Number.POSITIVE_INFINITY)
  return clusters.map((cl) => {
    if (cl >= textLength) return null
    const end = Math.min(textLength, nextStart.get(cl) ?? textLength)
    for (let i = cl; i < end; i++) if (rules[i]) return rules[i]
    return null
  })
}

export interface LegendItem {
  color: string
  /** names that share this colour, first-appearance order */
  names: string[]
}

/**
 * Legend entries for the rules present, grouped by colour as in the printed mushaf key
 * (grey "not pronounced", reds/orange/gold "madd", green "ghunnah", blue "qalqalah").
 */
export function legendItems(rules: TajweedRuleId[], textTone: 'light' | 'dark'): LegendItem[] {
  const seen = new Set<string>()
  const entries: { color: string; name: string; group: number; order: number }[] = []
  rules.forEach((rule, order) => {
    if (!isLegendRule(rule) || seen.has(rule)) return
    seen.add(rule)
    const s = styleOf(rule)
    if (!s) return
    entries.push({ color: textTone === 'light' ? s.dark : s.light, name: s.nameAr, group: s.group, order })
  })
  entries.sort((a, b) => a.group - b.group || a.order - b.order)
  const items: LegendItem[] = []
  for (const e of entries) {
    // hamzat al-wasl's grey differs from the other greys by a few levels: one swatch, not two
    const item = items.find((it) => sameSwatch(it.color, e.color))
    if (item) {
      if (!item.names.includes(e.name)) item.names.push(e.name)
    } else items.push({ color: e.color, names: [e.name] })
  }
  return items
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Colours a reader cannot tell apart in a 14-px dot (every channel within 10 levels). */
function sameSwatch(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true
  const x = rgb(a)
  const y = rgb(b)
  return !!x && !!y && x.every((v, i) => Math.abs(v - y[i]) <= 10)
}
