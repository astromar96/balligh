// Tafsir and translation helpers behind the content panel (pure, unit-tested).
import type { TafsirEntry, TafsirSource, TranslationSource } from '../core/types'
import { foldArabic, foldLatin } from './format'

export type TafsirGroup = 'short' | 'long' | 'ahkam'

export function tafsirGroup(s: TafsirSource): TafsirGroup {
  if (s.kind === 'ahkam') return 'ahkam'
  return s.length === 'short' ? 'short' : 'long'
}

export interface ReaderItem {
  key: string
  kind: 'heading' | 'para' | 'credit'
  text: string
}

export function readerItems(entries: TafsirEntry[], heading: (e: TafsirEntry) => string, credit: string): ReaderItem[] {
  const out: ReaderItem[] = []
  entries.forEach((e, i) => {
    out.push({ key: `h${i}`, kind: 'heading', text: heading(e) })
    e.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((p, j) => out.push({ key: `p${i}.${j}`, kind: 'para', text: p }))
  })
  if (credit) out.push({ key: 'credit', kind: 'credit', text: credit })
  return out
}

/** Translation search: English or native name, language name, or an exact language code ("ur"). */
export function filterTranslations(list: TranslationSource[], query: string): TranslationSource[] {
  const q = query.trim()
  if (!q) return list
  const qa = foldArabic(q)
  const ql = foldLatin(q)
  return list.filter(
    (s) =>
      (ql && (foldLatin(s.name).includes(ql) || foldLatin(s.langName).includes(ql) || foldLatin(s.lang) === ql)) ||
      (qa && (foldArabic(s.name).includes(qa) || foldArabic(s.langName).includes(qa))),
  )
}
