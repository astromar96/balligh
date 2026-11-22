// Client-side search: §4.3 normaliser, corpus parsers and matching over real excerpts of the bulk texts.
import aqcSimpleClean from './__fixtures__/aqc-quran-simple-clean-excerpt.json'
import { mockNet, resetDataCaches, type MockNet } from './__fixtures__/net'
import qcImlaei from './__fixtures__/qc-bulk-imlaei_simple-excerpt.json'
import qcUthmani from './__fixtures__/qc-bulk-uthmani_simple-excerpt.json'
import { VERSE_COUNTS } from './meta'
import { buildCorpus, bulkFromAlquranCloud, bulkFromQuranCom, normalizeSearchText, searchCorpus, searchQuranImpl } from './search'

const corpus = buildCorpus(bulkFromQuranCom(qcImlaei, 'text_imlaei_simple'), bulkFromQuranCom(qcUthmani, 'text_uthmani_simple'))
const keys = (hits: { surah: number; ayah: number }[]) => hits.map((h) => `${h.surah}:${h.ayah}`)

describe('normalizeSearchText', () => {
  it('drops harakat, Quranic marks, tatweel and hamza; folds alef, yeh, teh marbuta', () => {
    expect(normalizeSearchText('ٱلصَّلَوٰةَ')).toBe('الصلوه')
    expect(normalizeSearchText('الصلاة')).toBe('الصلاه')
    expect(normalizeSearchText('إِلَىٰ')).toBe('الي')
    expect(normalizeSearchText('يُؤْمِنُونَ')).toBe('يومنون')
    expect(normalizeSearchText('شَيْءٍ')).toBe('شي')
    expect(normalizeSearchText('  ٱللَّـهُ \u{00A0} أَحَدٌ \u{06DD}١ ')).toBe('الله احد')
  })
})

describe('corpus parsers', () => {
  it('reads Quran.com bulk verses', () => {
    const m = bulkFromQuranCom(qcImlaei, 'text_imlaei_simple')
    expect(m.get('112:1')).toBe('قل هو الله احد')
    expect(bulkFromQuranCom({ nope: 1 }, 'text_imlaei_simple').size).toBe(0)
  })

  it('strips the basmala prefix and BOM of alquran.cloud (not from 1:1, nor 9:1)', () => {
    const m = bulkFromAlquranCloud(aqcSimpleClean)
    expect(m.get('1:1')).toBe('بسم الله الرحمن الرحيم')
    expect(m.get('2:1')).toBe('الم')
    expect(m.get('112:1')).toBe('قل هو الله أحد')
    expect(m.get('9:1')?.startsWith('براءة من الله')).toBe(true)
  })
})

describe('searchCorpus', () => {
  it('matches whole-token phrases first, in Mushaf order', () => {
    expect(keys(searchCorpus(corpus, 'الرحمن الرحيم', 10))).toEqual(['1:1', '1:3'])
  })

  it('matches modern and Uthmani spellings alike', () => {
    expect(keys(searchCorpus(corpus, 'الصلاة', 10))).toEqual(['2:3', '2:43'])
    expect(keys(searchCorpus(corpus, 'ٱلصَّلَوٰةَ', 10))).toEqual(['2:3', '2:43'])
    expect(keys(searchCorpus(corpus, 'العلمين', 10))).toEqual(['1:2'])
    expect(keys(searchCorpus(corpus, 'السماوات', 10))).toEqual(['2:255', '24:35'])
  })

  it('adds substring matches (prefixes) after whole-token matches, up to the limit', () => {
    const hits = keys(searchCorpus(corpus, 'الناس', 50))
    expect(hits.slice(0, 4)).toEqual(['114:1', '114:2', '114:3', '114:5'])
    expect(hits).toContain('114:6') // «والناس»
    expect(keys(searchCorpus(corpus, 'رحم', 50))).toEqual(['1:1', '1:3'])
    expect(searchCorpus(corpus, 'الناس', 2)).toHaveLength(2)
  })

  it('answers verse references in Latin or Arabic-Indic digits and returns the modern text', () => {
    expect(searchCorpus(corpus, '2:255', 5)).toEqual([{ surah: 2, ayah: 255, text: qcImlaei.verses.find((v) => v.verse_key === '2:255')?.text_imlaei_simple }])
    expect(keys(searchCorpus(corpus, '١١٢:١', 5))).toEqual(['112:1'])
    expect(searchCorpus(corpus, '7:300', 5)).toEqual([])
  })

  it('returns nothing for an empty or marks-only query', () => {
    expect(searchCorpus(corpus, '   ', 5)).toEqual([])
    expect(searchCorpus(corpus, 'َُ', 5)).toEqual([])
  })
})

describe('searchQuran', () => {
  let net: MockNet
  beforeEach(() => resetDataCaches())
  afterEach(() => net?.restore())

  /** a full-size bulk response: the real excerpt plus filler for every other verse */
  const fullBulk = (excerpt: { verses: Record<string, unknown>[] }, field: string) => {
    const known = new Map(excerpt.verses.map((v) => [v.verse_key as string, v[field] as string]))
    const verses: Record<string, unknown>[] = []
    VERSE_COUNTS.forEach((n, i) => {
      for (let a = 1; a <= n; a++) verses.push({ verse_key: `${i + 1}:${a}`, [field]: known.get(`${i + 1}:${a}`) ?? 'نص' })
    })
    return { verses }
  }

  it('downloads both corpora once and searches locally', async () => {
    net = mockNet({
      'https://api.quran.com/api/v4/quran/verses/imlaei_simple': { json: fullBulk(qcImlaei, 'text_imlaei_simple') },
      'https://api.quran.com/api/v4/quran/verses/uthmani_simple': { json: fullBulk(qcUthmani, 'text_uthmani_simple') },
    })
    expect(keys(await searchQuranImpl('قل هو الله احد'))).toEqual(['112:1'])
    expect(keys(await searchQuranImpl('الصلوة', 1))).toEqual(['2:3'])
    expect(net.calls).toHaveLength(2)
    expect(await searchQuranImpl('  ')).toEqual([])
  })

  it('falls back to alquran.cloud when Quran.com is down', async () => {
    const surahs = VERSE_COUNTS.map((n, i) => ({
      number: i + 1,
      ayahs: Array.from({ length: n }, (_, k) => ({ numberInSurah: k + 1, text: i === 111 && k === 0 ? 'بسم الله الرحمن الرحيم قل هو الله أحد' : 'نص' })),
    }))
    net = mockNet({
      'https://api.quran.com/api/v4/quran/verses/imlaei_simple': { status: 503 },
      'https://api.quran.com/api/v4/quran/verses/uthmani_simple': { status: 503 },
      'https://api.alquran.cloud/v1/quran/quran-simple-clean': { json: { data: { surahs } } },
      'https://api.alquran.cloud/v1/quran/quran-uthmani': { json: { data: { surahs } } },
    })
    expect(await searchQuranImpl('قل هو الله أحد')).toEqual([{ surah: 112, ayah: 1, text: 'قل هو الله أحد' }])
  })
})
