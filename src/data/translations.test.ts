// Translations: footnote markup in every observed variant, paged requests, QuranEnc fallback, unavailable editions,
// and the script/direction of each edition's text.
import { mockNet, resetDataCaches, type MockNet } from './__fixtures__/net'
import qcMarkup from './__fixtures__/qc-verses-2_255-translation-markup.json'
import qcTr131 from './__fixtures__/qc-tr-131-empty.json'
import qcTr20s103 from './__fixtures__/qc-tr-20-103.json'
import qcTr20s112 from './__fixtures__/qc-tr-20-112.json'
import qcTr20s2 from './__fixtures__/qc-tr-20-2-pages-1-2-trimmed.json'
import qcTr20s97 from './__fixtures__/qc-tr-20-97.json'
import qencIndonesian from './__fixtures__/qenc-aya-indonesian_sabiq-2_255-number-prefix.json'
import qencSaheeh112 from './__fixtures__/qenc-sura-english_saheeh-112.json'
import { ProvidersFailedError } from './http'
import {
  TRANSLATION_LIST,
  cleanTranslation,
  fetchTranslationImpl,
  quranComTranslationUrl,
  scriptDirection,
  textDirection,
  textScript,
  translationsFromQuranCom,
  translationsFromQuranEnc,
} from './translations'

const qcUrl = (id: number, s: number, page = 1) => quranComTranslationUrl(id, s, page)
const variant = (id: number) => qcMarkup.verse.translations.find((t) => t.resource_id === id)?.text ?? ''

describe('cleanTranslation', () => {
  it('removes Quran.com <sup foot_note> markers, also wrapped in <a class=f> (Italian)', () => {
    expect(cleanTranslation(qcTr20s112.translations[0].text, 1)).toBe('Say, "He is Allāh, [who is] One,')
    const en = cleanTranslation(variant(20))
    expect(en).toContain('the Ever-Living, the Self-Sustaining. Neither')
    const it = cleanTranslation(variant(153))
    expect(it).toContain('l’Assoluto. Non Lo prendon')
    expect(it).not.toMatch(/[<>]/)
  })

  it('removes bracketed note numbers in any digits, superscripts and glossary stars, keeping [bracketed words]', () => {
    const bn = cleanTranslation(variant(213))
    expect(bn).not.toMatch(/\[[\u{09E6}-\u{09EF}]+\]/u)
    expect(bn.startsWith('আল্লাহ্\u{200C},')).toBe(true)
    const ja = cleanTranslation(variant(218))
    expect(ja).not.toMatch(/[*¹²³]/u)
    expect(cleanTranslation(qencSaheeh112.result[0].translation, 1)).toBe('Say, "He is Allāh, [who is] One,')
    expect(cleanTranslation(qcTr20s97.translations[0].text)).toBe('Indeed, We sent it [i.e., the Qur’ān] down during the Night of Decree.')
  })

  it('drops a leading ayah number (QuranEnc Indonesian) but not other numbers', () => {
    const t = cleanTranslation(qencIndonesian.result.translation, 255)
    expect(t.startsWith('Allah, tidak ada Tuhan')).toBe(true)
    expect(cleanTranslation('(5) Five things', 5)).toBe('Five things')
    expect(cleanTranslation('1000 months', 3)).toBe('1000 months')
  })

  it('folds Arabic presentation forms on the translation line (Urdu ﻻ) and keeps Persian ZWNJ', () => {
    const ur = cleanTranslation(variant(54))
    expect(ur).not.toMatch(/[\u{FB50}-\u{FDFF}\u{FE70}-\u{FEFC}]/u)
    expect(ur).toContain('والا')
    expect(cleanTranslation('می\u{200C}شود')).toBe('می\u{200C}شود')
  })
})

describe('parsers', () => {
  it('reads Quran.com chapter translations keyed by verse number', () => {
    const m = translationsFromQuranCom(qcTr20s103, 103)
    expect([...m.keys()]).toEqual([1, 2, 3])
    expect(m.get(1)).toBe('By time,')
    expect(translationsFromQuranCom(qcTr131, 2).size).toBe(0)
  })

  it('reads QuranEnc sura translations', () => {
    const m = translationsFromQuranEnc(qencSaheeh112)
    expect([...m.keys()]).toEqual([1, 2, 3, 4])
    expect(m.get(2)).toBe('Allāh, the Eternal Refuge.')
  })
})

