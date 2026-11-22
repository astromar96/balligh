// fetchAyahAudio / fetchBasmalaAudio / fetchIstiadhaAudio routing per timing class and per the voice table, on
// real payloads behind a fake network.
import mq12s112 from './__fixtures__/mp3quran-timing-r12-s112.json'
import mq30s1 from './__fixtures__/mp3quran-timing-r30-s1.json'
import mq30s112 from './__fixtures__/mp3quran-timing-r30-s112.json'
import { mockNet, resetDataCaches, type MockNet, type Reply } from './__fixtures__/net'
import qcSeg7ch1 from './__fixtures__/qc-v4-seg-7-ch1.json'
import qcSeg7ch112 from './__fixtures__/qc-v4-seg-7-ch112.json'
import qcSeg8_2_255 from './__fixtures__/qc-v4-seg-8-2_255.json'
import qc1 from './__fixtures__/qc-verses-1.json'
import qc112 from './__fixtures__/qc-verses-112.json'
import qdc161ch1 from './__fixtures__/qdc-161-ch1.json'
import qdc170ch112 from './__fixtures__/qdc-170-ch112.json'
import qdc97ch1 from './__fixtures__/qdc-97-ch1.json'
import qdc97ch112 from './__fixtures__/qdc-97-ch112.json'
import {
  fetchAyahAudioImpl,
  fetchBasmalaAudioImpl,
  fetchIstiadhaAudioImpl,
  fetchV4Segments,
  httpsUrl,
  mp3quranTimingUrl,
  parseQdcChapter,
  qdcUrl,
  v4SegmentsUrl,
} from './audio'
import { ProvidersFailedError } from './http'
import { versesIn } from './meta'
import { quranComVersesUrl } from './quran'
import { RECITER_CATALOG } from './reciters.catalog'

const TEXT = { [quranComVersesUrl(1)]: { json: qc1 }, [quranComVersesUrl(112)]: { json: qc112 } }
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** A synthetic text of a surah (every verse 3 words, no tajweed) answering the canonical page URLs. */
function syntheticText(surah: number): Record<string, Reply> {
  const n = versesIn(surah)
  const pages = Math.ceil(n / 50)
  const routes: Record<string, Reply> = {}
  for (let p = 1; p <= pages; p++) {
    const verses = []
    for (let v = 50 * (p - 1) + 1; v <= Math.min(n, 50 * p); v++) {
      const words = [1, 2, 3].map((position) => ({ position, char_type_name: 'word', text_uthmani: 'كلمة', text_qpc_hafs: 'كلمة' }))
      verses.push({ verse_number: v, verse_key: `${surah}:${v}`, juz_number: 1, page_number: 1, sajdah_number: null, words })
    }
    const pagination = { per_page: 50, current_page: p, next_page: p < pages ? p + 1 : null, total_pages: pages, total_records: n }
    routes[quranComVersesUrl(surah, p)] = { json: { verses, pagination } }
  }
  return routes
}

let net: MockNet
beforeEach(() => resetDataCaches())
afterEach(() => net?.restore())

