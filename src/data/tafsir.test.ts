// Tafsir: HTML → text, the three grouped shapes, gaps, Quranpedia page heuristics and provider fallbacks.
import { mockNet, resetDataCaches, type MockNet } from './__fixtures__/net'
import qcIbnKathirHtml from './__fixtures__/qc-tafsir-14-103_3-html.json'
import qcMuyassarGrouped from './__fixtures__/qc-tafsir-16-78_22-grouped-multikey.json'
import qcSaadiDuplicated from './__fixtures__/qc-tafsir-91-2_23-2_24-grouped-duplicated.json'
import qcSaadi78_10 from './__fixtures__/qc-tafsir-91-78_10.json'
import qcSaadi78_12 from './__fixtures__/qc-tafsir-91-78_12.json'
import qencMukhtasar112 from './__fixtures__/qenc-aya-arabic_mokhtasar-112_1.json'
import qencMoyassar103 from './__fixtures__/qenc-sura-arabic_moyassar-103-grouped.json'
import qencUpdates from './__fixtures__/qenc-updates-arabic_mokhtasar.json'
import qpMukhtasar from './__fixtures__/qp-2003-2_255.json'
import qpAhkamEmpty from './__fixtures__/qp-27780-112_1-empty.json'
import qpSaadiTwoGroups from './__fixtures__/qp-3-103_2-two-groups.json'
import spa5kMukhtasar from './__fixtures__/spa5k-mukhtasar-2_255.json'
import spa5kMuyassarIntro from './__fixtures__/spa5k-muyassar-78_1-surah-intro.json'
import { ProvidersFailedError } from './http'
import {
  SPA5K_HOSTS,
  TAFSIR_LIST,
  canonText,
  fetchTafsirImpl,
  fetchTafsirResultImpl,
  htmlToText,
  mergeTafsirRows,
  quranComTafsirRow,
  quranpediaRow,
  stripEditorNotes,
  stripSurahIntro,
} from './tafsir'

const QC = 'https://api.quran.com/api/v4/tafsirs'
const QENC = 'https://quranenc.com/api/v1'
const QP = 'https://api.quranpedia.net/v1/ayah'
const qencAya = (key: string, s: number, a: number) => `${QENC}/translation/aya/${key}/${s}/${a}`
const NOT_FOUND = { status: 404, json: { status: 404, error: 'Not Found' } }
/** without harakat: hand-typed Arabic orders combining marks differently from the sources */
const bare = (s: string | undefined) => (s ?? '').replace(/\p{M}/gu, '')

describe('text cleanup', () => {
  it('turns Quran.com HTML into plain text, keeping every word', () => {
    const t = htmlToText(qcIbnKathirHtml.tafsir.text)
    expect(t).not.toMatch(/[<>]/)
    expect(t.startsWith('فاستثنى من جنس الإنسان')).toBe(true)
    expect(t).toContain('" وتواصوا بالحق "')
    expect(htmlToText('أ<br>ب<p>ج</p>&amp; &#1583; &quot;x&quot;')).toBe('أ\n\nب\n\nج\n\n& د "x"')
  })

  it('drops the QUL surah intro spa5k prepends to Muyassar, and [[editor notes]]', () => {
    const t = stripSurahIntro(spa5kMuyassarIntro.text)
    expect(bare(t).startsWith('عن أي شيء يسأل')).toBe(true)
    expect(t).not.toContain('تسمية السورة')
    expect(stripSurahIntro('نص فيه [التفسير] بلا مقدمة')).toBe('نص فيه [التفسير] بلا مقدمة')
    expect(stripEditorNotes('أول [[ملاحظة المحقق]] آخر')).toBe('أول آخر')
  })

  it('compares passages ignoring harakat, tatweel, spaces and punctuation', () => {
    expect(canonText('أقسمَ الله، بالدهر')).toBe(canonText('اقسم  اللـه بالدهر'))
  })
})

describe('grouped shapes and gaps', () => {
  it('shape A: Quran.com lists the covered ayahs in tafsir.verses', () => {
    const row = quranComTafsirRow(qcMuyassarGrouped, 78)
    expect(row?.covers).toEqual([21, 22, 23, 24, 25, 26])
    expect(mergeTafsirRows([{ ayah: 22, row }], 22, 22)).toEqual([{ ayahFrom: 21, ayahTo: 26, text: row?.text }])
  })

  it('shape B: the same text on consecutive ayahs is one passage (QuranEnc Muyassar 103:1–2)', () => {
    const rows = qencMoyassar103.result.map((r) => ({ ayah: Number(r.aya), row: { text: r.translation, covers: [] } }))
    const merged = mergeTafsirRows(rows, 1, 3)
    expect(merged.map((e) => [e.ayahFrom, e.ayahTo])).toEqual([
      [1, 2],
      [3, 3],
    ])
  })

  it('shape C: ayahs without an entry are absent, and only passages touching the range are returned', () => {
    const rows = [
      { ayah: 9, row: { text: 'تسع', covers: [] } },
      { ayah: 10, row: { text: 'عشر', covers: [] } },
      { ayah: 11, row: null },
      { ayah: 12, row: { text: 'اثنا عشر', covers: [] } },
      { ayah: 13, row: { text: 'ثلاثة عشر', covers: [] } },
    ]
    expect(mergeTafsirRows(rows, 10, 12).map((e) => e.ayahFrom)).toEqual([10, 12])
  })
})