describe('fetchTranslation', () => {
  let net: MockNet
  beforeEach(() => resetDataCaches())
  afterEach(() => net?.restore())

  it('returns plain text for the requested range from the page of 50 that holds it', async () => {
    expect(qcUrl(20, 2, 6)).toBe('https://api.quran.com/api/v4/translations/20/by_chapter/2?per_page=50&page=6&fields=verse_key,verse_number')
    net = mockNet({ [qcUrl(20, 112)]: { json: qcTr20s112 } })
    expect(await fetchTranslationImpl(20, 112, 2, 3)).toEqual([
      { ayah: 2, text: 'Allāh, the Eternal Refuge.' },
      { ayah: 3, text: 'He neither begets nor is born,' },
    ])
    await fetchTranslationImpl(20, 112, 1, 4)
    expect(net.calls).toEqual([qcUrl(20, 112)])
  })

  it('joins a range across two pages (2:49–2:52) and requests only those pages', async () => {
    net = mockNet({ [qcUrl(20, 2, 1)]: { json: qcTr20s2.page1 }, [qcUrl(20, 2, 2)]: { json: qcTr20s2.page2 } })
    const out = await fetchTranslationImpl(20, 2, 49, 52)
    expect(out.map((e) => e.ayah)).toEqual([49, 50, 51, 52])
    expect(out[2].text.startsWith('And [recall] when We made an appointment with Moses')).toBe(true)
    expect([...net.calls].sort()).toEqual([qcUrl(20, 2, 1), qcUrl(20, 2, 2)])
  })

  it('falls back to the same edition on QuranEnc', async () => {
    net = mockNet({ [qcUrl(20, 112)]: { status: 500 }, 'https://quranenc.com/api/v1/translation/sura/english_saheeh/112': { json: qencSaheeh112 } })
    expect((await fetchTranslationImpl(20, 112, 1, 1))[0].text).toBe('Say, "He is Allāh, [who is] One,')
  })

  it('treats an empty edition (The Clear Quran, 131) as unavailable, and validates ranges', async () => {
    net = mockNet({ [qcUrl(131, 2, 6)]: { json: qcTr131 } })
    await expect(fetchTranslationImpl(131, 2, 255, 255)).rejects.toBeInstanceOf(ProvidersFailedError)
    await expect(fetchTranslationImpl(20, 112, 4, 5)).rejects.toBeInstanceOf(RangeError)
  })
})

describe('TRANSLATIONS', () => {
  it('offers about twenty languages, default edition first, with text direction and script', () => {
    expect(TRANSLATION_LIST.length).toBeGreaterThanOrEqual(20)
    expect(new Set(TRANSLATION_LIST.map((t) => t.id)).size).toBe(TRANSLATION_LIST.length)
    expect(new Set(TRANSLATION_LIST.map((t) => t.lang)).size).toBeGreaterThanOrEqual(20)
    expect(TRANSLATION_LIST[0]).toMatchObject({ id: 20, lang: 'en', dir: 'ltr', script: 'Latn' })
    expect(TRANSLATION_LIST.filter((t) => t.dir === 'rtl').map((t) => t.lang)).toEqual(['ur', 'ur', 'fa'])
    expect(TRANSLATION_LIST.some((t) => t.id === 131)).toBe(false)
    expect(Object.fromEntries(TRANSLATION_LIST.filter((t) => t.script !== 'Latn').map((t) => [t.id, t.script]))).toEqual({
      54: 'Arab',
      234: 'Arab',
      135: 'Arab',
      161: 'Beng',
      45: 'Cyrl',
      101: 'Cyrl',
      122: 'Deva',
      56: 'Hans',
      218: 'Jpan',
      219: 'Kore',
      229: 'Taml',
    })
    for (const t of TRANSLATION_LIST) expect(t.dir, String(t.id)).toBe(scriptDirection(t.script))
  })
})

describe('script and direction from the text (00-gaps §2.11)', () => {
  it('takes the direction from the first letter, not from punctuation or digits', () => {
    expect(textDirection(cleanTranslation(variant(54)))).toBe('rtl')
    expect(textDirection(cleanTranslation(variant(20)))).toBe('ltr')
    expect(textDirection('(١) «قل»')).toBe('rtl')
    expect(textDirection('255. Allah')).toBe('ltr')
    expect(textDirection('ހަދިވެހި')).toBe('rtl') // Thaana (Divehi, marked ltr by /resources/languages)
    expect(textDirection('ߒߞߏ')).toBe('rtl') // N'Ko (Bambara)
    expect(textDirection('אבג')).toBe('rtl')
    expect(textDirection('')).toBe('ltr')
  })

  it('names the ISO 15924 script of real translation texts', () => {
    expect(textScript(cleanTranslation(variant(20)))).toBe('Latn')
    expect(textScript(cleanTranslation(variant(153)))).toBe('Latn')
    expect(textScript(cleanTranslation(variant(54)))).toBe('Arab')
    expect(textScript(cleanTranslation(variant(213)))).toBe('Beng')
    expect(textScript(cleanTranslation(variant(218)))).toBe('Jpan') // kanji + kana
    expect(textScript('你说：他是真主，是独一的主；')).toBe('Hans')
    expect(textScript("그대(무함마드)는 말하라 : '그분은 하나님으로서 단 한 분이시라.")).toBe('Kore')
    expect(textScript('Скажи: «Он - Аллах Единый,')).toBe('Cyrl')
    expect(textScript('(நபியே!) கூறுவீராக!')).toBe('Taml')
    expect(textScript('123 …')).toBeNull()
    expect(scriptDirection('Thaa')).toBe('rtl')
    expect(scriptDirection('Cyrl')).toBe('ltr')
  })
})
