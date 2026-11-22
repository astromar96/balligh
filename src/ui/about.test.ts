import type { Reciter, TafsirSource } from '../core/types'
import * as data from '../data'
import { aboutGroups, joinNames } from './about'
import { translate } from './i18n'

describe('joinNames', () => {
  it('joins names in each language’s list style', () => {
    expect(joinNames('ar', [])).toBe('')
    expect(joinNames('ar', ['أ'])).toBe('أ')
    expect(joinNames('ar', ['أ', 'ب', 'ج'])).toBe('أ، ب وج')
    expect(joinNames('en', ['A', 'B', 'C'])).toBe('A, B and C')
  })
})

describe('aboutGroups', () => {
  const reciters = data.RECITERS as readonly Reciter[]
  const tafsirs = data.TAFSIRS as readonly TafsirSource[]

  it('gives every group a title in both languages and every item a role', () => {
    for (const lang of ['ar', 'en'] as const) {
      const groups = aboutGroups(lang, reciters, tafsirs)
      expect(groups.map((g) => g.title)).toEqual(['aboutText', 'aboutAudio', 'aboutTafsir', 'aboutTranslations', 'aboutFonts', 'aboutSoftware'])
      for (const g of groups) {
        expect(translate(lang, g.title)).not.toBe(g.title)
        for (const item of g.items) {
          expect(item.name.length).toBeGreaterThan(1)
          expect(item.role.length).toBeGreaterThan(5)
          if (item.url) expect(item.url).toMatch(/^https:\/\//)
          if (item.licenceUrl) expect(item.licenceUrl).toMatch(/^https:\/\//)
        }
      }
    }
  })

  it('credits the Tanzil Project with a link and its CC BY 3.0 licence', () => {
    const tanzil = aboutGroups('ar', reciters, tafsirs)[0].items.find((i) => i.name === 'Tanzil Project')
    expect(tanzil?.url).toBe('https://tanzil.net')
    expect(tanzil?.licence).toContain('CC BY 3.0')
  })

  it('links the Quran Foundation terms wherever its content is used', () => {
    const items = aboutGroups('en', reciters, tafsirs).flatMap((g) => g.items)
    const qf = items.filter((i) => /Quran Foundation/.test(i.name))
    expect(qf.length).toBeGreaterThanOrEqual(2)
    for (const i of qf) expect(i.licenceUrl).toMatch(/quran\.foundation/)
  })

  it('names every tafsir the app offers with its credit line', () => {
    const tafsirGroup = aboutGroups('ar', reciters, tafsirs).find((g) => g.title === 'aboutTafsir')
    expect(tafsirGroup?.note).toBeTruthy()
    for (const t of tafsirs) expect(tafsirGroup?.items).toContainEqual(expect.objectContaining({ name: t.nameAr, role: t.creditAr }))
  })

  it('names the reciters each audio host serves', () => {
    const audio = aboutGroups('en', reciters, tafsirs).find((g) => g.title === 'aboutAudio')
    const someB = reciters.find((r) => r.timingClass === 'B')
    if (someB) expect(audio?.items.find((i) => i.name.startsWith('QuranicAudio'))?.role).toContain(someB.nameEn)
  })
})