describe('Quranpedia rows', () => {
  it('reads a one-page entry', () => {
    const row = quranpediaRow(qpMukhtasar, 255)
    expect(bare(row?.text).startsWith('الله الذي لا إله يعبد بحق')).toBe(true)
  })

  it("keeps only the group whose heading holds the ayah when two groups share a page (Sa'di 103 + 104)", () => {
    const row = quranpediaRow(qpSaadiTwoGroups, 2)
    expect(row?.covers).toEqual([1, 3])
    expect(row?.text.startsWith('{١ - ٣}')).toBe(true)
    expect(row?.text).not.toContain('{١ - ٩}')
  })

  it('treats empty content (Ahkam books) and unrelated front matter as no entry', () => {
    expect(quranpediaRow(qpAhkamEmpty, 1)).toBeNull()
    const frontMatter = { content: [5, 6, 7, 937, 938].map((page) => ({ text: `صفحة ${page}`, page })) }
    expect(quranpediaRow(frontMatter, 6)).toBeNull()
    const tooMany = { content: Array.from({ length: 41 }, (_, i) => ({ text: `صفحة ${i}`, page: 100 + i })) }
    expect(quranpediaRow(tooMany, 1)).toBeNull()
    const pages = { content: [{ text: 'أ', page: 101 }, { text: 'ب', page: 102 }] }
    expect(quranpediaRow(pages, 1)?.text).toBe('أ\n\nب')
  })
})

