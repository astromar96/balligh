// Quran text sources: Quran.com v4 parsers, the alquran.cloud (Tanzil) fallback and fetchAyahs/fetchSurahs routing.
import aqcSpecial from './__fixtures__/aqc-ayahs-special.json'
import aqc1 from './__fixtures__/aqc-surah-1.json'
import aqc112 from './__fixtures__/aqc-surah-112.json'
import aqcSurahs from './__fixtures__/aqc-surahs.json'
import { mockNet, resetDataCaches, type MockNet } from './__fixtures__/net'
import qcChapters from './__fixtures__/qc-chapters.json'
import qc1 from './__fixtures__/qc-verses-1.json'
import qc112 from './__fixtures__/qc-verses-112.json'
import special from './__fixtures__/qc-verses-special.json'
import { VERSE_COUNTS } from './meta'
import {
  ALQURAN_CLOUD_API,
  DataFormatError,
  QURAN_COM_API,
  ayahFromQuranComVerse,
  ayahsFromAlquranCloud,
  ayahsFromQuranComPages,
  fetchAyahsImpl,
  fetchSurahsImpl,
  quranComVersesUrl,
  surahsFromAlquranCloud,
  surahsFromQuranCom,
  tanzilWords,
  textDiagnostics,
} from './quran'
import { hasTanweenMeem, qpcToStandard, skeleton } from './text'

type QcVerse = (typeof qc112.verses)[number]
const verse = (key: string): QcVerse => (special as unknown as Record<string, QcVerse>)[key]
const qcWords = (v: QcVerse) => v.words.filter((w) => w.char_type_name === 'word').map((w) => w.text_uthmani)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

describe('Quran.com v4 parsers', () => {
  it('reads the 114 chapters', () => {
    const s = surahsFromQuranCom(qcChapters)
    expect(s).toHaveLength(114)
    expect(s[0]).toEqual({
      number: 1,
      nameArabic: 'الفاتحة',
      nameSimple: 'Al-Fatihah',
      nameTranslated: 'The Opener',
      versesCount: 7,
      revelationPlace: 'makkah',
      bismillahPre: false,
    })
    expect(s.map((x) => x.versesCount)).toEqual(VERSE_COUNTS)
    expect(s.filter((x) => !x.bismillahPre).map((x) => x.number)).toEqual([1, 9])
    expect(() => surahsFromQuranCom({ chapters: [] })).toThrow(DataFormatError)
  })

  it('builds the ayahs of a surah page (112) with juz, page, word positions and the QPC display text', () => {
    const ayahs = ayahsFromQuranComPages(112, [qc112])
    expect(ayahs.map((a) => a.key)).toEqual(['112:1', '112:2', '112:3', '112:4'])
    expect(ayahs.map((a) => a.words.length)).toEqual([4, 2, 4, 5])
    expect(ayahs.every((a) => a.juz === 30 && a.page === 604 && !a.sajdah && a.surah === 112)).toBe(true)
    expect(ayahs[3].words.map((w) => w.position)).toEqual([1, 2, 3, 4, 5])
    expect(ayahs[0].words[3].tajweed).toEqual([{ start: 4, end: 5, rule: 'qalaqah' }])
    const qpc = qc112.verses.map((v) => v.words.filter((w) => w.char_type_name === 'word').map((w) => qpcToStandard(w.text_qpc_hafs)))
    expect(ayahs.map((a) => a.words.map((w) => w.text))).toEqual(qpc)
    // 112:4 «كُفُوًا أَحَدٌۢ»: Tanzil writes the open tanween with a small meem, the display does not
    expect(ayahs.flatMap((a) => a.words).some((w) => hasTanweenMeem(w.text))).toBe(false)
  })

  it('shows a verse without text_qpc_hafs from its Tanzil text (mapped, never mixed with QPC words)', () => {
    const noQpc = clone(qc112)
    delete (noQpc.verses[3].words[2] as { text_qpc_hafs?: string }).text_qpc_hafs
    const before = textDiagnostics.qpcMissing
    const ayahs = ayahsFromQuranComPages(112, [noQpc])
    expect(textDiagnostics.qpcMissing - before).toBe(1)
    expect(ayahs[3].words.some((w) => hasTanweenMeem(w.text))).toBe(false)
    expect(ayahs[3].words.map((w) => skeleton(w.text))).toEqual(ayahsFromQuranComPages(112, [qc112])[3].words.map((w) => skeleton(w.text)))
  })

  it('sorts unsorted verses and words, and rejects incomplete or inconsistent pages', () => {
    const shuffled = clone(qc112)
    shuffled.verses.reverse()
    shuffled.verses[0].words.reverse()
    expect(ayahsFromQuranComPages(112, [shuffled]).map((a) => a.words.map((w) => w.text).join(' '))).toEqual(
      ayahsFromQuranComPages(112, [qc112]).map((a) => a.words.map((w) => w.text).join(' ')),
    )
    const missing = clone(qc112)
    missing.verses.splice(1, 1)
    expect(() => ayahsFromQuranComPages(112, [missing])).toThrow(DataFormatError)
    const noText = clone(qc112)
    delete (noText.verses[0].words[0] as { text_uthmani?: string }).text_uthmani
    expect(() => ayahsFromQuranComPages(112, [noText])).toThrow(/text_uthmani/)
    expect(() => ayahsFromQuranComPages(112, [{ error: 'x' }])).toThrow(DataFormatError)
  })

  it('marks sajdah ayahs, including 22:77 which only carries ۩', () => {
    expect(ayahFromQuranComVerse(7, verse('7:206')).sajdah).toBe(true)
    expect(verse('22:77').sajdah_number).toBeNull()
    expect(ayahFromQuranComVerse(22, verse('22:77')).sajdah).toBe(true)
    expect(ayahFromQuranComVerse(2, verse('2:255')).sajdah).toBe(false)
    expect(ayahFromQuranComVerse(27, verse('27:26')).words.at(-1)?.text.endsWith('۩')).toBe(true)
  })

  it('requests pages of 50 with verse tajweed and both word texts (00-gaps §2.5 canonical recipe)', () => {
    expect(quranComVersesUrl(2, 3)).toBe(
      'https://api.quran.com/api/v4/verses/by_chapter/2?words=true&per_page=50&page=3&fields=text_uthmani_tajweed&word_fields=text_uthmani,text_qpc_hafs',
    )
  })
})

