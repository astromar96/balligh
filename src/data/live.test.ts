// LIVE checks against the real services — skipped unless LIVE=1 (`LIVE=1 npx vitest run src/data/live.test.ts`).
// They download the whole Quran once (~25 MB) and Khalifa al-Tunaiji's 114 QDC timing files, and probe every
// tafsir, translation and several reciters per class. Expected figures: research/00-gaps.md §2.1–§2.3 (text),
// §2.6 (class B), §2.8 / §6.3 (basmala, isti'adha), §2.10 (pages of 50), §2.11 (translation scripts).
import { LIVE } from './__fixtures__/load'
import { loadAmiriShaper } from './__fixtures__/shaper'
import { auditVerse, emptyCounts, meemCounts, type AuditWord } from './audit'
import { fetchAyahAudioImpl, fetchBasmalaAudioImpl, fetchIstiadhaAudioImpl, fetchV4Segments, qdcUrl, v4SegmentsUrl } from './audio'
import { fetchJson, fetchPages, mapLimit, setPersistentCacheEnabled } from './http'
import { VERSE_COUNTS } from './meta'
import { ALQURAN_CLOUD_SOURCE, QURAN_COM_SOURCE, fetchAyahsImpl, fetchSurahsImpl, quranComVersesUrl, textDiagnostics } from './quran'
import { RECITER_LIST, everyAyahFile, getCatalogEntry } from './reciters'
import { searchQuranImpl } from './search'
import { TAFSIR_LIST, fetchTafsirResultImpl, quranpediaProvider, spa5kProvider } from './tafsir'
import { checkQdcSegments, SPLIT_IN_TIMING, type QdcVerseStatus } from './timing'
import { TRANSLATION_LIST, fetchTranslationImpl, textDirection, textScript } from './translations'
import { skeleton } from './text'
import type { Ayah, AyahAudio } from '../core/types'

const log = (label: string, value: unknown) => console.log(`[live] ${label}: ${JSON.stringify(value)}`)