describe('fetchTafsir providers', () => {
  let net: MockNet
  beforeEach(() => resetDataCaches())
  afterEach(() => net?.restore())

  it('Mukhtasar from QuranEnc, crediting the live version', async () => {
    net = mockNet({
      [qencAya('arabic_mokhtasar', 112, 1)]: { json: qencMukhtasar112 },
      [qencAya('arabic_mokhtasar', 112, 2)]: { json: { result: { translation: 'نص الآية الثانية' } } },
      [`${QENC}/translations/updates?key=arabic_mokhtasar`]: { json: { ...qencUpdates, version: '1.0.3' } },
    })
    const r = await fetchTafsirResultImpl('mukhtasar', 112, 1, 1)
    expect(r.providerId).toBe('quranenc:arabic_mokhtasar')
    expect(r.entries).toEqual([{ ayahFrom: 1, ayahTo: 1, text: 'قل - أيها الرسول -: هو الله المنفرد بالألوهية، لا إله غيره.' }])
    expect(r.creditAr).toContain('QuranEnc.com (الإصدار 1.0.3)')
    expect(r.creditAr).toContain('مركز تفسير للدراسات القرآنية')
  })

  it('falls back QuranEnc → spa5k, and jsDelivr 403 "package size" → the next CDN', async () => {
    net = mockNet({
      [qencAya('arabic_mokhtasar', 2, 255)]: { status: 503 },
      [`${SPA5K_HOSTS[0]}/ar-tafsir-al-mukhtasar/2/255.json`]: { status: 403, body: 'Package size exceeded the configured limit of 50 MB.' },
      [`${SPA5K_HOSTS[1]}/ar-tafsir-al-mukhtasar/2/255.json`]: { json: spa5kMukhtasar },
    })
    const r = await fetchTafsirResultImpl('mukhtasar', 2, 255, 255)
    expect(r.providerId).toBe('spa5k:ar-tafsir-al-mukhtasar')
    expect(r.entries).toHaveLength(1)
    expect(bare(r.entries[0].text).startsWith('الله الذي لا إله يعبد بحق')).toBe(true)
    expect(r.creditAr).toContain('spa5k')
  })

  it('returns a shape-A group once with its full range (Muyassar 78:22 → 21–26)', async () => {
    net = mockNet({ [`${QC}/16/by_ayah/78:22`]: { json: qcMuyassarGrouped }, [`${QC}/16/by_ayah/78:21`]: { json: qcMuyassarGrouped }, [`${QC}/16/by_ayah/78:23`]: { json: qcMuyassarGrouped } })
    const entries = await fetchTafsirImpl('muyassar', 78, 22, 22)
    expect(entries.map((e) => [e.ayahFrom, e.ayahTo])).toEqual([[21, 26]])
  })

  it("discovers a shape-B group beyond the request (Sa'di 2:23 = 2:24)", async () => {
    const t23 = qcSaadiDuplicated['GET /tafsirs/91/by_ayah/2:23']
    const t24 = qcSaadiDuplicated['GET /tafsirs/91/by_ayah/2:24']
    net = mockNet({
      [`${QC}/91/by_ayah/2:22`]: { json: { tafsir: { ...t23.tafsir, verses: { '2:22': {} }, text: 'نص آخر للآية ٢٢' } } },
      [`${QC}/91/by_ayah/2:23`]: { json: t23 },
      [`${QC}/91/by_ayah/2:24`]: { json: t24 },
      [`${QC}/91/by_ayah/2:25`]: { json: { tafsir: { ...t23.tafsir, verses: { '2:25': {} }, text: 'نص الآية ٢٥' } } },
    })
    const entries = await fetchTafsirImpl('saadi', 2, 23, 23)
    expect(entries.map((e) => [e.ayahFrom, e.ayahTo])).toEqual([[23, 24]])
  })

  it("leaves gaps out (Sa'di 78:11 is 404)", async () => {
    net = mockNet({
      [`${QC}/91/by_ayah/78:9`]: { json: { tafsir: { ...qcSaadi78_10.tafsir, verses: { '78:9': {} }, text: 'نص الآية ٩' } } },
      [`${QC}/91/by_ayah/78:10`]: { json: qcSaadi78_10 },
      [`${QC}/91/by_ayah/78:11`]: NOT_FOUND,
      [`${QC}/91/by_ayah/78:12`]: { json: qcSaadi78_12 },
      [`${QC}/91/by_ayah/78:13`]: NOT_FOUND,
    })
    const r = await fetchTafsirResultImpl('saadi', 78, 10, 12)
    expect(r.providerId).toBe('quran.com:91')
    expect(r.entries.map((e) => [e.ayahFrom, e.ayahTo])).toEqual([
      [10, 10],
      [12, 12],
    ])
    expect(r.entries[1].text).not.toMatch(/[<>]/)
  })

  it('moves on when a gap-free source lacks an ayah (Muyassar: Quran.com 404 → QuranEnc)', async () => {
    net = mockNet({
      [`${QC}/16/by_ayah/103:1`]: NOT_FOUND,
      [qencAya('arabic_moyassar', 103, 1)]: { json: { result: { translation: qencMoyassar103.result[0].translation } } },
      [qencAya('arabic_moyassar', 103, 2)]: { json: { result: { translation: qencMoyassar103.result[1].translation } } },
    })
    const r = await fetchTafsirResultImpl('muyassar', 103, 1, 1)
    expect(r.providerId).toBe('quranenc:arabic_moyassar')
    expect(r.entries.map((e) => [e.ayahFrom, e.ayahTo])).toEqual([[1, 2]])
    expect(r.creditAr).toContain('QuranEnc.com') // version request unrouted here → the catalogue version
  })

  it('an Ahkam book has no entry for an ayah without rulings', async () => {
    net = mockNet({ [`${QP}/112/1/book/27780`]: { json: qpAhkamEmpty }, [`${QP}/112/2/book/27780`]: { json: qpAhkamEmpty } })
    const r = await fetchTafsirResultImpl('ahkam-ibn-alarabi', 112, 1, 1)
    expect(r).toMatchObject({ entries: [], providerId: 'quranpedia:27780' })
  })

  it('validates arguments and reports when every provider failed', async () => {
    net = mockNet({})
    await expect(fetchTafsirImpl('nope', 1, 1, 1)).rejects.toBeInstanceOf(RangeError)
    await expect(fetchTafsirImpl('mukhtasar', 1, 0, 1)).rejects.toBeInstanceOf(RangeError)
    await expect(fetchTafsirImpl('mukhtasar', 1, 3, 2)).rejects.toBeInstanceOf(RangeError)
    await expect(fetchTafsirImpl('mukhtasar', 1, 1, 8)).rejects.toBeInstanceOf(RangeError)
    await expect(fetchTafsirImpl('jalalayn', 1, 1, 1)).rejects.toBeInstanceOf(ProvidersFailedError)
  })
})

describe('TAFSIRS catalogue', () => {
  it('lists short tafsirs first with credits, and marks the Ahkam works', () => {
    expect(TAFSIR_LIST.map((t) => t.id)).toEqual([
      'mukhtasar',
      'muyassar',
      'jalalayn',
      'saadi',
      'ibnkathir',
      'tabari',
      'baghawi',
      'wasit',
      'qurtubi',
      'ahkam-ibn-alarabi',
      'ahkam-jassas',
      'ahkam-kiya-harrasi',
      'ahkam-ibn-alfaras',
    ])
    expect(TAFSIR_LIST.filter((t) => t.kind === 'ahkam').map((t) => t.id)).toEqual(['qurtubi', 'ahkam-ibn-alarabi', 'ahkam-jassas', 'ahkam-kiya-harrasi', 'ahkam-ibn-alfaras'])
    expect(TAFSIR_LIST.slice(0, 3).every((t) => t.length === 'short')).toBe(true)
    expect(TAFSIR_LIST.every((t) => t.creditAr.includes(' · ') && t.noteAr.length > 0)).toBe(true)
  })
})
