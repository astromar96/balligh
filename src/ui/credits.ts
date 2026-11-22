// What a shared clip's text names as its sources (research/00-gaps.md §2.9 and §6.2): the credits the export carries
// burned in, repeated — Quran.com / Quran Foundation always (the text and timings, and QF's audio hosts); a video also
// its recitation's sources (EveryAyah.com, quran-align …; the reciter and riwayah have a line of their own); the
// tafsir (publisher + host [+ QuranEnc version]) and the translation when they are shown.
import type { RenderModel } from '../core/types'
import type { Language } from './i18n'

/** The Quran Foundation credit, spelled as render burns it into every export. */
export const QF_CREDIT = 'Quran.com / Quran Foundation'

export function shareSources(
  kind: 'video' | 'image',
  model: RenderModel | null,
  shown: { tafsir: boolean; translation: boolean },
  lang: Language,
): string[] {
  const out: string[] = []
  const add = (s: string | null | undefined) => {
    const v = s?.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  if (shown.tafsir && model?.tafsir && model.tafsirSource) add(model.tafsirCreditAr ?? (lang === 'ar' ? model.tafsirSource.nameAr : model.tafsirSource.nameEn))
  if (shown.translation && model?.translation && model.translationSource) add(`${model.translationSource.name} (${model.translationSource.langName})`)
  // "Quran.com" in a reciter's sources is the QF credit itself, named in full below
  if (kind === 'video' && model?.reciter) for (const s of model.reciter.sourceName.split('·')) if (s.trim() !== 'Quran.com') add(s)
  add(QF_CREDIT)
  return out
}