describe('class A (EveryAyah + Quran.com v4 segments)', () => {
  it('returns per-ayah files with word timings, one timing request per surah, in the requested order', async () => {
    net = mockNet({ ...TEXT, [v4SegmentsUrl(7, 112)]: { json: qcSeg7ch112 } })
    const out = await fetchAyahAudioImpl('alafasy', 112, [3, 1, 2])
    expect(out.map((a) => a.ayah)).toEqual([3, 1, 2])
    expect(out[1]).toMatchObject({ url: 'https://everyayah.com/data/Alafasy_128kbps/112001.mp3', fileKind: 'per_ayah', timing: 'word', wordCount: 4 })
    expect(out[1].words.map((w) => w.word)).toEqual([1, 2, 3, 4])
    expect(out.every((a) => a.perAyahUrl === null)).toBe(true) // the file is already per-ayah
    expect(net.count(v4SegmentsUrl(7, 112))).toBe(1)
  })

  it('requests segments in pages of 50, only the pages that hold the ayahs (2:255 → page 6)', async () => {
    expect(v4SegmentsUrl(8, 2, 6)).toBe('https://api.quran.com/api/v4/recitations/8/by_chapter/2?fields=segments&per_page=50&page=6')
    const page6 = { ...clone(qcSeg8_2_255), pagination: { per_page: 50, current_page: 6, next_page: null, total_pages: 6, total_records: 286 } }
    net = mockNet({ [v4SegmentsUrl(8, 2, 6)]: { json: page6 } })
    const map = await fetchV4Segments(8, 2, 255, 255)
    expect([...map.keys()]).toEqual(['2:255'])
    expect(net.calls).toEqual([v4SegmentsUrl(8, 2, 6)])
  })

  it('applies the 26 ms offset of Husary', async () => {
    net = mockNet({ ...TEXT, [v4SegmentsUrl(6, 1)]: { json: qcSeg7ch1 } })
    const [a] = await fetchAyahAudioImpl('husary', 1, [1])
    expect(a.url).toBe('https://everyayah.com/data/Husary_128kbps/001001.mp3')
    expect(a.words[0].startMs).toBe(60 + 26)
  })

  it('degrades to whole ayahs (timing none) when the timing API is down, and to fewer words for a missing verse', async () => {
    net = mockNet({ ...TEXT, [v4SegmentsUrl(7, 112)]: { status: 503 } })
    const out = await fetchAyahAudioImpl('alafasy', 112, [1, 2])
    expect(out.map((a) => [a.url, a.timing, a.words.length])).toEqual([
      ['https://everyayah.com/data/Alafasy_128kbps/112001.mp3', 'none', 0],
      ['https://everyayah.com/data/Alafasy_128kbps/112002.mp3', 'none', 0],
    ])
    net.restore()
    resetDataCaches()
    const partial = clone(qcSeg7ch112)
    partial.audio_files = partial.audio_files.filter((f) => f.verse_key !== '112:2')
    net = mockNet({ ...TEXT, [v4SegmentsUrl(7, 112)]: { json: partial } })
    const [one, two] = await fetchAyahAudioImpl('alafasy', 112, [1, 2])
    expect(one.timing).toBe('word')
    expect(two.timing).toBe('none')
  })
})

