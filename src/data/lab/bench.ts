// Live web bench for src/data (/lab/data): calls every public function against the real services from inside the
// Metro bundle in a browser — CORS, Cache Storage, AbortSignal and the provider chains as the app will see them.
// Dev route only, never part of the app. `full` adds the whole-Quran alignment audit (114 surahs, ~25 MB).
import type { Ayah, AyahAudio } from '../../core/types'
import {
  RECITERS,
  TAFSIRS,
  TRANSLATIONS,
  fetchAyahAudio,
  fetchAyahs,
  fetchBasmalaAudio,
  fetchIstiadhaAudio,
  fetchSurahs,
  fetchTafsirResult,
  fetchTranslation,
  purgeExpiredCaches,
  qpcToStandard,
  searchQuran,
  textDirection,
} from '../index'
import { policyFor } from '../cache-policy'
import { DAY_MS, EXPIRES_HEADER, STORED_HEADER, clearMemoryCaches, mapLimit, setFetcher } from '../http'
import { clearQuranMemo, textDiagnostics } from '../quran'
import { hasTanweenMeem } from '../text'
import { textScript } from '../translations'

export interface DataLabCheck {
  name: string
  ok: boolean
  detail: string
  ms: number
}

export interface DataLabAudio {
  reciter: string
  cls: string
  ayah: number
  url: string
  fileKind: AyahAudio['fileKind']
  window: string
  timing: AyahAudio['timing']
  words: number
  wordCount: number
  perAyahUrl: string | null
}

export interface DataLabResult {
  checks: DataLabCheck[]
  samples: {
    key: string
    words: { text: string; waqf: string | null; waqfChar: string | null; rules: { start: number; end: number; rule: string }[] }[]
  }[]
  audio: DataLabAudio[]
  audioBytes: { reciter: string; url: string; status: number; mp3: boolean; error: string | null }[]
  tafsir: { id: string; ayah: string; provider: string; entries: string; credit: string; head: string }[]
  translations: { id: number; lang: string; ok: boolean; script: string; detected: string; dir: string; head: string }[]
  search: { query: string; hits: number; first: string }[]
  cache: {
    entries: number
    unstamped: number
    maxDays: number | null
    qfMaxDays: number | null
    reloadRequests: number | null
    purge: string | null
  }
  audit: {
    surahs: number
    verses: number
    words: number
    alignmentFailures: number
    printedSplit: number
    printedInside: number
    guardWords: number
    printedWords: number
    mamnu: number
    mamnuUnprinted: number
    tanweenMeem: number
    rawQpcTanween: number
    sajdah: number
    ms: number
  } | null
}

const PAUSE = /[\u{06D6}-\u{06DC}]/gu
/** QPC open tanween, which Amiri Quran lacks: qpcToStandard maps them (never left in Word.text) */
const RAW_QPC_TANWEEN = /[\u{0656}\u{0657}\u{065E}]/u
const CACHE_NAME = 'balligh-data-v2'