describe('alquran.cloud (Tanzil) fallback', () => {
  it('reads the surah list like Quran.com (names stripped of marks and «سورة»)', () => {
    const aq = surahsFromAlquranCloud(aqcSurahs)
    const qc = surahsFromQuranCom(qcChapters)
    expect(aq.map((s) => [s.number, s.versesCount, s.bismillahPre, s.revelationPlace])).toEqual(
      qc.map((s) => [s.number, s.versesCount, s.bismillahPre, s.revelationPlace]),
    )
    expect(aq[0].nameArabic).toBe('الفاتحة')
    expect(aq[1].nameArabic).toBe('البقرة')
  })

  it('re-segments Tanzil text to Quran.com word positions (basmala prefix, ۞, ۩, pause tokens, 37:130)', () => {
    for (const [key, v] of Object.entries(aqcSpecial)) {
      const [s, a] = key.split(':').map(Number)
      const words = tanzilWords(v.uthmani, s, a)
      expect(words.map(skeleton), key).toEqual(qcWords(verse(key)).map(skeleton))
    }
    expect(tanzilWords(aqcSpecial['2:1'].uthmani, 2, 1)).toEqual(['الٓمٓ'])
    expect(tanzilWords(aqcSpecial['36:52'].uthmani, 36, 52)[5].endsWith(' ۜ ۗ')).toBe(true)
    expect(tanzilWords(aqcSpecial['2:26'].uthmani, 2, 26)[0].startsWith('۞ ')).toBe(true)
    expect(tanzilWords(aqcSpecial['37:130'].uthmani, 37, 130)).toHaveLength(3)
  })

  it('builds the same ayahs as Quran.com for 112 (words, pause marks, tajweed rules)', () => {
    const aq = ayahsFromAlquranCloud(112, aqc112)
    const qc = ayahsFromQuranComPages(112, [qc112])
    expect(aq.map((a) => a.key)).toEqual(qc.map((a) => a.key))
    expect(aq.map((a) => [a.juz, a.page, a.sajdah])).toEqual(qc.map((a) => [a.juz, a.page, a.sajdah]))
    expect(aq.map((a) => a.words.map((w) => skeleton(w.text)))).toEqual(qc.map((a) => a.words.map((w) => skeleton(w.text))))
    expect(aq.map((a) => a.words.map((w) => w.tajweed.map((t) => t.rule)))).toEqual(qc.map((a) => a.words.map((w) => w.tajweed.map((t) => t.rule))))
  })

  it('strips the BOM of 1:1 and keeps the Fatiha basmala as ayah 1', () => {
    const aq = ayahsFromAlquranCloud(1, aqc1)
    expect(aq).toHaveLength(7)
    expect(aq[0].words.map((w) => skeleton(w.text))).toEqual(qcWords(qc1.verses[0]).map(skeleton))
    expect(aq[0].words[0].text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('uses alquran.cloud sajda flags and rejects incomplete surahs', () => {
    const json = clone(aqc112)
    json.data[0].ayahs[0].sajda = aqcSpecial['7:206'].sajda as unknown as boolean
    expect(ayahsFromAlquranCloud(112, json).map((a) => a.sajdah)).toEqual([true, false, false, false])
    json.data[0].ayahs.pop()
    expect(() => ayahsFromAlquranCloud(112, json)).toThrow(DataFormatError)
    expect(() => ayahsFromAlquranCloud(112, { data: [] })).toThrow(DataFormatError)
  })
})

describe('fetchAyahs / fetchSurahs routing', () => {
  let net: MockNet
  beforeEach(() => resetDataCaches())
  afterEach(() => net?.restore())

  it('fetches a surah once (one request) and serves later calls from memory', async () => {
    net = mockNet({ [quranComVersesUrl(112)]: { json: qc112 } })
    const a = await fetchAyahsImpl(112)
    const b = await fetchAyahsImpl(112)
    expect(a).toBe(b)
    expect(a).toHaveLength(4)
    expect(net.calls).toEqual([quranComVersesUrl(112)])
  })

  it('still reads a surah when the server ignores per_page (walks next_page)', async () => {
    const all = clone(qc112)
    all.pagination = { per_page: 286, current_page: 1, next_page: null, total_pages: 1, total_records: 4 }
    net = mockNet({ [quranComVersesUrl(112)]: { json: all } })
    expect(await fetchAyahsImpl(112)).toHaveLength(4)
    expect(net.calls).toEqual([quranComVersesUrl(112)]) // page 1 is re-read from memory by the walk
  })

  it('falls back to alquran.cloud when Quran.com fails', async () => {
    net = mockNet({
      [quranComVersesUrl(112)]: { status: 503 },
      [`${ALQURAN_CLOUD_API}/surah/112/editions/quran-uthmani,quran-tajweed`]: { json: aqc112 },
    })
    const ayahs = await fetchAyahsImpl(112)
    expect(ayahs.map((a) => a.words.length)).toEqual([4, 2, 4, 5])
    expect(net.count(quranComVersesUrl(112))).toBe(3) // 1 + 2 retries on 5xx
  })

  it('falls back when Quran.com answers malformed data', async () => {
    net = mockNet({
      [quranComVersesUrl(112)]: { json: { verses: [] } },
      [`${ALQURAN_CLOUD_API}/surah/112/editions/quran-uthmani,quran-tajweed`]: { json: aqc112 },
    })
    expect(await fetchAyahsImpl(112)).toHaveLength(4)
  })

  it('rejects (never throws synchronously) on an invalid surah', async () => {
    net = mockNet({})
    for (const s of [0, 115, 1.5, Number.NaN]) {
      const p = fetchAyahsImpl(s)
      await expect(p).rejects.toBeInstanceOf(RangeError)
    }
    expect(net.calls).toEqual([])
  })

  it('loads the surah list from Quran.com, else alquran.cloud', async () => {
    net = mockNet({ [`${QURAN_COM_API}/chapters?language=en`]: { status: 500 }, [`${ALQURAN_CLOUD_API}/surah`]: { json: aqcSurahs } })
    const s = await fetchSurahsImpl()
    expect(s).toHaveLength(114)
    expect(s[113].nameSimple).toBe('An-Naas')
  })
})
