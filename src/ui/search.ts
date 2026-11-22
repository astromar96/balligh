// Surah picker search (pure, unit-tested): surah names in Arabic or English, numbers in Western,
// Arabic-Indic or Persian digits. Text hits come from data.searchQuran.
import type { Surah } from '../core/types'
import { foldArabic, foldLatin, fromIndic } from './format'

export interface TextHit {
  surah: number
  ayah: number
  text: string
}

/** Filters surahs by number, Arabic name (diacritics/alef forms ignored) or English name. */
export function filterSurahs(surahs: Surah[], query: string): Surah[] {
  const q = query.trim()
  if (!q) return surahs
  const digits = fromIndic(q).replace(/\s/g, '')
  if (/^\d+$/.test(digits)) {
    const n = Number(digits)
    return surahs.filter((s) => s.number === n || String(s.number).startsWith(digits))
  }
  const qa = foldArabic(q).replace(/^سوره\s*/, '').replace(/^ال/, '')
  const ql = foldLatin(q).replace(/^(surah|sura|al|an|ar|as|at|ad|az)/, '')
  return surahs.filter((s) => {
    const ar = foldArabic(s.nameArabic)
    if (qa && (ar.includes(qa) || ar.replace(/^ال/, '').startsWith(qa))) return true
    if (ql.length > 0) {
      const en = foldLatin(s.nameSimple)
      const tr = foldLatin(s.nameTranslated)
      if (en.includes(ql) || tr.includes(ql) || en.replace(/^(al|an|ar|as|at|ad|az)/, '').startsWith(ql)) return true
    }
    return false
  })
}

/** Text hits shown under the surah list. */
export const TEXT_HIT_LIMIT = 30

/** The query to search the Quran text with: three letters or more, and never a number (that is a surah number). */
export function textQuery(query: string): string | null {
  const q = query.trim()
  return q.length >= 3 && !/^\d+$/.test(fromIndic(q)) ? q : null
}
