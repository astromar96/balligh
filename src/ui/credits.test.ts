import { describe, expect, it } from 'vitest'
import type { Reciter, RenderModel, TafsirSource, TranslationSource } from '../core/types'
import { QF_CREDIT, shareSources } from './credits'

const reciter = { id: 'alafasy', nameAr: 'مشاري راشد العفاسي', sourceName: 'EveryAyah.com · Quran.com · quran-align (CC BY 4.0)' } as unknown as Reciter
const tafsirSource = { id: 'mukhtasar', nameAr: 'المختصر', nameEn: 'Al-Mukhtasar', creditAr: 'المختصر · QuranEnc.com' } as unknown as TafsirSource
const translationSource = { id: 20, name: 'Saheeh International', langName: 'English' } as unknown as TranslationSource
const model = (patch: Partial<RenderModel> = {}): RenderModel =>
  ({ reciter, tafsir: null, tafsirSource: null, tafsirCreditAr: null, translation: null, translationSource: null, ...patch }) as RenderModel
const none = { tafsir: false, translation: false }

describe('share-text sources (00-gaps §2.9, §6.2)', () => {
  it('always names Quran.com / Quran Foundation, last', () => {
    expect(shareSources('image', model(), none, 'ar')).toEqual([QF_CREDIT])
    expect(shareSources('image', null, none, 'en')).toEqual([QF_CREDIT])
  })

  it('a video adds its recitation sources, without repeating Quran.com', () => {
    expect(shareSources('video', model(), none, 'ar')).toEqual(['EveryAyah.com', 'quran-align (CC BY 4.0)', QF_CREDIT])
    // a still has no recitation
    expect(shareSources('image', model(), none, 'ar')).toEqual([QF_CREDIT])
  })

  it('names the provider that served the tafsir and the translation, only when shown', () => {
    const m = model({
      tafsir: [{ ayahFrom: 1, ayahTo: 1, text: 'x' }],
      tafsirSource,
      tafsirCreditAr: 'المختصر · QuranEnc.com (الإصدار 1.0.0)',
      translation: [{ ayah: 1, text: 'y' }],
      translationSource,
    })
    expect(shareSources('image', m, { tafsir: true, translation: true }, 'ar')).toEqual([
      'المختصر · QuranEnc.com (الإصدار 1.0.0)',
      'Saheeh International (English)',
      QF_CREDIT,
    ])
    expect(shareSources('image', m, none, 'ar')).toEqual([QF_CREDIT])
    // without the served credit: the source's name in the UI language
    expect(shareSources('image', { ...m, tafsirCreditAr: null }, { tafsir: true, translation: false }, 'en')).toEqual(['Al-Mukhtasar', QF_CREDIT])
  })
})
