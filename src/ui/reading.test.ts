import type { TafsirSource, TranslationSource } from '../core/types'
import { filterTranslations, readerItems, tafsirGroup } from './reading'

const source = (over: Partial<TafsirSource>): TafsirSource => ({
  id: 'x',
  nameAr: 'س',
  nameEn: 'X',
  length: 'short',
  kind: 'tafsir',
  noteAr: '',
  creditAr: '',
  ...over,
})

describe('tafsirGroup', () => {
  it('puts short works under «مناسب للمشاركة», others under reading, fiqh works apart', () => {
    expect(tafsirGroup(source({ length: 'short' }))).toBe('short')
    expect(tafsirGroup(source({ length: 'medium' }))).toBe('long')
    expect(tafsirGroup(source({ length: 'long' }))).toBe('long')
    expect(tafsirGroup(source({ length: 'short', kind: 'ahkam' }))).toBe('ahkam')
  })
})

describe('readerItems', () => {
  it('turns entries into a heading per entry, one item per paragraph, then the credit', () => {
    const items = readerItems(
      [
        { ayahFrom: 255, ayahTo: 255, text: 'الأولى.\n\nالثانية.\n\n\n' },
        { ayahFrom: 256, ayahTo: 257, text: 'جملة واحدة' },
      ],
      (e) => (e.ayahFrom === e.ayahTo ? `آية ${e.ayahFrom}` : `آيات ${e.ayahFrom}–${e.ayahTo}`),
      'المصدر',
    )
    expect(items.map((i) => [i.kind, i.text])).toEqual([
      ['heading', 'آية 255'],
      ['para', 'الأولى.'],
      ['para', 'الثانية.'],
      ['heading', 'آيات 256–257'],
      ['para', 'جملة واحدة'],
      ['credit', 'المصدر'],
    ])
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
  })

  it('leaves the credit out when there is none', () => {
    expect(readerItems([], () => '', '')).toEqual([])
  })
})

describe('filterTranslations', () => {
  const list: TranslationSource[] = [
    { id: 20, lang: 'en', langName: 'English', name: 'Saheeh International', dir: 'ltr', script: 'Latn' },
    { id: 31, lang: 'fr', langName: 'Français', name: 'Muhammad Hamidullah', dir: 'ltr', script: 'Latn' },
    { id: 97, lang: 'ur', langName: 'اردو', name: 'Tafheem e Quran', dir: 'rtl', script: 'Arab' },
  ]
  const ids = (q: string) => filterTranslations(list, q).map((t) => t.id)

  it('matches the edition, the language name in Latin or Arabic script, or an exact code', () => {
    expect(ids('')).toEqual([20, 31, 97])
    expect(ids('saheeh')).toEqual([20])
    expect(ids('francais')).toEqual([31])
    expect(ids('اردو')).toEqual([97])
    expect(ids('ur')).toEqual([97])
    expect(ids('nothing here')).toEqual([])
  })
})