describe('class B (QDC chapter file + verse/word timings)', () => {
  it('returns the chapter file, its bitrate and chapter-time windows', async () => {
    net = mockNet({ ...TEXT, [qdcUrl(97, 1)]: { json: qdc97ch1 } })
    const out = await fetchAyahAudioImpl('yasser-dosari', 1, [1, 2])
    expect(out[0]).toMatchObject({
      url: 'https://download.quranicaudio.com/quran/yasser_ad-dussary//001.mp3',
      fileKind: 'chapter',
      bitrateKbps: 128,
      windowStartMs: 280,
      windowEndMs: 3080,
      timing: 'word',
    })
    expect(out[1].windowStartMs).toBe(3300)
    // his own per-ayah file is the fallback for a chapter file that cannot be windowed
    expect(out.map((a) => a.perAyahUrl)).toEqual([
      'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/001001.mp3',
      'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/001002.mp3',
    ])
  })

  it("falls back to the reciter's EveryAyah file for an ayah missing from the QDC file", async () => {
    const json = clone(qdc97ch112)
    json.audio_files[0].verse_timings = json.audio_files[0].verse_timings.filter((v) => v.verse_key !== '112:3')
    net = mockNet({ ...TEXT, [qdcUrl(97, 112)]: { json } })
    const out = await fetchAyahAudioImpl('yasser-dosari', 112, [2, 3])
    expect(out[0].fileKind).toBe('chapter')
    expect(out[1]).toMatchObject({ url: 'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/112003.mp3', fileKind: 'per_ayah', timing: 'none' })
  })

  it('falls back to mp3quran when QDC is down and the reciter has no EveryAyah folder (Khalid al-Jalil)', async () => {
    net = mockNet({ ...TEXT, [qdcUrl(170, 112)]: { status: 500 }, [mp3quranTimingUrl(20, 112)]: { json: mq30s112 } })
    const [a] = await fetchAyahAudioImpl('khalid-jalil', 112, [1])
    expect(a).toMatchObject({ url: 'https://cdn.mp3quran.net/audio/khalid-jalil/r1/112.mp3', fileKind: 'chapter', approximateWindow: true, bitrateKbps: 192 })
  })

  it('upgrades protocol-relative and http audio URLs to https, and rejects anything else', () => {
    expect(httpsUrl('//mirrors.quranicaudio.com/everyayah/Husary_64kbps/001001.mp3')).toBe('https://mirrors.quranicaudio.com/everyayah/Husary_64kbps/001001.mp3')
    expect(httpsUrl('http://download.quranicaudio.com/qdc/x/1.mp3')).toBe('https://download.quranicaudio.com/qdc/x/1.mp3')
    expect(httpsUrl('Alafasy/mp3/001001.mp3')).toBeNull()
    const json = clone(qdc97ch1)
    json.audio_files[0].audio_url = '//download.quranicaudio.com/quran/yasser_ad-dussary//001.mp3'
    expect(parseQdcChapter(json)?.audioUrl).toBe('https://download.quranicaudio.com/quran/yasser_ad-dussary//001.mp3')
    expect(parseQdcChapter({ audio_files: [] })).toBeNull()
  })

  it('reads an unlisted QDC recitation (Khalid al-Jalil, id 170)', async () => {
    net = mockNet({ ...TEXT, [qdcUrl(170, 112)]: { json: qdc170ch112 } })
    const out = await fetchAyahAudioImpl('khalid-jalil', 112, [1, 2, 3, 4])
    expect(out.every((a) => a.fileKind === 'chapter' && a.bitrateKbps === 96 && a.words.length > 0)).toBe(true)
    expect(out.every((a) => a.perAyahUrl === null)).toBe(true) // no EveryAyah folder
  })

  it("Tunaiji: the Xing VBR chapters (14, 72) come from his own per-ayah files, whole ayahs, without asking QDC", async () => {
    net = mockNet({ ...syntheticText(14), ...syntheticText(72) })
    const out = await fetchAyahAudioImpl('khalifa-tunaiji', 14, [1, 52])
    expect(out.map((a) => [a.url, a.fileKind, a.timing, a.words.length, a.perAyahUrl])).toEqual([
      ['https://everyayah.com/data/khalefa_al_tunaiji_64kbps/014001.mp3', 'per_ayah', 'none', 0, null],
      ['https://everyayah.com/data/khalefa_al_tunaiji_64kbps/014052.mp3', 'per_ayah', 'none', 0, null],
    ])
    expect((await fetchAyahAudioImpl('khalifa-tunaiji', 72, [3]))[0].url).toBe('https://everyayah.com/data/khalefa_al_tunaiji_64kbps/072003.mp3')
    expect(net.calls.every((u) => u.startsWith('https://api.quran.com/api/v4/verses/'))).toBe(true)
  })

  it("Tunaiji: 1:1 never comes from his EveryAyah folder (that file is Minshawi's): QDC, else mp3quran, else nothing", async () => {
    net = mockNet({ ...TEXT, [qdcUrl(161, 1)]: { json: qdc161ch1 } })
    const [one, two] = await fetchAyahAudioImpl('khalifa-tunaiji', 1, [1, 2])
    expect(one).toMatchObject({ url: 'https://download.quranicaudio.com/qdc/khalifah_taniji/murattal/1.mp3', fileKind: 'chapter', windowStartMs: 0, perAyahUrl: null })
    expect(two.perAyahUrl).toBe('https://everyayah.com/data/khalefa_al_tunaiji_64kbps/001002.mp3')
    net.restore()
    resetDataCaches()
    net = mockNet({ ...TEXT, [qdcUrl(161, 1)]: { status: 500 }, [mp3quranTimingUrl(24, 1)]: { json: mq30s1 } })
    const [fallback] = await fetchAyahAudioImpl('khalifa-tunaiji', 1, [1])
    expect(fallback).toMatchObject({ url: 'https://cdn.mp3quran.net/audio/khalifa-tunaiji/r1/001.mp3', fileKind: 'chapter', approximateWindow: true, perAyahUrl: null })
    net.restore()
    resetDataCaches()
    net = mockNet({ ...TEXT, [qdcUrl(161, 1)]: { status: 500 }, [mp3quranTimingUrl(24, 1)]: { status: 500 } })
    await expect(fetchAyahAudioImpl('khalifa-tunaiji', 1, [1])).rejects.toBeInstanceOf(ProvidersFailedError)
    await expect(fetchBasmalaAudioImpl('khalifa-tunaiji')).rejects.toBeInstanceOf(ProvidersFailedError) // not Minshawi's file
  })
})