/** First bytes of an audio file: MP3 frame sync or an ID3 tag. */
async function looksLikeMp3(url: string): Promise<boolean> {
  const res = await fetch(url, { headers: { Range: 'bytes=0-15' } })
  if (res.status !== 206 && res.status !== 200) return false
  const b = new Uint8Array(await res.arrayBuffer()).slice(0, 4)
  return (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
}

describe.skipIf(!LIVE)('LIVE data services', () => {
  beforeAll(() => setPersistentCacheEnabled(false))

  it('builds all 114 surahs from Quran.com in pages of 50: projection, no stray meem, both pause systems, no .notdef', async () => {
    type V = { verse_key: string; text_uthmani_tajweed: string; words: (AuditWord & { char_type_name: string })[] }
    type P = { verses?: V[]; pagination?: { per_page?: unknown; current_page?: unknown; next_page?: unknown; total_pages?: unknown } }
    const counts = emptyCounts()
    const before = textDiagnostics.alignmentFailures
    const surahs: Ayah[][] = new Array(114)
    let requests = 0
    await mapLimit(
      Array.from({ length: 114 }, (_, i) => i + 1),
      4,
      async (s) => {
        const pages = await fetchPages<P>((p) => quranComVersesUrl(s, p), 1, VERSE_COUNTS[s - 1], { ttlMs: 60 * 60_000 })
        requests += pages.length
        for (const page of pages) for (const v of page.verses ?? []) auditVerse(counts, v.verse_key, v.text_uthmani_tajweed, v.words.filter((w) => w.char_type_name === 'word'))
        surahs[s - 1] = await fetchAyahsImpl(s)
        expect(surahs[s - 1].length).toBe(VERSE_COUNTS[s - 1])
      },
    )
    log('whole-Quran audit', { ...counts, requests })
    expect(requests).toBe(VERSE_COUNTS.reduce((n, c) => n + Math.ceil(c / 50), 0))
    expect(counts.verses).toBe(6236)
    expect(counts.words).toBe(77429)
    expect(counts.alignmentFailures).toBe(0)
    expect(counts.tokenMerges).toBe(216)
    expect(counts.qpcMissingWords).toBe(0)
    expect(counts.wordsProjectedExactly).toBeGreaterThanOrEqual(77388)
    expect(counts.lostRules).toEqual(['17:7:12 madda_normal'])
    expect(counts.tanweenMeemWords).toBe(0)
    expect(counts.waqfMarkDiffWords).toBe(353)
    expect(counts.waqfTrailingDiffWords).toBe(352)
    expect(counts.mamnu).toBe(68)
    expect(counts.mamnuWithoutPrintedMark).toBe(67)
    expect(counts.waqfFieldErrors).toBe(0)
    expect(counts.badSpans).toBe(0)
    expect(counts.badDisplayWords).toBe(0)
    expect(textDiagnostics.alignmentFailures - before).toBe(0)
    // what fetchAyahs returns: no stray meem, every glyph in Amiri Quran
    const display = surahs.flatMap((ayahs) => ayahs.map((a) => a.words.map((w) => w.text)))
    expect(meemCounts(display)).toEqual({ words: 0, iqlab: 0, spurious: 0 })
    const shaper = await loadAmiriShaper()
    expect(shaper).not.toBeNull()
    const notdef: string[] = []
    const marks = new Set<string>()
    for (const ayahs of surahs)
      for (const a of ayahs)
        for (const w of a.words) {
          if (shaper?.glyphs(w.text).includes(0)) notdef.push(`${a.key}:${w.position}`)
          if (w.waqfChar) marks.add(w.waqfChar)
        }
    for (const m of marks) if (shaper?.glyphs(` ${m}`).includes(0)) notdef.push(`mark ${m}`)
    log('.notdef', notdef)
    expect(notdef).toEqual([])
  }, 900_000)

  it('serves the surah list and the alquran.cloud fallback in Quran.com segmentation, without stray meems', async () => {
    expect((await fetchSurahsImpl()).length).toBe(114)
    expect((await ALQURAN_CLOUD_SOURCE.surahs()).length).toBe(114)
    // same word positions and guard marks; the letters may be encoded differently (Tanzil «ٱلْءَاخِرَةِ» vs QPC «ٱلۡـَٔاخِرَةِ»)
    let words = 0
    let sameSkeleton = 0
    const fallbackWords: string[][] = []
    for (const s of [1, 2, 8, 36, 37, 112]) {
      const [qc, aq] = await Promise.all([QURAN_COM_SOURCE.ayahs(s), ALQURAN_CLOUD_SOURCE.ayahs(s)])
      expect(aq.map((a) => a.words.length), `surah ${s}`).toEqual(qc.map((a) => a.words.length))
      expect(aq.map((a) => a.words.map((w) => w.waqf ?? '').join('|')), `surah ${s}`).toEqual(qc.map((a) => a.words.map((w) => w.waqf ?? '').join('|')))
      qc.forEach((a, i) =>
        a.words.forEach((w, k) => {
          words++
          if (skeleton(w.text) === skeleton(aq[i].words[k].text)) sameSkeleton++
        }),
      )
      fallbackWords.push(...aq.map((a) => a.words.map((w) => w.text)))
    }
    log('alquran.cloud vs Quran.com letters', { words, sameSkeleton })
    expect(sameSkeleton / words).toBeGreaterThan(0.97)
    expect(meemCounts(fallbackWords)).toEqual({ words: 0, iqlab: 0, spurious: 0 })
  }, 300_000)

  const byClass: Record<'A' | 'B' | 'C' | 'D', string[]> = {
    A: ['alafasy', 'abdulbasit-murattal', 'husary', 'sudais', 'minshawi-mujawwad'],
    B: ['yasser-dosari', 'khalifa-tunaiji', 'khalid-jalil'],
    C: ['maher-muaiqly', 'ahmed-ajmi', 'ali-jaber'],
    D: ['saad-ghamdi', 'idrees-abkar'],
  }

  it.each(Object.entries(byClass))('class %s reciters: audio, windows, timings and per-ayah fallbacks for 112, 37:130 and the basmala', async (cls, ids) => {
    for (const id of ids) {
      expect(RECITER_LIST.find((r) => r.id === id)?.timingClass, id).toBe(cls)
      const ayahs = await fetchAyahAudioImpl(id, 112, [1, 2, 3, 4])
      const basmala = await fetchBasmalaAudioImpl(id)
      const split = await fetchAyahAudioImpl(id, 37, [130])
      expect(basmala.ayah, id).toBe(0)
      const all: AyahAudio[] = [...ayahs, basmala, ...split]
      expect(await looksLikeMp3(all[0].url), `${id} ${all[0].url}`).toBe(true)
      expect(await looksLikeMp3(basmala.url), `${id} basmala ${basmala.url}`).toBe(true)
      for (const a of all) {
        expect(a.url, id).toMatch(/^https:\/\//)
        if (cls === 'A' || cls === 'C') expect(a.fileKind, id).toBe('per_ayah')
        if (cls === 'B' || cls === 'D') expect(a.fileKind, id).toBe('chapter')
        if (cls === 'A' || cls === 'B') expect(a.timing === 'none' || a.words.length >= a.wordCount, `${id} ${a.ayah}`).toBe(true)
        if (cls === 'C' || cls === 'D') expect(a.words, id).toEqual([])
        if (cls === 'D') expect(a.approximateWindow, id).toBe(true)
        if (a.fileKind === 'chapter') {
          expect(a.windowEndMs ?? 0, id).toBeGreaterThan(a.windowStartMs)
          expect(a.bitrateKbps, id).toBeGreaterThan(0)
          // the reciter's own per-ayah file, when there is one (never Tunaiji's 1:1: Minshawi's voice)
          const own = getCatalogEntry(id)?.everyayah && !(id === 'khalifa-tunaiji' && a.ayah === 0)
          expect(a.perAyahUrl !== null, `${id} ${a.ayah} perAyahUrl`).toBe(Boolean(own))
        } else expect(a.perAyahUrl, id).toBeNull()
      }
      const fallback = ayahs.find((a) => a.perAyahUrl)?.perAyahUrl
      if (fallback) expect(await looksLikeMp3(fallback), `${id} ${fallback}`).toBe(true)
      if (cls === 'A' || cls === 'B') {
        const s = split[0]
        if (s.timing !== 'none') expect(s.words.filter((w) => w.word === 3), `${id} 37:130 split word merged`).toHaveLength(1)
      }
      log(`audio ${id}`, all.map((a) => [a.ayah, a.fileKind, a.windowStartMs, a.windowEndMs, a.timing, a.words.length]))
    }
  }, 300_000)

  it("serves the isti'adha only in the reciter's own voice and Ali Jaber's 1:1 without it (00-gaps §6.3)", async () => {
    const offered: string[] = []
    for (const r of RECITER_LIST) {
      const a = await fetchIstiadhaAudioImpl(r.id)
      expect(a !== null, r.id).toBe(r.istiadha)
      if (!a) continue
      offered.push(r.id)
      expect(a.ayah).toBe(-1)
      expect(await looksLikeMp3(a.url), a.url).toBe(true)
    }
    expect(offered.sort()).toEqual(['alafasy', 'ali-jaber', 'hudhaifi', 'husary', 'shatri'])
    const [jaber] = await fetchAyahAudioImpl('ali-jaber', 1, [1])
    expect(jaber.url).toBe(everyAyahFile(getCatalogEntry('ali-jaber')!, 'bismillah.mp3'))
    expect(await looksLikeMp3(jaber.url)).toBe(true)
  }, 120_000)

  it('validates every verse of Khalifa al-Tunaiji (QDC 161) like the whole-Quran scan, and serves his VBR chapters per ayah', async () => {
    type Vt = { verse_key: string; timestamp_from: number; timestamp_to: number; segments?: unknown[] }
    const counts: Partial<Record<QdcVerseStatus | 'zero_length', number>> = {}
    let verses = 0
    await mapLimit(
      Array.from({ length: 114 }, (_, i) => i + 1),
      3,
      async (s) => {
        const json = await fetchJson<{ audio_files?: { verse_timings?: Vt[] }[] }>(qdcUrl(161, s), { ttlMs: 60_000 })
        const ayahs = await fetchAyahsImpl(s)
        for (const vt of json?.audio_files?.[0]?.verse_timings ?? []) {
          verses++
          const n = ayahs[Number(vt.verse_key.split(':')[1]) - 1]?.words.length ?? 0
          // exactly what classb_scan.py validated: the raw tuples, before the 37:130 remap
          const segs = (Array.isArray(vt.segments) ? vt.segments : [])
            .filter((x): x is unknown[] => Array.isArray(x) && x.length === 3 && x.every((z) => typeof z === 'number' && Number.isFinite(z)))
            .map((x) => x.map((z) => Math.round(z as number)))
          const status = vt.timestamp_to > vt.timestamp_from ? checkQdcSegments(segs, n).status : 'zero_length'
          counts[status] = (counts[status] ?? 0) + 1
        }
      },
    )
    log('Khalifa QDC 161 statuses', { verses, ...counts })
    expect(verses).toBe(6236)
    // classb-scan.json (2026-11-21): 5,435 ok, 374 ok_with_repeats, 247 invalid_order, 179 missing_words, 1 overflow (37:130)
    expect(counts.invalid_order).toBe(247)
    expect(counts.missing_words).toBe(179)
    expect(counts.overflow).toBe(1)
    expect((counts.ok ?? 0) + (counts.ok_with_repeats ?? 0)).toBe(5435 + 374)
    expect(Object.keys(SPLIT_IN_TIMING)).toEqual(['37:130'])
    for (const ch of [14, 72]) {
      const [a] = await fetchAyahAudioImpl('khalifa-tunaiji', ch, [1])
      expect(a).toMatchObject({ fileKind: 'per_ayah', timing: 'none' })
      expect(await looksLikeMp3(a.url), a.url).toBe(true)
    }
  }, 600_000)

  it('reads class-A segments in pages of 50 (2:255 → page 6 only)', async () => {
    const map = await fetchV4Segments(7, 2, 255, 255)
    expect(map.has('2:255')).toBe(true)
    expect(map.has('2:1')).toBe(false)
    const [a] = await fetchAyahAudioImpl('alafasy', 2, [255])
    expect(a.timing).not.toBe('none')
    log('alafasy 2:255', { url: v4SegmentsUrl(7, 2, 6), words: a.words.length, timing: a.timing })
  }, 120_000)

  it('every tafsir answers for 2:255 (Ahkam books for 2:282) and gaps/groups behave', async () => {
    for (const t of TAFSIR_LIST) {
      const ayah = t.id.startsWith('ahkam-') ? 282 : 255
      const r = await fetchTafsirResultImpl(t.id, 2, ayah, ayah)
      log(`tafsir ${t.id} 2:${ayah}`, { provider: r.providerId, entries: r.entries.map((e) => [e.ayahFrom, e.ayahTo, e.text.length]), credit: r.creditAr })
      expect(r.entries.length, t.id).toBeGreaterThan(0)
      expect(r.entries.every((e) => e.text.length > 20 && !/<[a-z]/i.test(e.text)), t.id).toBe(true)
      expect(r.creditAr.length, t.id).toBeGreaterThan(5)
    }
    const saadiGap = await fetchTafsirResultImpl('saadi', 78, 10, 12)
    log('saadi 78:10-12', saadiGap.entries.map((e) => [e.ayahFrom, e.ayahTo]))
    const muyassarGroup = await fetchTafsirResultImpl('muyassar', 78, 22, 22)
    log('muyassar 78:22', muyassarGroup.entries.map((e) => [e.ayahFrom, e.ayahTo]))
    expect(muyassarGroup.entries[0].ayahFrom).toBeLessThan(22)
  }, 300_000)

  it('the fallback tafsir hosts answer (spa5k mirrors, Quranpedia)', async () => {
    const spa5k = await spa5kProvider('ar-tafsir-al-mukhtasar').fetchAyah(2, 255)
    expect(spa5k?.text.length).toBeGreaterThan(50)
    const qp = await quranpediaProvider(3).fetchAyah(103, 2)
    log("quranpedia sa'di 103:2", { covers: qp?.covers, head: qp?.text.slice(0, 40) })
    expect(qp?.covers).toEqual([1, 3])
  }, 120_000)

  it('every translation answers for surah 112 with footnote-free text in the script and direction it declares', async () => {
    const bad: string[] = []
    const seen: Record<number, string> = {}
    await mapLimit(TRANSLATION_LIST, 4, async (t) => {
      const rows = await fetchTranslationImpl(t.id, 112, 1, 4).catch(() => [])
      const text = rows.map((r) => r.text).join(' ')
      seen[t.id] = `${textScript(text)} ${textDirection(text)}`
      if (rows.length !== 4 || rows.some((r) => !r.text || /<sup|foot_note/.test(r.text))) bad.push(`${t.id} text`)
      if (textScript(text) !== t.script) bad.push(`${t.id} script ${textScript(text)} ≠ ${t.script}`)
      if (textDirection(text) !== t.dir) bad.push(`${t.id} dir ${textDirection(text)} ≠ ${t.dir}`)
    })
    log('translation scripts', seen)
    expect(bad).toEqual([])
    // a range across two pages of 50
    const across = await fetchTranslationImpl(20, 2, 49, 52)
    expect(across.map((e) => e.ayah)).toEqual([49, 50, 51, 52])
  }, 300_000)

  it('searches the whole Quran locally', async () => {
    const salah = await searchQuranImpl('الصلاة', 1000)
    const ikhlas = await searchQuranImpl('قل هو الله احد')
    const uthmani = await searchQuranImpl('ٱلصَّلَوٰةَ', 1000)
    log('search', { salah: salah.length, uthmani: uthmani.length, ikhlas: ikhlas.slice(0, 2), ref: await searchQuranImpl('2:255') })
    expect(ikhlas[0]).toMatchObject({ surah: 112, ayah: 1 })
    expect(salah.length).toBeGreaterThan(50)
    expect(uthmani.length).toBeGreaterThan(50)
  }, 120_000)
})
