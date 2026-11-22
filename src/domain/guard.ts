// Boundary-guard data and text tests — research/features.md §2.3 (prototype research/scripts/features/boundary_check.py,
// cases in research/fixtures/features/boundary_check_results.json). Text is compared only after normalizeForSearch, so
// the display encoding does not matter: Tanzil text_uthmani and qpcToStandard(text_qpc_hafs) normalise to the same key
// for 77,427 of 77,429 words, and both find the same 1,120 speech verbs and 54 «إِلَّا» ayah starts (corpus.test.ts).
import { normalizeForSearch } from './arabic'

export interface CuratedEnd {
  surah: number
  ayah: number
  /** why ending here misleads (internal note, English) */
  note: string
  source: string
}

/**
 * Whole ayahs that must not END a clip although they are complete ayahs: ending there inverts the meaning. Keep it
 * small, sourced and reviewed; extend it by review, never by heuristics (features §2.3 "UX rules").
 */
export const CURATED_END: readonly CuratedEnd[] = [
  {
    surah: 107,
    ayah: 4,
    note: '«فَوَيْلٌ لِّلْمُصَلِّينَ»: the threat is for those described in 107:5–6; ending here inverts the meaning',
    source:
      'research/features.md §2.3 CURATED_END; islamqa.info/ar/answers/229818, citing Ibn Taymiyya: stopping at «فويل للمصلين» without continuing is a stop that breaks the meaning',
  },
]

export function curatedEnd(surah: number, ayah: number): CuratedEnd | null {
  return CURATED_END.find((c) => c.surah === surah && c.ayah === ayah) ?? null
}

/** features §2.3: قال/قالوا/قالت/قالتا/يقول/يقولون/تقول/تقولون/نقول/قيل with an optional و or ف, as whole words. */
const SPEECH_VERB = /^[وف]?(?:قال|قالوا|قالت|قالتا|يقول|يقولون|تقول|تقولون|نقول|قيل)$/

/** True for a speech verb that opens a quotation (1,120 words of the Quran; the same in both encodings). */
export function isSpeechVerb(text: string): boolean {
  return SPEECH_VERB.test(normalizeForSearch(text))
}

/** Arabic letters (marks, tatweel, ۞ and spaces are not). */
const LETTER = /[ء-غف-يٮٯٱ-ۓۺ-ۼ]/
const HAMZA_BELOW = 'ٕ'

/**
 * True for the exception particle «إِلَّا» / «إِلَّآ», in either encoding. normalizeForSearch alone cannot tell it from
 * «أَلَا» / «أَلَآ» / «أَلَّا» (all fold to «الا»; 18 ayahs start with one of those): the first letter must carry hamza
 * below — U+0625, U+0673, or alef + U+0655.
 */
export function isIlla(text: string): boolean {
  if (typeof text !== 'string' || normalizeForSearch(text) !== 'الا') return false
  const chars = [...text]
  const i = chars.findIndex((c) => LETTER.test(c))
  if (i < 0) return false
  const first = chars[i]
  if (first === 'إ' || first === 'ٳ') return true
  if (first !== 'ا') return false
  for (let k = i + 1; k < chars.length && !LETTER.test(chars[k]); k++) if (chars[k] === HAMZA_BELOW) return true
  return false
}