describe('classes C and D', () => {
  it('C: per-ayah EveryAyah file, no words, no timing request', async () => {
    net = mockNet({ ...TEXT })
    const [a] = await fetchAyahAudioImpl('maher-muaiqly', 112, [4])
    expect(a).toEqual({
      ayah: 4,
      url: 'https://everyayah.com/data/MaherAlMuaiqly128kbps/112004.mp3',
      fileKind: 'per_ayah',
      bitrateKbps: null,
      windowStartMs: 0,
      windowEndMs: null,
      approximateWindow: false,
      words: [],
      wordCount: 5,
      timing: 'none',
      perAyahUrl: null,
    })
    expect(net.calls).toEqual([quranComVersesUrl(112)])
  })

  it("C: Ali Jaber's 1:1 is his bismillah.mp3 — his 001001.mp3 starts with the isti'adha", async () => {
    net = mockNet({ ...TEXT })
    const [one, two] = await fetchAyahAudioImpl('ali-jaber', 1, [1, 2])
    expect(one.url).toBe('https://everyayah.com/data/Ali_Jaber_64kbps/bismillah.mp3')
    expect(two.url).toBe('https://everyayah.com/data/Ali_Jaber_64kbps/001002.mp3')
  })

  it('D: mp3quran chapter file with an approximate window', async () => {
    net = mockNet({ ...TEXT, [mp3quranTimingUrl(30, 112)]: { json: mq30s112 }, [mp3quranTimingUrl(12, 112)]: { json: mq12s112 } })
    const [g] = await fetchAyahAudioImpl('saad-ghamdi', 112, [2])
    expect(g).toMatchObject({ url: 'https://cdn.mp3quran.net/audio/saad-ghamdi/r1/112.mp3', fileKind: 'chapter', windowStartMs: 8358, windowEndMs: 10479, approximateWindow: true, words: [] })
    expect(g.perAyahUrl).toBe('https://everyayah.com/data/Ghamadi_40kbps/112002.mp3')
    const [i] = await fetchAyahAudioImpl('idrees-abkar', 112, [1])
    expect(i).toMatchObject({ url: 'https://cdn.mp3quran.net/audio/idrees-abkar/r1/112.mp3', windowStartMs: 3969, perAyahUrl: null })
  })

  it('D: falls back to EveryAyah when mp3quran is down, and fails clearly when there is nothing else', async () => {
    net = mockNet({ ...TEXT, [mp3quranTimingUrl(30, 112)]: { status: 502 }, [mp3quranTimingUrl(12, 112)]: { status: 502 } })
    const [g] = await fetchAyahAudioImpl('saad-ghamdi', 112, [1])
    expect(g).toMatchObject({ url: 'https://everyayah.com/data/Ghamadi_40kbps/112001.mp3', fileKind: 'per_ayah' })
    await expect(fetchAyahAudioImpl('idrees-abkar', 112, [1])).rejects.toBeInstanceOf(ProvidersFailedError)
  })
})