async function check(out: DataLabCheck[], name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = Date.now()
  try {
    const detail = await fn()
    out.push({ name, ok: true, detail, ms: Date.now() - t0 })
  } catch (e) {
    out.push({ name, ok: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t0 })
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

/** First bytes of an audio file over CORS with a single Range (a CORS-safelisted header): ID3 or an MP3 frame sync. */
async function probeAudio(url: string): Promise<{ status: number; mp3: boolean }> {
  const res = await fetch(url, { headers: { Range: 'bytes=0-15' }, credentials: 'omit' })
  const b = new Uint8Array(await res.arrayBuffer()).slice(0, 4)
  const mp3 = (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
  return { status: res.status, mp3 }
}

const sampleOf = (a: Ayah) => ({
  key: a.key,
  words: a.words.map((w) => ({
    text: w.text,
    waqf: w.waqf,
    waqfChar: w.waqfChar,
    rules: w.tajweed.map((t) => ({ start: t.start, end: t.end, rule: String(t.rule) })),
  })),
})

export async function runDataLab(opts: { full: boolean }, progress: (msg: string) => void): Promise<DataLabResult> {
  const checks: DataLabCheck[] = []
  const result: DataLabResult = {
    checks,
    samples: [],
    audio: [],
    audioBytes: [],
    tafsir: [],
    translations: [],
    search: [],
    cache: { entries: 0, unstamped: 0, maxDays: null, qfMaxDays: null, reloadRequests: null, purge: null },
    audit: null,
  }

  progress('surahs and ayahs')
  await check(checks, 'fetchSurahs: 114 surahs, 6,236 ayahs', async () => {
    const s = await fetchSurahs()
    assert(s.length === 114, `got ${s.length}`)
    const total = s.reduce((n, x) => n + x.versesCount, 0)
    assert(total === 6236, `total ${total}`)
    return `${s[0].nameArabic} … ${s[113].nameArabic}`
  })
  await check(checks, 'fetchAyahs: QPC display (no stray meem), special verses (۞ 2:26, 36:52 two marks, 37:130, 18:1 saktah, 22:77 ۩, RLM 27:26)', async () => {
    const [s2, s18, s22, s27, s36, s37, s112] = await Promise.all([2, 18, 22, 27, 36, 37, 112].map((n) => fetchAyahs(n)))
    assert(s2.length === 286 && s112.length === 4, 'ayah counts')
    assert(s112.map((a) => a.words.length).join() === '4,2,4,5', '112 words')
    assert(s2[25].words[0].text.startsWith('۞ '), '۞ not kept on 2:26 w1')
    assert(s2[25].words[6].text === 'مَثَلࣰا', `2:26 w7 open fathatan: «${s2[25].words[6].text}»`)
    assert(s36[51].words[5].waqfChar === '\u{06DC} \u{06D7}' && s36[51].words[5].waqf === 'waqf_awla', '36:52')
    assert(s37[129].words.length === 3, '37:130')
    assert(s18[0].words[10].waqf === 'saktah', '18:1')
    assert(s22[76].sajdah, '22:77 sajdah')
    assert(!/[\u{200E}\u{200F}]/u.test(s27[25].words[7].text), '27:26 RLM')
    // D1: the guard keeps Tanzil's ۙ, which QPC does not print (2:120 w23 «ٱلۡعِلۡمِ»)
    const w = s2[119].words[22]
    assert(w.waqf === 'mamnu' && w.waqfChar === null, `2:120 w23 waqf ${w.waqf} / printed ${w.waqfChar}`)
    const words = [s2, s18, s22, s27, s36, s37, s112].flat().flatMap((a) => a.words)
    const meem = words.filter((x) => hasTanweenMeem(x.text)).length
    const raw = words.filter((x) => RAW_QPC_TANWEEN.test(x.text)).length
    assert(meem === 0 && raw === 0, `${meem} tanween + small meem, ${raw} raw QPC tanween`)
    assert(qpcToStandard('عَلِيمٞ') === 'عَلِيمࣱ' && qpcToStandard('فِي') === 'فِى', 'qpcToStandard')
    for (const a of [s2[25], s2[119], s36[51], s37[129], s18[0], s112[0]]) result.samples.push(sampleOf(a))
    return `${words.length} words: 0 stray meem · 2:120 w23 guard ۙ, nothing printed · 36:52 w6 «${s36[51].words[5].waqfChar}»`
  })
  await check(checks, 'AbortSignal: an aborted fetchAyahs rejects with AbortError', async () => {
    const ac = new AbortController()
    const p = fetchAyahs(3, ac.signal)
    ac.abort()
    const e = await p.then(
      () => null,
      (err: unknown) => err,
    )
    assert(e && (e as Error).name === 'AbortError', `got ${String(e)}`)
    return 'AbortError'
  })

  if (opts.full) {
    progress('whole-Quran audit (114 surahs)')
    await check(checks, 'whole Quran in the browser: 6,236 ayahs, 77,429 words, 0 alignment failures, 0 stray meem, both pause systems (D1)', async () => {
      const t0 = Date.now()
      const before = textDiagnostics.alignmentFailures
      const all = await mapLimit(
        Array.from({ length: 114 }, (_, i) => i + 1),
        6,
        (s) => fetchAyahs(s),
      )
      const a0 = {
        surahs: all.length,
        verses: 0,
        words: 0,
        alignmentFailures: 0,
        printedSplit: 0,
        printedInside: 0,
        guardWords: 0,
        printedWords: 0,
        mamnu: 0,
        mamnuUnprinted: 0,
        tanweenMeem: 0,
        rawQpcTanween: 0,
        sajdah: 0,
        ms: 0,
      }
      for (const surah of all) {
        for (const a of surah) {
          a0.verses++
          if (a.sajdah) a0.sajdah++
          for (const w of a.words) {
            a0.words++
            a0.printedSplit += (w.waqfChar?.match(PAUSE) ?? []).length
            a0.printedInside += (w.text.match(PAUSE) ?? []).length
            if (w.waqf) a0.guardWords++
            if (w.waqfChar) a0.printedWords++
            if (w.waqf === 'mamnu') {
              a0.mamnu++
              if (!w.waqfChar) a0.mamnuUnprinted++
            }
            if (hasTanweenMeem(w.text)) a0.tanweenMeem++
            if (RAW_QPC_TANWEEN.test(w.text)) a0.rawQpcTanween++
          }
        }
      }
      a0.alignmentFailures = textDiagnostics.alignmentFailures - before
      a0.ms = Date.now() - t0
      result.audit = a0
      assert(a0.verses === 6236 && a0.words === 77429, `${a0.verses} verses, ${a0.words} words`)
      assert(a0.alignmentFailures === 0, `${a0.alignmentFailures} alignment failures`)
      assert(a0.tanweenMeem === 0 && a0.rawQpcTanween === 0, `${a0.tanweenMeem} stray meem, ${a0.rawQpcTanween} raw QPC tanween`)
      // QPC prints 4,280 marks (52:37:7's ۜ and two more sit inside words); the guard reads Tanzil's in 4,363 words
      assert(a0.printedSplit === 4277 && a0.printedInside === 3, `${a0.printedSplit} + ${a0.printedInside} printed marks`)
      assert(a0.guardWords === 4363 && a0.printedWords === 4276, `guard ${a0.guardWords} words, printed ${a0.printedWords}`)
      assert(a0.mamnu === 68 && a0.mamnuUnprinted === 67, `ۙ ${a0.mamnu}, unprinted ${a0.mamnuUnprinted}`)
      assert(a0.sajdah === 15, `${a0.sajdah} sajdah ayahs`)
      return `printed ${a0.printedSplit} + ${a0.printedInside} marks · guard ${a0.guardWords} words (ۙ ${a0.mamnu}, ${a0.mamnuUnprinted} unprinted) · ${(a0.ms / 1000).toFixed(1)} s`
    })
  }

  progress('audio')
  const reciters: [string, string][] = [
    ['alafasy', 'A'],
    ['husary', 'A'],
    ['sudais', 'A'],
    ['yasser-dosari', 'B'],
    ['khalifa-tunaiji', 'B'],
    ['khalid-jalil', 'B'],
    ['maher-muaiqly', 'C'],
    ['ali-jaber', 'C'],
    ['saad-ghamdi', 'D'],
    ['idrees-abkar', 'D'],
  ]
  const row = (id: string, cls: string, a: AyahAudio): DataLabAudio => ({
    reciter: id,
    cls,
    ayah: a.ayah,
    url: a.url,
    fileKind: a.fileKind,
    window: a.fileKind === 'chapter' ? `${a.windowStartMs}–${a.windowEndMs}` : 'whole file',
    timing: a.timing,
    words: a.words.length,
    wordCount: a.wordCount,
    perAyahUrl: a.perAyahUrl,
  })
  for (const [id, cls] of reciters) {
    await check(checks, `fetchAyahAudio ${id} (class ${cls}): 112:1–4 + basmala (ayah 0)`, async () => {
      assert(RECITERS.find((r) => r.id === id)?.timingClass === cls, 'class')
      const basmala = await fetchBasmalaAudio(id)
      assert(basmala.ayah === 0, `basmala ayah ${basmala.ayah}`)
      const list = [...(await fetchAyahAudio(id, 112, [1, 2, 3, 4])), basmala]
      for (const a of list) {
        result.audio.push(row(id, cls, a))
        if (cls === 'A' || cls === 'B') assert(a.timing === 'none' || a.words.length >= a.wordCount, `${a.ayah}: ${a.words.length} words`)
        if (cls === 'C' || cls === 'D') assert(a.words.length === 0, 'words')
        if (cls === 'B' || cls === 'D') assert(a.fileKind === 'chapter' && (a.bitrateKbps ?? 0) > 0, 'chapter + bitrate')
        if (a.fileKind === 'per_ayah') assert(a.perAyahUrl === null, 'perAyahUrl on a per-ayah item')
      }
      if (id === 'khalifa-tunaiji') assert(basmala.perAyahUrl === null && !basmala.url.includes('everyayah'), "Tunaiji's basmala must not be Minshawi's file")
      if (id === 'ali-jaber') assert(basmala.url.endsWith('/bismillah.mp3'), `Ali Jaber basmala ${basmala.url}`)
      try {
        const p = await probeAudio(list[0].url)
        result.audioBytes.push({ reciter: id, url: list[0].url, status: p.status, mp3: p.mp3, error: null })
      } catch (e) {
        result.audioBytes.push({ reciter: id, url: list[0].url, status: 0, mp3: false, error: e instanceof Error ? e.message : String(e) })
      }
      return list.map((a) => `${a.ayah}:${a.timing}`).join(' ')
    })
  }
  await check(checks, "Tunaiji's Xing VBR chapter 14: his own per-ayah files, whole ayahs (00-gaps §2.6)", async () => {
    const [a] = await fetchAyahAudio('khalifa-tunaiji', 14, [1])
    result.audio.push(row('khalifa-tunaiji', 'B', a))
    assert(a.fileKind === 'per_ayah' && a.timing === 'none' && a.url.includes('khalefa_al_tunaiji'), `${a.fileKind} ${a.url}`)
    const p = await probeAudio(a.url)
    assert(p.mp3, `HTTP ${p.status}, not MP3`)
    return a.url
  })
  await check(checks, "fetchIstiadhaAudio: own voice only (Alafasy, Husary, Shatri, Ali Jaber, Hudhaifi; D7)", async () => {
    const offered: string[] = []
    for (const r of RECITERS) {
      const a = await fetchIstiadhaAudio(r.id)
      assert((a !== null) === r.istiadha, `${r.id}: Reciter.istiadha ${r.istiadha}`)
      if (!a) continue
      assert(a.ayah === -1 && a.wordCount === 5, `${r.id} ayah ${a.ayah}`)
      const p = await probeAudio(a.url)
      result.audioBytes.push({ reciter: `${r.id} (isti'adha)`, url: a.url, status: p.status, mp3: p.mp3, error: null })
      assert(p.mp3, `${r.id}: HTTP ${p.status}, not MP3`)
      offered.push(r.id)
    }
    assert(offered.sort().join() === 'alafasy,ali-jaber,hudhaifi,husary,shatri', offered.join())
    return offered.join(', ')
  })

  progress('tafsir')
  for (const t of TAFSIRS) {
    const ayah = t.id.startsWith('ahkam-') ? 282 : 255
    await check(checks, `fetchTafsir ${t.id} 2:${ayah}`, async () => {
      const r = await fetchTafsirResult(t.id, 2, ayah, ayah)
      assert(r.entries.length > 0, 'no entry')
      result.tafsir.push({
        id: t.id,
        ayah: `2:${ayah}`,
        provider: r.providerId,
        entries: r.entries.map((e) => `${e.ayahFrom}–${e.ayahTo} (${e.text.length})`).join(', '),
        credit: r.creditAr,
        head: r.entries[0].text.slice(0, 90),
      })
      return r.providerId
    })
  }
  await check(checks, "fetchTafsir groups and gaps: Muyassar 78:22 → 21–26, Sa'di 78:10–12 without 11", async () => {
    const [g, s] = await Promise.all([fetchTafsirResult('muyassar', 78, 22, 22), fetchTafsirResult('saadi', 78, 10, 12)])
    const gr = g.entries.map((e) => `${e.ayahFrom}–${e.ayahTo}`).join(',')
    const sr = s.entries.map((e) => `${e.ayahFrom}–${e.ayahTo}`).join(',')
    assert(gr === '21–26', `muyassar ${gr}`)
    assert(!s.entries.some((e) => e.ayahFrom <= 11 && e.ayahTo >= 11) || s.providerId !== 'quran.com:91', `saadi ${sr}`)
    return `muyassar ${gr} · saadi ${sr} (${s.providerId})`
  })

  progress('translations')
  await check(checks, `fetchTranslation: all ${TRANSLATIONS.length} editions for 112, in the script and direction they declare`, async () => {
    await mapLimit(TRANSLATIONS, 4, async (t) => {
      const rows = await fetchTranslation(t.id, 112, 1, 4).catch(() => [])
      const text = rows.map((r) => r.text).join(' ')
      const detected = `${textScript(text) ?? '—'} ${textDirection(text)}`
      const ok = rows.length === 4 && rows.every((r) => r.text.length > 0 && !/<|foot_note/.test(r.text)) && detected === `${t.script} ${t.dir}`
      result.translations.push({ id: t.id, lang: t.lang, ok, script: t.script, detected, dir: t.dir, head: rows[0]?.text.slice(0, 60) ?? '' })
    })
    const bad = result.translations.filter((t) => !t.ok).map((t) => `${t.id} (${t.detected} ≠ ${t.script} ${t.dir})`)
    assert(bad.length === 0, `wrong: ${bad.join(', ')}`)
    const across = await fetchTranslation(20, 2, 49, 52)
    assert(across.map((e) => e.ayah).join() === '49,50,51,52', 'a range across two pages of 50')
    return `${result.translations.length} editions · 2:49–52 across pages 1–2`
  })

  progress('search')
  await check(checks, 'searchQuran: modern and Uthmani spellings, phrases, references', async () => {
    for (const q of ['الصلاة', 'ٱلصَّلَوٰةَ', 'قل هو الله احد', 'رحم', '٢:٢٥٥']) {
      const hits = await searchQuran(q, 1000)
      result.search.push({ query: q, hits: hits.length, first: hits[0] ? `${hits[0].surah}:${hits[0].ayah} ${hits[0].text.slice(0, 50)}` : '—' })
    }
    const [salah, uthmani, ikhlas] = result.search
    assert(salah.hits > 50 && uthmani.hits > 50, 'salah')
    assert(ikhlas.first.startsWith('112:1 '), 'ikhlas')
    return result.search.map((s) => `${s.query}: ${s.hits}`).join(' · ')
  })

  progress('cache storage')
  await check(checks, 'Cache Storage: stamped entries, QF ≤ 6 days (cache-policy.json); a reload is served without the network', async () => {
    const cs = (globalThis as { caches?: CacheStorage }).caches
    assert(cs, 'no Cache Storage in this browser')
    await new Promise((r) => setTimeout(r, 300)) // writes are fire-and-forget
    const cache = await cs.open(CACHE_NAME)
    const keys = await cache.keys()
    let maxDays = 0
    let qfMaxDays = 0
    let unstamped = 0
    for (const k of keys) {
      const res = await cache.match(k)
      const stored = Number(res?.headers.get(STORED_HEADER) ?? NaN)
      const expires = Number(res?.headers.get(EXPIRES_HEADER) ?? NaN)
      if (!(stored > 0) || !(expires > 0)) {
        unstamped++
        continue
      }
      const days = (expires - stored) / DAY_MS
      maxDays = Math.max(maxDays, days)
      if (policyFor(k.url)?.qf) qfMaxDays = Math.max(qfMaxDays, days)
    }
    result.cache.entries = keys.length
    result.cache.unstamped = unstamped
    result.cache.maxDays = Number(maxDays.toFixed(3))
    result.cache.qfMaxDays = Number(qfMaxDays.toFixed(3))
    assert(keys.length > 0, 'nothing cached')
    assert(unstamped === 0, `${unstamped} entries without stamps`)
    assert(qfMaxDays <= 6, `QF content kept up to ${qfMaxDays} days`)
    assert(!(await cs.keys()).includes('balligh-data-v1'), 'the legacy v1 cache is still there')
    clearMemoryCaches()
    clearQuranMemo()
    let requests = 0
    const prev = setFetcher((url, init) => {
      requests++
      return fetch(url, init)
    })
    try {
      const again = await fetchAyahs(112)
      assert(again.length === 4, 'reload')
    } finally {
      setFetcher(prev)
    }
    result.cache.reloadRequests = requests
    assert(requests === 0, `${requests} network requests on reload`)
    return `${keys.length} entries · max ${maxDays.toFixed(2)} d (QF ${qfMaxDays.toFixed(2)} d) · reload: ${requests} requests`
  })
  await check(checks, 'purgeExpiredCaches: deletes QF entries older than 6 days or undated, keeps the rest; idempotent', async () => {
    const cs = (globalThis as { caches?: CacheStorage }).caches
    assert(cs, 'no Cache Storage in this browser')
    const name = 'balligh-lab-purge-test'
    const now = Date.now()
    const put = async (c: Cache, url: string, stored: number | null) =>
      c.put(url, new Response('{}', { headers: stored === null ? {} : { [STORED_HEADER]: String(stored) } }))
    const scratch = await cs.open(name)
    await put(scratch, 'https://api.quran.com/api/v4/lab/old', now - 7 * DAY_MS)
    await put(scratch, 'https://download.quranicaudio.com/lab/undated.mp3', null)
    await put(scratch, 'https://api.quran.com/api/v4/lab/fresh', now - DAY_MS)
    await put(scratch, 'https://everyayah.com/data/lab/undated.mp3', null)
    const dataBefore = (await (await cs.open(CACHE_NAME)).keys()).length
    await purgeExpiredCaches()
    await purgeExpiredCaches() // idempotent
    const left = (await scratch.keys()).map((r) => r.url).sort()
    const dataAfter = (await (await cs.open(CACHE_NAME)).keys()).length
    await cs.delete(name)
    const want = ['https://api.quran.com/api/v4/lab/fresh', 'https://everyayah.com/data/lab/undated.mp3']
    result.cache.purge = `kept ${left.length}/4 test entries; data cache ${dataBefore} → ${dataAfter}`
    assert(left.join() === want.join(), `left ${left.join(', ')}`)
    assert(dataAfter === dataBefore, `the fresh data cache lost ${dataBefore - dataAfter} entries`)
    return result.cache.purge
  })

  progress('done')
  return result
}
