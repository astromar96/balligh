// Tajweed rule catalogue + legend — research/fonts-rendering.md §0.5/§8.3, research/fixtures/fonts-rendering/tajweed-rules.json.
// Only rule ids and word texts are read, so the display encoding (QPC or Tanzil) does not matter here.
import type { Ayah, TajweedRuleId } from '../core/types'
import type { TajweedRuleInfo } from './index'
import { TAJWEED_CATALOGUE } from './tajweed-catalogue'

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export const TAJWEED_RULE_TABLE: Record<string, TajweedRuleInfo> = Object.fromEntries(TAJWEED_CATALOGUE.map((r) => [r.id, r]))

/**
 * Markup classes that are not rules of their own. `custom-alef-maksora` is a rendering helper always nested
 * inside `madda_normal` (inherit its colour, keep it out of the legend); `end` wraps the ayah number.
 */
const ALIASES: Record<string, string> = { 'custom-alef-maksora': 'madda_normal' }

/**
 * Colours for a class this catalogue does not know: the plain ink of the design brief (light backgrounds)
 * and the dark-mode text colour (dark backgrounds), so an unknown class is drawn like ordinary text rather
 * than in a colour that means something else (grey = silent).
 */
export const NEUTRAL_RULE_COLORS = { color: '#16222E', colorDark: '#ECE6D8' } as const

/** The catalogue id a markup class is shown as (aliases resolved), or null when it is not a known rule. */
export function canonicalRuleId(id: TajweedRuleId): string | null {
  const key = typeof id === 'string' ? id.trim() : ''
  if (has(TAJWEED_RULE_TABLE, key)) return key
  if (has(ALIASES, key)) return ALIASES[key]
  return null
}

export function ruleInfo(id: TajweedRuleId): TajweedRuleInfo {
  const key = typeof id === 'string' ? id.trim() : String(id)
  if (has(TAJWEED_RULE_TABLE, key)) return TAJWEED_RULE_TABLE[key]
  if (has(ALIASES, key)) return { ...TAJWEED_RULE_TABLE[ALIASES[key]], id: key }
  return {
    id: key,
    nameAr: 'حكم تجويد',
    nameEn: 'Tajweed rule',
    color: NEUTRAL_RULE_COLORS.color,
    colorDark: NEUTRAL_RULE_COLORS.colorDark,
    explanationAr: '',
    explanationEn: '',
    citeAr: '',
    fallback: true,
  }
}

const MAX_EXAMPLES = 3

export function rulesInAyahs(ayahs: Ayah[]): { rule: TajweedRuleInfo; examples: string[] }[] {
  const examples = new Map<string, string[]>()
  for (const a of ayahs ?? []) {
    for (const w of a?.words ?? []) {
      const spans = Array.isArray(w?.tajweed) ? [...w.tajweed].sort((x, y) => x.start - y.start) : []
      const text = typeof w.text === 'string' ? w.text.trim() : ''
      for (const sp of spans) {
        const id = canonicalRuleId(sp?.rule)
        if (!id) continue
        let ex = examples.get(id)
        if (!ex) examples.set(id, (ex = []))
        if (text && ex.length < MAX_EXAMPLES && !ex.includes(text)) ex.push(text)
      }
    }
  }
  return [...examples].map(([id, ex]) => ({ rule: TAJWEED_RULE_TABLE[id], examples: ex }))
}