describe('arguments, basmala and abort', () => {
  it('rejects unknown reciters and ayahs without touching the network', async () => {
    net = mockNet({})
    await expect(fetchAyahAudioImpl('nobody', 1, [1])).rejects.toBeInstanceOf(RangeError)
    await expect(fetchAyahAudioImpl('alafasy', 1, [8])).rejects.toBeInstanceOf(RangeError)
    await expect(fetchAyahAudioImpl('alafasy', 115, [1])).rejects.toBeInstanceOf(RangeError)
    expect(await fetchAyahAudioImpl('alafasy', 1, [])).toEqual([])
    expect(net.calls).toEqual([])
  })

  it('returns duplicates as asked', async () => {
    net = mockNet({ ...TEXT })
    const out = await fetchAyahAudioImpl('maher-muaiqly', 112, [1, 1])
    expect(out.map((a) => a.ayah)).toEqual([1, 1])
  })

  it("basmala (ayah 0) = the reciter's own 1:1 (per-ayah file with its timings, or the 1:1 window of the chapter-1 file)", async () => {
    net = mockNet({ ...TEXT, [v4SegmentsUrl(7, 1)]: { json: qcSeg7ch1 }, [qdcUrl(97, 1)]: { json: qdc97ch1 }, [qdcUrl(161, 1)]: { json: qdc161ch1 } })
    const a = await fetchBasmalaAudioImpl('alafasy')
    expect(a).toMatchObject({ ayah: 0, url: 'https://everyayah.com/data/Alafasy_128kbps/001001.mp3', timing: 'word', wordCount: 4 })
    expect(a.words.map((w) => w.word)).toEqual([1, 2, 3, 4])
    expect(await fetchBasmalaAudioImpl('yasser-dosari')).toMatchObject({ ayah: 0, fileKind: 'chapter', windowStartMs: 280, windowEndMs: 3080 })
    expect(await fetchBasmalaAudioImpl('khalifa-tunaiji')).toMatchObject({ ayah: 0, url: 'https://download.quranicaudio.com/qdc/khalifah_taniji/murattal/1.mp3' })
    expect(await fetchBasmalaAudioImpl('ali-jaber')).toMatchObject({ ayah: 0, url: 'https://everyayah.com/data/Ali_Jaber_64kbps/bismillah.mp3', fileKind: 'per_ayah' })
    expect(await fetchBasmalaAudioImpl('muhammad-ayyub')).toMatchObject({ ayah: 0, url: 'https://everyayah.com/data/Muhammad_Ayyoub_128kbps/001001.mp3' })
  })

  it("isti'adha (ayah -1) = audhubillah.mp3 in the reciter's own voice only, whole, without a request (D7)", async () => {
    net = mockNet({})
    expect(await fetchIstiadhaAudioImpl('alafasy')).toEqual({
      ayah: -1,
      url: 'https://everyayah.com/data/Alafasy_128kbps/audhubillah.mp3',
      fileKind: 'per_ayah',
      bitrateKbps: null,
      windowStartMs: 0,
      windowEndMs: null,
      approximateWindow: false,
      words: [],
      wordCount: 5,
      timing: 'none',
      perAyahUrl: null,
    })
    const offered: string[] = []
    for (const e of RECITER_CATALOG) if (await fetchIstiadhaAudioImpl(e.id)) offered.push(e.id)
    expect(offered.sort()).toEqual(['alafasy', 'ali-jaber', 'hudhaifi', 'husary', 'shatri'])
    expect(await fetchIstiadhaAudioImpl('shuraim')).toBeNull() // Alafasy's recording in his folder
    await expect(fetchIstiadhaAudioImpl('nobody')).rejects.toBeInstanceOf(RangeError)
    await expect(fetchIstiadhaAudioImpl('alafasy', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(net.calls).toEqual([])
  })

  it('honours an aborted signal', async () => {
    net = mockNet({ ...TEXT, [v4SegmentsUrl(7, 112)]: { json: qcSeg7ch112, delayMs: 200 } })
    const ac = new AbortController()
    const p = fetchAyahAudioImpl('alafasy', 112, [1], ac.signal)
    setTimeout(() => ac.abort(), 20)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
