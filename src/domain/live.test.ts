// Live check (run once with LIVE=1): the committed fixtures still match the public APIs, and the planner
// gives the reference cuts on freshly fetched data. Skipped in normal runs — unit tests never use the network.
import { describe, expect, it } from 'vitest'
import type { Ayah } from '../core/types'
import { AYAH_END_WORD, buildTimeline, planAudio, selectionWarnings, snapToPauses } from './index'
import {
  DISPLAYS,
  everyAyahUrl,
  fixtureAyah,
  qdcAudio,
  RECITER_A,
  RECITER_B,
  toAyah,
  v4Audio,
  type ApiVerse,
  type QdcVerseTiming,
} from './__fixtures__/load'
import v255 from './__fixtures__/audio/qcom_v4_verse_2_255_audio7.json'
import ch1v4 from './__fixtures__/audio/qcom_v4_recitations_7_by_chapter_1_segments.json'
import qdc7 from './__fixtures__/audio/qdc_audio_files_7_ch1_segments.json'
import mp3q112 from './__fixtures__/audio/mp3quran_ayat_timing_s112_r123.json'

const getJson = async (url: string) => {
  const res = await fetch(url)
  expect(res.status, url).toBe(200)
  expect(res.headers.get('access-control-allow-origin'), url).toBe('*')
  return res.json()
}
const WORD_FIELDS = 'text_uthmani,text_uthmani_tajweed,text_qpc_hafs'
const verse = async (key: string) =>
  (await getJson(`https://api.quran.com/api/v4/verses/by_key/${key}?words=true&word_fields=${WORD_FIELDS}`)).verse as ApiVerse
const words = (a: Ayah) => a.words.map((w) => [w.position, w.text, w.waqf, w.waqfChar])
/** Word texts and marks in both display encodings (Tanzil text_uthmani, QPC text_qpc_hafs). */
const liveView = (v: ApiVerse) => DISPLAYS.map((d) => words(toAyah(v, d)))
const fixtureView = (key: string) => DISPLAYS.map((d) => words(fixtureAyah(key, d)))

describe.skipIf(!process.env.LIVE)('live APIs (LIVE=1)', () => {
  it('2:255: words and Alafasy segments are unchanged; the cut is still [1050, 4580]', async () => {
    const d = await getJson(`https://api.quran.com/api/v4/verses/by_key/2:255?words=true&word_fields=${WORD_FIELDS}&audio=7`)
    const live = toAyah(d.verse as ApiVerse, 'qpc')
    expect(liveView(d.verse as ApiVerse)).toEqual(fixtureView('2:255'))
    expect(d.verse.audio.segments.map((s: unknown[]) => s.map(Number))).toEqual(v255.verse.audio.segments)
    const texts = (d.verse.words as { char_type_name: string; text_uthmani: string }[])
      .filter((w) => w.char_type_name === 'word')
      .map((w) => w.text_uthmani)
    const a = v4Audio('2:255', everyAyahUrl('Alafasy_128kbps', 2, 255), d.verse.audio.segments, 0, 0, texts)
    const plan = planAudio({ surah: 2, start: { ayah: 255, word: 3 }, end: { ayah: 255, word: 5 } }, [live], [a], RECITER_A, { basmala: null })
    expect(plan.clips.map((c) => [c.srcStartMs, c.srcEndMs])).toEqual([[1050, 4580]])
  }, 30000)

  it('Al-Fatiha: v4 per-ayah segments and QDC chapter timings are unchanged; the merged QDC cut is still [7025, 17660]', async () => {
    const v4 = await getJson('https://api.quran.com/api/v4/recitations/7/by_chapter/1?fields=segments&per_page=all')
    const byKey = (files: { verse_key: string; segments: unknown[] }[]) =>
      Object.fromEntries(files.map((f) => [f.verse_key, f.segments.map((s) => (s as unknown[]).map(Number))]))
    expect(byKey(v4.audio_files)).toEqual(byKey(ch1v4.audio_files))

    const q = await getJson('https://api.quran.com/api/qdc/audio/reciters/7/audio_files?chapter=1&segments=true')
    const file = q.audio_files[0] as { audio_url: string; verse_timings: QdcVerseTiming[] }
    const keyed = (f: { verse_timings: QdcVerseTiming[] }) => Object.fromEntries(f.verse_timings.map((v) => [v.verse_key, v]))
    expect(keyed(file)).toEqual(keyed(qdc7.audio_files[0]))
    const audio = ['1:2', '1:3', '1:4'].map((k) => qdcAudio(file.verse_timings.find((v) => v.verse_key === k)!, file.audio_url)!)
    const plan = planAudio({ surah: 1, start: { ayah: 2, word: 2 }, end: { ayah: 4, word: 2 } }, [], audio, RECITER_B, { basmala: null })
    expect(plan.clips.map((c) => [c.srcStartMs, c.srcEndMs])).toEqual([[7025, 17660]])
    const tl = buildTimeline(plan, [{ srcStartMs: 7025, durationMs: 10635, wordTimingsValid: true }])
    expect(tl.words).toHaveLength(7)
  }, 30000)

  it('the boundary-guard verses are unchanged in both encodings, and the guard reads them the same', async () => {
    // the cases selection.test.ts and waqf.test.ts rely on: ۛ pairs, ۙ, a QPC-only ۖ, إِلَّا, the curated 107:4
    for (const key of ['2:2', '2:195', '5:26', '16:57', '26:59', '15:59', '103:3', '107:4', '107:5']) {
      expect(liveView(await verse(key)), key).toEqual(fixtureView(key))
    }
    const prev = await verse('103:2')
    const next = await verse('103:3')
    for (const d of DISPLAYS) {
      const ayahs = [toAyah(prev, d), toAyah(next, d)]
      const s = { surah: 103, start: { ayah: 2, word: 1 }, end: { ayah: 2, word: AYAH_END_WORD } }
      expect(selectionWarnings(s, ayahs).map((w) => w.kind), d).toEqual(['next-starts-with-illa'])
      expect(snapToPauses(s, ayahs), d).toEqual({ ...s, end: { ayah: 2, word: 4 } }) // an ayah end is a stop: nothing to snap
    }
  }, 60000)

  it("Alafasy's isti'adha file is still served, cross-origin (the reciter's own audhubillah.mp3, 00-gaps §6.3)", async () => {
    const url = 'https://everyayah.com/data/Alafasy_128kbps/audhubillah.mp3'
    const res = await fetch(url, { method: 'HEAD' })
    expect(res.status, url).toBe(200)
    expect(res.headers.get('access-control-allow-origin'), url).toBe('*')
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(50_000) // 6.75 s at 128 kbps ≈ 108 KB
  }, 30000)

  it('mp3quran ayat_timing for 112 (read 123) is unchanged', async () => {
    const rows = (await getJson('https://www.mp3quran.net/api/v3/ayat_timing?surah=112&read=123')) as {
      ayah: number
      start_time: number
      end_time: number
    }[]
    expect(rows.map((r) => [r.ayah, r.start_time, r.end_time])).toEqual(mp3q112.map((r) => [r.ayah, r.start_time, r.end_time]))
  }, 30000)
})
