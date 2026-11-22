// Ports research/scripts/audio-timing/test-cut-planner.ts (same real payloads → same cuts, see
// research/fixtures/audio-timing/cut_planner_test_output.txt) and adds the contract's own cases.
import { describe, expect, it } from 'vitest'
import type { AudioClip, AudioPlan, AyahAudio, Selection } from '../core/types'
import { AYAH_END_WORD, buildTimeline, estimatePlanDurationMs, MAX_VIDEO_MS, planAudio } from './index'
import { locateWords } from './audio-plan'
import {
  everyAyahUrl,
  fixtureAyah,
  fixtureAyahs,
  istiadhaAudio,
  mp3quranAudio,
  perAyahAudio,
  qdcAudio,
  RECITER_A,
  RECITER_B,
  RECITER_C,
  RECITER_D,
  v4Audio,
  type QdcVerseTiming,
} from './__fixtures__/load'
import ch1v4 from './__fixtures__/audio/qcom_v4_recitations_7_by_chapter_1_segments.json'
import v255 from './__fixtures__/audio/qcom_v4_verse_2_255_audio7.json'
import s13 from './__fixtures__/audio/qcom_v4_recitations_7_by_ayah_1_3_segments.json'
import s1121 from './__fixtures__/audio/qcom_v4_recitations_7_by_ayah_112_1_segments.json'
import s37152 from './__fixtures__/audio/qcom_v4_recitations_7_by_ayah_37_152_segments.json'
import qdc7 from './__fixtures__/audio/qdc_audio_files_7_ch1_segments.json'
import qdc97 from './__fixtures__/audio/qdc_audio_files_97_ch1_segments.json'
import qdc173 from './__fixtures__/audio/qdc_audio_files_173_ch1_segments.json'
import anomalies from './__fixtures__/audio/qdc_anomalies.json'
import mp3q112 from './__fixtures__/audio/mp3quran_ayat_timing_s112_r123.json'
import mp3q1 from './__fixtures__/audio/mp3quran_ayat_timing_s1_r5.json'

const sel = (surah: number, a1: number, w1: number, a2: number, w2: number): Selection => ({
  surah,
  start: { ayah: a1, word: w1 },
  end: { ayah: a2, word: w2 },
})
const NO_BASMALA = { basmala: null }
const EA = 'Alafasy_128kbps'
const v4Seg = (key: string) => ch1v4.audio_files.find((f) => f.verse_key === key)!.segments
const qdcVerse = (file: { verse_timings: QdcVerseTiming[] }, key: string) => file.verse_timings.find((v) => v.verse_key === key)!
const anomaly = (prefix: string) => {
  const [, v] = Object.entries(anomalies).find(([k]) => k.startsWith(prefix))!
  return v as { audio_url: string; verse_timings: QdcVerseTiming[] }
}
/** What media/assembleAudio reports when nothing moves: planned start, planned length (per-ayah ends clamped to the file). */
const asPlanned = (plan: AudioPlan, fileDurations: Record<string, number> = {}) =>
  plan.clips.map((c) => {
    const end = Math.min(c.srcEndMs ?? Infinity, fileDurations[c.url] ?? Infinity)
    return { srcStartMs: c.srcStartMs, durationMs: end - c.srcStartMs, wordTimingsValid: true }
  })
const cuts = (plan: AudioPlan) => plan.clips.map((c) => [c.url.split('/').pop(), c.srcStartMs, c.srcEndMs])
const highlights = (plan: AudioPlan, files: Record<string, number> = {}) =>
  buildTimeline(plan, asPlanned(plan, files)).words.map((w) => [w.ayah, w.word, w.startMs, w.endMs])

const alafasyV4 = (surah: number, key: string, segments: unknown[]) =>
  v4Audio(key, everyAyahUrl(EA, surah, Number(key.split(':')[1])), segments)

describe('reference scenarios (real payloads, research/fixtures/audio-timing/cut_planner_test_output.txt)', () => {
  it('1) Alafasy 2:255 w3–w5: one mid-ayah cut [1050, 4580]', () => {
    const a = alafasyV4(2, '2:255', v255.verse.audio.segments)
    const plan = planAudio(sel(2, 255, 3, 255, 5), [fixtureAyah('2:255')], [a], RECITER_A, NO_BASMALA)
    expect(cuts(plan)).toEqual([['002255.mp3', 1050, 4580]])
    expect(plan.clips[0]).toMatchObject({ ayah: 255, ayahTo: 255, fadeInMs: 8, fadeOutMs: 25, fileKind: 'per_ayah', snapToPause: false })
    expect(plan.clips[0].extendToSpeechOnset).toBe(false)
    expect(plan).toMatchObject({ reciterId: 'alafasy', exact: true, wordLevel: true, playedSelection: sel(2, 255, 3, 255, 5) })
    expect(highlights(plan)).toEqual([
      [255, 3, 0, 2400],
      [255, 4, 2410, 3150],
      [255, 5, 3160, 3530],
    ])
    expect(buildTimeline(plan, asPlanned(plan)).durationMs).toBe(3530)
  })

  it('2) Alafasy 1:2 w3 → 1:3 w1: two per-ayah files [1810, 5490] + [40, 1230]', () => {
    const a12 = alafasyV4(1, '1:2', v4Seg('1:2'))
    const a13 = alafasyV4(1, '1:3', s13.audio_files[0].segments)
    const plan = planAudio(sel(1, 2, 3, 3, 1), fixtureAyahs(1), [a12, a13], RECITER_A, NO_BASMALA)
    expect(cuts(plan)).toEqual([
      ['001002.mp3', 1810, 5490],
      ['001003.mp3', 40, 1230],
    ])
    expect(plan.clips.map((c) => [c.fadeInMs, c.fadeOutMs])).toEqual([
      [8, 60],
      [8, 25],
    ])
    expect(plan.clips[1].extendToSpeechOnset).toBe(true) // starts at word 1 of 1:3 from a word timing
    expect(highlights(plan)).toEqual([
      [2, 3, 0, 650],
      [2, 4, 660, 3330],
      [3, 1, 3680, 4870],
    ])
  })

  it('3) Sudais sends the numbers as strings', () => {
    const strings = [['0', '1', '420', '1000'], ['1', '2', '1010', '1860'], ['2', '3', '1870', '2430'], ['3', '4', '2440', '4190']]
    const a = v4Audio('1:2', everyAyahUrl('Abdurrahmaan_As-Sudais_192kbps', 1, 2), strings, 4493)
    expect(a.words.map((w) => w.startMs)).toEqual([420, 1010, 1870, 2440])
    const plan = planAudio(sel(1, 2, 1, 2, 4), fixtureAyahs(1), [a], RECITER_A, NO_BASMALA)
    expect(cuts(plan)).toEqual([['001002.mp3', 300, 4540]]) // 420 ms of lead-in > 80 → 120 ms lead pad
    expect(plan.clips[0].fadeInMs).toBe(20)
  })

  it('4) QDC Alafasy 13:4 w11–w14: the reciter repeated 10–12 → the second, clean reading', () => {
    const rep = anomaly('repetition_alafasy_13_4')
    const a = qdcAudio(rep.verse_timings[0], rep.audio_url)!
    const L1 = locateWords(a.words, 1, 11)!
    const L2 = locateWords(a.words, 11, 14)!
    const L3 = locateWords(a.words, 10, 12)!
    expect(a.words[L1.iE].endMs).toBe(117185) // first pass, stops before the repetition
    expect(a.words[L2.iS].startMs).toBe(122215) // starts at the SECOND reading of word 11
    expect(a.words[L3.iS].startMs).toBe(114455) // single clean pass 10..12
    const plan = planAudio(sel(13, 4, 11, 4, 14), [fixtureAyah('13:4')], [a], RECITER_B, NO_BASMALA)
    expect(cuts(plan)).toEqual([['13.mp3', 122215, 128820]])
    expect(plan.clips[0]).toMatchObject({ fadeInMs: 8, fadeOutMs: 25, fileKind: 'chapter', extendToSpeechOnset: false })
    expect(highlights(plan)).toEqual([
      [4, 11, 0, 800],
      [4, 12, 800, 2410],
      [4, 13, 2410, 3660],
      [4, 14, 3660, 6605],
    ])
  })

  it('5) QDC Tunaiji 13:1 corrupt word order → estimated → whole ayah, not exact', () => {
    const bad = anomaly('corrupt_tunaiji_13_1')
    const a = qdcAudio(bad.verse_timings[0], bad.audio_url, 64)!
    expect(a.words.every((w) => w.estimated)).toBe(true)
    const plan = planAudio(sel(13, 1, 2, 1, 5), [fixtureAyah('13:1')], [a], RECITER_B, NO_BASMALA)
    expect(cuts(plan)).toEqual([['13.mp3', 0, 35210]])
    expect(plan).toMatchObject({ exact: false, wordLevel: false, playedSelection: sel(13, 1, 1, 1, 15) })
    expect(plan.clips[0].words).toEqual([])
  })

  it('6) 37:130 split word (QDC has 4 indices, Quran.com 3 words)', () => {
    const sp = anomaly('split_word_37_130')
    const a = qdcAudio(sp.verse_timings[0], sp.audio_url)!
    expect(a.words.map((w) => w.word)).toEqual([1, 2, 3])
    expect(a.words[2].endMs).toBe(761230)
    const plan = planAudio(sel(37, 130, 1, 130, 3), [fixtureAyah('37:130')], [a], RECITER_B, NO_BASMALA)
    expect(cuts(plan)).toEqual([['037.mp3', 756900, 761230]])
    expect(plan.exact).toBe(true)
  })

  it('7) QDC 173 Fatiha: 1:1 has zero length (no basmala in that file) → no basmala clip', () => {
    const f = qdc173.audio_files[0]
    expect(qdcAudio(f.verse_timings[0], f.audio_url)).toBeNull()
    const empty: AyahAudio = {
      ayah: 1,
      url: f.audio_url,
      fileKind: 'chapter',
      bitrateKbps: 96,
      windowStartMs: 80,
      windowEndMs: 80,
      approximateWindow: false,
      words: [1, 2, 3, 4].map((word) => ({ word, startMs: 80, endMs: 80, estimated: false })),
      wordCount: 4,
      timing: 'word',
      perAyahUrl: null,
    }
    const a = alafasyV4(112, '112:1', s1121.audio_files[0].segments)
    const plan = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a], RECITER_A, { basmala: empty })
    expect(plan.clips.map((c) => c.ayah)).toEqual([1])
  })

  it('8) QDC Alafasy 1:2 w2 → 1:4 w2 in one chapter file: a single merged clip [7025, 17660]', () => {
    const f = qdc7.audio_files[0]
    const audio = ['1:2', '1:3', '1:4'].map((k) => qdcAudio(qdcVerse(f, k), f.audio_url)!)
    const plan = planAudio(sel(1, 2, 2, 4, 2), fixtureAyahs(1), audio, RECITER_B, NO_BASMALA)
    expect(cuts(plan)).toEqual([['1.mp3', 7025, 17660]])
    const c = plan.clips[0]
    expect(c).toMatchObject({ ayah: 2, ayahTo: 4, fadeInMs: 8, fadeOutMs: 25, bitrateKbps: 128 })
    expect(c.ayahs).toEqual([
      { ayah: 2, startMs: 7025, endMs: 11615 },
      { ayah: 3, startMs: 11615, endMs: 16245 },
      { ayah: 4, startMs: 16245, endMs: null },
    ])
    expect(highlights(plan)).toEqual([
      [2, 2, 0, 860],
      [2, 3, 860, 1490],
      [2, 4, 1490, 4525],
      [3, 1, 4590, 5830],
      [3, 2, 5830, 9155],
      [4, 1, 9220, 10040],
      [4, 2, 10040, 10635],
    ])
    expect(buildTimeline(plan, asPlanned(plan)).ayahs).toEqual([
      { ayah: 2, startMs: 0, endMs: 4590 },
      { ayah: 3, startMs: 4590, endMs: 9220 },
      { ayah: 4, startMs: 9220, endMs: 10635 },
    ])
  })

  it('9) 112:1 with the basmala prepended (per-ayah files have none)', () => {
    const bas = v4Audio('1:1', everyAyahUrl(EA, 1, 1), v4Seg('1:1'), 6031)
    const a = alafasyV4(112, '112:1', s1121.audio_files[0].segments)
    const plan = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a], RECITER_A, { basmala: bas })
    // the reference clamps the basmala to its 6031 ms file; here the media clamps to the decoded length
    expect(cuts(plan)).toEqual([
      ['001001.mp3', 60, 5970 + 350],
      ['112001.mp3', 30, 2650],
    ])
    const files = { [everyAyahUrl(EA, 1, 1)]: 6031, [everyAyahUrl(EA, 112, 1)]: 2917 }
    expect(asPlanned(plan, files).map((r) => [r.srcStartMs, r.srcStartMs + r.durationMs])).toEqual([
      [60, 6031],
      [30, 2650],
    ])
    expect(plan.clips.map((c) => [c.ayah, c.ayahTo, c.fadeInMs, c.fadeOutMs])).toEqual([
      [0, 0, 8, 60],
      [1, 1, 8, 60],
    ])
    expect(plan.clips[0].words.map((w) => [w.ayah, w.word])).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ])
    const tl = buildTimeline(plan, asPlanned(plan, files))
    expect(tl.ayahs).toEqual([
      { ayah: 0, startMs: 0, endMs: 5971 },
      { ayah: 1, startMs: 5971, endMs: 5971 + 2620 },
    ])
    expect(plan.exact).toBe(true)
    expect(plan.wordLevel).toBe(false)
  })
})

describe('basmala rule', () => {
  const bas = v4Audio('1:1', everyAyahUrl(EA, 1, 1), v4Seg('1:1'), 6031)
  const a1121 = alafasyV4(112, '112:1', s1121.audio_files[0].segments)
  it('only when the played selection opens the surah, and never in surahs 1 and 9', () => {
    expect(planAudio(sel(112, 1, 2, 1, 4), [fixtureAyah('112:1')], [a1121], RECITER_A, { basmala: bas }).clips).toHaveLength(1)
    expect(planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a1121], RECITER_A, { basmala: null }).clips).toHaveLength(1)
    const fatiha = planAudio(sel(1, 1, 1, 1, 4), fixtureAyahs(1), [alafasyV4(1, '1:1', v4Seg('1:1'))], RECITER_A, { basmala: bas })
    expect(fatiha.clips.map((c) => c.ayah)).toEqual([1])
    const tawbah: AyahAudio = { ...perAyahAudio('112:1', everyAyahUrl(EA, 9, 1)), wordCount: 9 }
    expect(planAudio(sel(9, 1, 1, 1, AYAH_END_WORD), [], [tawbah], RECITER_C, { basmala: bas }).clips.map((c) => c.ayah)).toEqual([1])
  })
  it('follows the played selection: a class C partial start widened to word 1 gets the basmala', () => {
    const c = perAyahAudio('112:1', everyAyahUrl('MaherAlMuaiqly128kbps', 112, 1))
    const basC = perAyahAudio('1:1', everyAyahUrl('MaherAlMuaiqly128kbps', 1, 1))
    const plan = planAudio(sel(112, 1, 3, 1, 4), [fixtureAyah('112:1')], [c], RECITER_C, { basmala: basC })
    expect(plan.clips.map((x) => [x.ayah, x.srcStartMs, x.srcEndMs, x.words.length])).toEqual([
      [0, 0, null, 0],
      [1, 0, null, 0],
    ])
    expect(plan.playedSelection).toEqual(sel(112, 1, 1, 1, 4))
  })
})

describe('classes C and D: whole ayahs only', () => {
  const maher = (k: string) => perAyahAudio(k, everyAyahUrl('MaherAlMuaiqly128kbps', 112, Number(k.split(':')[1])))
  it('class C widens a word selection to whole per-ayah files', () => {
    const plan = planAudio(sel(112, 2, 2, 3, 2), fixtureAyahs(112), [maher('112:2'), maher('112:3')], RECITER_C, NO_BASMALA)
    expect(plan.clips.map((c) => [c.ayah, c.srcStartMs, c.srcEndMs, c.fadeInMs, c.fadeOutMs])).toEqual([
      [2, 0, null, 8, 60],
      [3, 0, null, 8, 60],
    ])
    expect(plan).toMatchObject({ exact: false, wordLevel: false, playedSelection: sel(112, 2, 1, 3, 4) })
    expect(plan.clips.every((c) => c.words.length === 0 && !c.snapToPause && !c.extendToSpeechOnset)).toBe(true)
  })
  it('class C whole ayahs are exact', () => {
    const plan = planAudio(sel(112, 2, 1, 3, AYAH_END_WORD), fixtureAyahs(112), [maher('112:2'), maher('112:3')], RECITER_C, NO_BASMALA)
    expect(plan).toMatchObject({ exact: true, wordLevel: false, playedSelection: sel(112, 2, 1, 3, 4) })
  })
  it('class D: approximate chapter windows merge into one clip that snaps to pauses', () => {
    const url = 'https://cdn.mp3quran.net/audio/mishary-alafasy/r1/112.mp3' // read 123 timings
    const audio = mp3q112.map((row) => mp3quranAudio(112, row, url))
    const basmala = mp3quranAudio(1, mp3q1.find((r) => r.ayah === 1)!, 'https://cdn.mp3quran.net/audio/ahmad-ajmi/r1/001.mp3')
    const plan = planAudio(sel(112, 1, 2, 4, 3), fixtureAyahs(112), audio, RECITER_D, { basmala })
    expect(plan.clips.map((c) => [c.ayah, c.ayahTo, c.srcStartMs, c.srcEndMs, c.snapToPause, c.fadeInMs, c.fadeOutMs])).toEqual([
      [0, 0, 2731, 5720, true, 20, 60],
      [1, 4, 7539, 20706, true, 20, 60],
    ])
    expect(plan.clips[1].ayahs).toEqual([
      { ayah: 1, startMs: 7539, endMs: 10374 },
      { ayah: 2, startMs: 10374, endMs: 13167 },
      { ayah: 3, startMs: 13167, endMs: 16548 },
      { ayah: 4, startMs: 16548, endMs: null },
    ])
    expect(plan).toMatchObject({ exact: false, wordLevel: false, playedSelection: sel(112, 1, 1, 4, 5) })
  })
  it('a chapter window with an unknown end stops at the next ayah, never at the file end', () => {
    const url = 'https://cdn.mp3quran.net/audio/x/r1/112.mp3'
    const audio = mp3q112.map((row) => ({ ...mp3quranAudio(112, row, url), windowEndMs: null }))
    const plan = planAudio(sel(112, 1, 1, 4, 5), fixtureAyahs(112), audio, RECITER_D, NO_BASMALA)
    expect(cuts(plan)).toEqual([['112.mp3', 7539, 16548]]) // 112:4 has no end and no next ayah: skipped
    expect(plan.exact).toBe(false)
    expect(plan.playedSelection).toEqual(sel(112, 1, 1, 3, 4))
  })
})

describe('class B chapter files (QDC Yasser ch 1)', () => {
  const f = qdc97.audio_files[0]
  const audio = ['1:1', '1:2', '1:3', '1:4', '1:5', '1:6', '1:7'].map((k) => qdcAudio(qdcVerse(f, k), f.audio_url)!)
  it('pads 120 ms before a word that follows a pause, never into the previous word', () => {
    // 1:3 word 1 starts 9910, its window 9610: gap 300 > 80 → max(9610, 9910 − 120)
    const plan = planAudio(sel(1, 3, 1, 3, 2), fixtureAyahs(1), audio, RECITER_B, NO_BASMALA)
    expect(cuts(plan)).toEqual([['001.mp3', 9790, 15680]]) // tail bounded by the window end 15680
    expect(plan.clips[0]).toMatchObject({ fadeInMs: 20, fadeOutMs: 60 })
    const wide = planAudio(sel(1, 3, 1, 3, 2), fixtureAyahs(1), audio, RECITER_B, { basmala: null, leadPadMs: 1000, tailPadMs: 0 })
    expect(cuts(wide)).toEqual([['001.mp3', 9610, 15680]])
  })
  it('finding B in a chapter file: a cut that opens the ayah lets the media search back to the window start', () => {
    // 1:3: window 9610, first segment 9910 — the media may find speech in between (never before the window)
    const plan = planAudio(sel(1, 3, 1, 3, 2), fixtureAyahs(1), audio, RECITER_B, NO_BASMALA)
    const c = plan.clips[0]
    expect(c).toMatchObject({ srcStartMs: 9790, extendToSpeechOnset: true })
    expect(c.ayahs).toEqual([{ ayah: 3, startMs: 9610, endMs: null }])
    // the media extended the start to 9650: word 1 is highlighted from the clip start and the ayah tiles the clip
    const tl = buildTimeline(plan, [{ srcStartMs: 9650, durationMs: 15680 - 9650, wordTimingsValid: true }])
    expect(tl.ayahs).toEqual([{ ayah: 3, startMs: 0, endMs: 6030 }])
    expect(tl.words.map((w) => [w.word, w.startMs])).toEqual([
      [1, 0],
      [2, c.words[1].startMs - 9650],
    ])
    // from word 2 the cut does not open the ayah: no search, and the entry starts at the cut
    const mid = planAudio(sel(1, 3, 2, 3, 2), fixtureAyahs(1), audio, RECITER_B, NO_BASMALA)
    expect(mid.clips[0].extendToSpeechOnset).toBe(false)
    expect(mid.clips[0].ayahs).toEqual([{ ayah: 3, startMs: mid.clips[0].srcStartMs, endMs: null }])
  })
  it('keeps the merged clip for a whole surah and words in reading order', () => {
    const plan = planAudio(sel(1, 1, 1, 7, AYAH_END_WORD), fixtureAyahs(1), audio, RECITER_B, NO_BASMALA)
    expect(plan.clips).toHaveLength(1)
    expect(plan.clips[0]).toMatchObject({ ayah: 1, ayahTo: 7, srcStartMs: 180, srcEndMs: 47970 })
    expect(plan.clips[0].words.map((w) => `${w.ayah}:${w.word}`)).toEqual(
      fixtureAyahs(1).flatMap((a) => a.words.map((w) => `${a.number}:${w.position}`)),
    )
    expect(plan).toMatchObject({ exact: true, wordLevel: false })
  })
  it('does not merge across a ≥ 4 s gap or another file', () => {
    const far = { ...audio[2], windowStartMs: 30000, windowEndMs: 36000, words: audio[2].words.map((w) => ({ ...w, startMs: w.startMs + 20400, endMs: w.endMs + 20400 })) }
    const other = { ...audio[3], url: 'https://download.quranicaudio.com/qdc/other/1.mp3' }
    const plan = planAudio(sel(1, 2, 1, 4, 3), fixtureAyahs(1), [audio[1], far, other], RECITER_B, NO_BASMALA)
    expect(plan.clips.map((c) => [c.ayah, c.ayahTo])).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
    ])
  })
})

describe('finding A: stale timings past the file end (Alafasy 37:152)', () => {
  const url = everyAyahUrl(EA, 37, 152)
  const segs = s37152.audio_files[0].segments
  it('without a known file length: plans the timed cut and leaves the check to the decoder', () => {
    const a = v4Audio('37:152', url, segs, 6766)
    const plan = planAudio(sel(37, 152, 1, 152, 4), [fixtureAyah('37:152')], [a], RECITER_A, NO_BASMALA)
    expect(cuts(plan)).toEqual([['037152.mp3', 12600, 19670]])
  })
  it('with a known window: the timings are rejected and the whole file plays (never a negative cut)', () => {
    const a = { ...v4Audio('37:152', url, segs, 6766), windowEndMs: 6766 }
    const plan = planAudio(sel(37, 152, 2, 152, 3), [fixtureAyah('37:152')], [a], RECITER_A, NO_BASMALA)
    expect(cuts(plan)).toEqual([['037152.mp3', 0, 6766]])
    expect(plan).toMatchObject({ exact: false, wordLevel: false, playedSelection: sel(37, 152, 1, 152, 4) })
  })
})

describe('finding B and edge cases', () => {
  it('flags extendToSpeechOnset only for per-ayah cuts that start at word 1', () => {
    const a = alafasyV4(1, '1:2', v4Seg('1:2'))
    expect(planAudio(sel(1, 2, 1, 2, 2), fixtureAyahs(1), [a], RECITER_A, NO_BASMALA).clips[0].extendToSpeechOnset).toBe(true)
    expect(planAudio(sel(1, 2, 2, 2, 4), fixtureAyahs(1), [a], RECITER_A, NO_BASMALA).clips[0].extendToSpeechOnset).toBe(false)
  })
  it('an ayah of a class A reciter without segments plays whole (Minshawi Mujawwad 32:24 has none)', () => {
    const a = v4Audio('112:2', everyAyahUrl(EA, 112, 2), [])
    expect(a.timing).toBe('none')
    const plan = planAudio(sel(112, 2, 2, 2, 2), fixtureAyahs(112), [a], RECITER_A, NO_BASMALA)
    expect(cuts(plan)).toEqual([['112002.mp3', 0, null]])
    expect(plan.exact).toBe(false)
  })
  it('skips ayahs without audio and orders a reversed selection', () => {
    const a12 = alafasyV4(1, '1:2', v4Seg('1:2'))
    const a14 = alafasyV4(1, '1:4', v4Seg('1:4'))
    const plan = planAudio(sel(1, 4, 3, 2, 1), fixtureAyahs(1), [a14, a12], RECITER_A, NO_BASMALA)
    expect(plan.clips.map((c) => c.ayah)).toEqual([2, 4])
    expect(plan.exact).toBe(false)
    expect(plan.playedSelection).toEqual(sel(1, 2, 1, 4, 3))
  })
  it('resolves AYAH_END_WORD and works without the text (audio word counts)', () => {
    const a = alafasyV4(112, '112:1', s1121.audio_files[0].segments)
    const plan = planAudio(sel(112, 1, 1, 1, AYAH_END_WORD), [], [a], RECITER_A, NO_BASMALA)
    expect(cuts(plan)).toEqual([['112001.mp3', 30, 2650]])
    expect(plan.playedSelection).toEqual(sel(112, 1, 1, 1, 4))
    expect(plan.wordLevel).toBe(false)
  })
  it('narrows the played selection when a selected word has no timing at all', () => {
    const a = alafasyV4(112, '112:1', s1121.audio_files[0].segments)
    const gappy = { ...a, words: a.words.filter((w) => w.word !== 4) }
    const plan = planAudio(sel(112, 1, 3, 1, 4), [fixtureAyah('112:1')], [gappy], RECITER_A, NO_BASMALA)
    expect(plan.playedSelection).toEqual(sel(112, 1, 3, 1, 3))
    expect(plan.exact).toBe(false)
  })
  it('returns an empty plan when nothing is playable', () => {
    const plan = planAudio(sel(2, 255, 1, 255, 3), [], [], RECITER_A, NO_BASMALA)
    expect(plan).toEqual({ reciterId: 'alafasy', clips: [], wordLevel: false, exact: false, playedSelection: sel(2, 255, 1, 255, 3) })
  })
})

describe('trimSilence: only whole per-ayah files played without word timings', () => {
  const maher = (k: string) => perAyahAudio(k, everyAyahUrl('MaherAlMuaiqly128kbps', 112, Number(k.split(':')[1])))
  const trims = (plan: AudioPlan) => plan.clips.map((c) => [c.ayah, c.trimSilence])
  it('class C whole ayahs (and their basmala) are trimmed', () => {
    const plan = planAudio(sel(112, 1, 1, 2, AYAH_END_WORD), fixtureAyahs(112), [maher('112:1'), maher('112:2')], RECITER_C, {
      basmala: perAyahAudio('1:1', everyAyahUrl('MaherAlMuaiqly128kbps', 1, 1)),
    })
    expect(trims(plan)).toEqual([
      [0, true],
      [1, true],
      [2, true],
    ])
    // a partial selection widened to the whole file: still trimmed
    expect(trims(planAudio(sel(112, 2, 2, 2, 3), fixtureAyahs(112), [maher('112:2')], RECITER_C, NO_BASMALA))).toEqual([[2, true]])
  })
  it('an ayah of a class A reciter without segments, or with stale timings, plays whole and is trimmed', () => {
    const none = v4Audio('112:2', everyAyahUrl(EA, 112, 2), [])
    expect(trims(planAudio(sel(112, 2, 1, 2, 2), fixtureAyahs(112), [none], RECITER_A, NO_BASMALA))).toEqual([[2, true]])
    const stale = { ...v4Audio('37:152', everyAyahUrl(EA, 37, 152), s37152.audio_files[0].segments, 6766), windowEndMs: 6766 }
    expect(trims(planAudio(sel(37, 152, 2, 152, 3), [fixtureAyah('37:152')], [stale], RECITER_A, NO_BASMALA))).toEqual([[152, true]])
  })
  it('a cut placed by word timings is never trimmed, even when it covers the whole ayah', () => {
    const a = alafasyV4(2, '2:255', v255.verse.audio.segments)
    expect(trims(planAudio(sel(2, 255, 3, 255, 5), [fixtureAyah('2:255')], [a], RECITER_A, NO_BASMALA))).toEqual([[255, false]])
    expect(trims(planAudio(sel(2, 255, 1, 255, AYAH_END_WORD), [fixtureAyah('2:255')], [a], RECITER_A, NO_BASMALA))).toEqual([[255, false]])
    const bas = v4Audio('1:1', everyAyahUrl(EA, 1, 1), v4Seg('1:1'), 6031)
    const b = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [alafasyV4(112, '112:1', s1121.audio_files[0].segments)], RECITER_A, { basmala: bas })
    expect(trims(b)).toEqual([
      [0, false],
      [1, false],
    ])
  })
  it('chapter files are never trimmed (classes B and D: the window is the cut)', () => {
    const f = qdc97.audio_files[0]
    const b = ['1:2', '1:3'].map((k) => qdcAudio(qdcVerse(f, k), f.audio_url)!)
    const est = b.map((a) => ({ ...a, timing: 'none' as const }))
    expect(trims(planAudio(sel(1, 2, 1, 3, AYAH_END_WORD), fixtureAyahs(1), est, RECITER_B, NO_BASMALA))).toEqual([[2, false]])
    const url = 'https://cdn.mp3quran.net/audio/mishary-alafasy/r1/112.mp3'
    const d = planAudio(sel(112, 1, 1, 4, 5), fixtureAyahs(112), mp3q112.map((row) => mp3quranAudio(112, row, url)), RECITER_D, NO_BASMALA)
    expect(d.clips.every((c) => c.fileKind === 'chapter' && !c.trimSilence)).toBe(true)
  })
})

describe("isti'adha (features §2.4: before any recitation, from the reciter's own file)", () => {
  const ist = istiadhaAudio(EA)
  const bas = v4Audio('1:1', everyAyahUrl(EA, 1, 1), v4Seg('1:1'), 6031)
  const a1121 = alafasyV4(112, '112:1', s1121.audio_files[0].segments)
  const head = (plan: AudioPlan) => plan.clips.map((c) => [c.ayah, c.url.split('/').pop()])
  it('is prepended before the basmala, whole and trimmed, outside the played selection', () => {
    const plan = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a1121, ist], RECITER_A, { basmala: bas, istiadha: true })
    expect(plan.clips.map((c) => [c.ayah, c.ayahTo, c.url.split('/').pop(), c.srcStartMs, c.srcEndMs, c.trimSilence, c.fadeInMs, c.fadeOutMs])).toEqual([
      [-1, -1, 'audhubillah.mp3', 0, null, true, 8, 60],
      [0, 0, '001001.mp3', 60, 6320, false, 8, 60],
      [1, 1, '112001.mp3', 30, 2650, false, 8, 60],
    ])
    expect(plan.clips[0]).toMatchObject({ words: [], ayahs: [{ ayah: -1, startMs: 0, endMs: null }], snapToPause: false, extendToSpeechOnset: false })
    expect(plan).toMatchObject({ exact: true, playedSelection: sel(112, 1, 1, 1, 4) })
    // whatever order the list is in
    expect(head(planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [ist, a1121], RECITER_A, { basmala: bas, istiadha: true }))).toEqual(head(plan))
  })
  it('opens a mid-surah selection, Al-Fatiha and At-Tawbah too (where no basmala is added)', () => {
    const mid = planAudio(sel(2, 255, 3, 255, 5), [fixtureAyah('2:255')], [alafasyV4(2, '2:255', v255.verse.audio.segments), ist], RECITER_A, {
      basmala: bas,
      istiadha: true,
    })
    expect(head(mid)).toEqual([
      [-1, 'audhubillah.mp3'],
      [255, '002255.mp3'],
    ])
    const fatiha = planAudio(sel(1, 1, 1, 1, 4), fixtureAyahs(1), [alafasyV4(1, '1:1', v4Seg('1:1')), ist], RECITER_A, { basmala: bas, istiadha: true })
    expect(head(fatiha)).toEqual([
      [-1, 'audhubillah.mp3'],
      [1, '001001.mp3'],
    ])
    const tawbah: AyahAudio = { ...perAyahAudio('112:1', everyAyahUrl(EA, 9, 1)), wordCount: 9 }
    const t = planAudio(sel(9, 1, 1, 1, AYAH_END_WORD), [], [tawbah, ist], RECITER_A, { basmala: bas, istiadha: true })
    expect(t.clips.map((c) => c.ayah)).toEqual([-1, 1])
  })
  it('is left out unless asked for, and needs the -1 source in the list (no fallback voice, 00-gaps D7)', () => {
    const plain = [[0, '001001.mp3'], [1, '112001.mp3']]
    for (const istiadha of [false, undefined, 'yes' as unknown as boolean, 1 as unknown as boolean]) {
      expect(head(planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a1121, ist], RECITER_A, { basmala: bas, istiadha }))).toEqual(plain)
    }
    expect(head(planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a1121], RECITER_A, { basmala: bas, istiadha: true }))).toEqual(plain)
    // nothing playable: no isti'adha on its own
    expect(planAudio(sel(112, 2, 1, 2, 2), [], [ist], RECITER_A, { basmala: bas, istiadha: true }).clips).toEqual([])
  })
  it('is never played as an ayah, and is never merged with the recitation', () => {
    // a selection that starts at ayah -1 or 0 still only plays ayahs ≥ 1
    const s = planAudio(sel(112, -1, 1, 1, 4), [fixtureAyah('112:1')], [a1121, ist], RECITER_A, NO_BASMALA)
    expect(s.clips.map((c) => c.ayah)).toEqual([1])
    // a chapter-file isti'adha right before the ayah in the same file stays its own clip
    const f = qdc7.audio_files[0]
    const a12 = qdcAudio(qdcVerse(f, '1:2'), f.audio_url)!
    const inFile: AyahAudio = { ...a12, ayah: -1, windowStartMs: 0, windowEndMs: a12.windowStartMs, words: [], timing: 'none', wordCount: 5 }
    const plan = planAudio(sel(1, 2, 1, 2, AYAH_END_WORD), fixtureAyahs(1), [a12, inFile], RECITER_B, { basmala: null, istiadha: true })
    expect(plan.clips.map((c) => [c.ayah, c.ayahTo, c.trimSilence])).toEqual([
      [-1, -1, false],
      [2, 2, false],
    ])
  })
  it("is cut by its own word timings when they exist (a timed isti'adha)", () => {
    const timed: AyahAudio = {
      ...ist,
      words: [1, 2, 3, 4, 5].map((word) => ({ word, startMs: 300 + (word - 1) * 1200, endMs: 300 + word * 1200 - 10, estimated: false })),
      timing: 'word',
    }
    const plan = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a1121, timed], RECITER_A, { basmala: null, istiadha: true })
    expect(plan.clips[0]).toMatchObject({ ayah: -1, srcStartMs: 180, srcEndMs: 6290 + 350, trimSilence: false })
    expect(plan.clips[0].words.map((w) => [w.ayah, w.word])).toEqual([1, 2, 3, 4, 5].map((w) => [-1, w]))
    const tl = buildTimeline(plan, asPlanned(plan))
    expect(tl.ayahs.map((a) => a.ayah)).toEqual([-1, 1])
    expect(tl.words.filter((w) => w.ayah === -1)).toHaveLength(5)
  })
})

describe('estimatePlanDurationMs and MAX_VIDEO_MS (00-gaps D3)', () => {
  it('caps video at 300 s', () => {
    expect(MAX_VIDEO_MS).toBe(300_000)
  })
  it('sums the planned clip windows (merged chapter clips count once)', () => {
    const f = qdc7.audio_files[0]
    const audio = ['1:2', '1:3', '1:4'].map((k) => qdcAudio(qdcVerse(f, k), f.audio_url)!)
    expect(estimatePlanDurationMs(planAudio(sel(1, 2, 2, 4, 2), fixtureAyahs(1), audio, RECITER_B, NO_BASMALA))).toBe(17660 - 7025)
    const bas = v4Audio('1:1', everyAyahUrl(EA, 1, 1), v4Seg('1:1'), 6031)
    const plan = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [alafasyV4(112, '112:1', s1121.audio_files[0].segments)], RECITER_A, { basmala: bas })
    // the basmala clip ends at 6320 in the plan; the media clamps it to the 6031 ms file, so this is an upper bound
    expect(estimatePlanDurationMs(plan)).toBe(6320 - 60 + (2650 - 30))
  })
  it('is null when a clip has no known end (whole per-ayah files: classes C, timing none, the isti’adha)', () => {
    const maher = perAyahAudio('112:2', everyAyahUrl('MaherAlMuaiqly128kbps', 112, 2))
    expect(estimatePlanDurationMs(planAudio(sel(112, 2, 1, 2, AYAH_END_WORD), fixtureAyahs(112), [maher], RECITER_C, NO_BASMALA))).toBeNull()
    const a1121 = alafasyV4(112, '112:1', s1121.audio_files[0].segments)
    const withIst = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a1121, istiadhaAudio(EA)], RECITER_A, { basmala: null, istiadha: true })
    expect(estimatePlanDurationMs(withIst)).toBeNull()
  })
  it('is 0 for an empty plan and never throws on malformed input', () => {
    expect(estimatePlanDurationMs(planAudio(sel(2, 255, 1, 255, 3), [], [], RECITER_A, NO_BASMALA))).toBe(0)
    const clip = (srcStartMs: unknown, srcEndMs: unknown) => ({ srcStartMs, srcEndMs }) as unknown as AudioClip
    const plan = (clips: unknown) => ({ clips }) as unknown as AudioPlan
    expect(estimatePlanDurationMs(plan([clip(100, 50)]))).toBe(0) // a reversed window counts as nothing
    expect(estimatePlanDurationMs(plan([clip('100', '600')]))).toBe(500)
    expect(estimatePlanDurationMs(plan([clip(0, 500), clip(Number.NaN, 900)]))).toBeNull()
    expect(estimatePlanDurationMs(plan([clip(0, Infinity)]))).toBeNull()
    expect(estimatePlanDurationMs(plan([null]))).toBeNull()
    expect(estimatePlanDurationMs(plan(undefined))).toBe(0)
    expect(estimatePlanDurationMs(null as unknown as AudioPlan)).toBe(0)
  })
})

// ── fuzz: imperfect timing data never throws and never yields a negative or out-of-clip window ──

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function checkClip(c: AudioClip) {
  expect(Number.isFinite(c.srcStartMs)).toBe(true)
  expect(c.srcStartMs).toBeGreaterThanOrEqual(0)
  if (c.srcEndMs !== null) expect(c.srcEndMs).toBeGreaterThan(c.srcStartMs)
  for (const w of c.words) {
    expect(w.startMs).toBeGreaterThanOrEqual(c.srcStartMs)
    if (c.srcEndMs !== null) expect(w.endMs).toBeLessThanOrEqual(c.srcEndMs)
    expect(w.endMs).toBeGreaterThan(w.startMs)
  }
  // the first ayah entry starts at the clip start, or (finding B) at the ayah's earlier window start when the cut opens it
  expect(c.ayahs[0].startMs).toBeGreaterThanOrEqual(0)
  if (c.extendToSpeechOnset) expect(c.ayahs[0].startMs).toBeLessThanOrEqual(c.srcStartMs)
  else expect(c.ayahs[0].startMs).toBe(c.srcStartMs)
  for (let k = 1; k < c.ayahs.length; k++) {
    expect(c.ayahs[k].startMs).toBeGreaterThanOrEqual(c.ayahs[k - 1].startMs)
    expect(c.ayahs[k].startMs).toBeGreaterThanOrEqual(c.srcStartMs)
  }
  // the media trims silence only off a whole per-ayah file, never off a cut placed by word timings
  expect(typeof c.trimSilence).toBe('boolean')
  if (c.trimSilence) expect([c.fileKind, c.words.length]).toEqual(['per_ayah', 0])
  // the preambles (isti'adha -1, basmala 0) are single clips
  if (c.ayah < 1) expect([c.ayahTo, c.ayahs.length]).toEqual([c.ayah, 1])
}

describe('fuzz (seeded)', () => {
  it('survives 1,500 corrupted timing sets', () => {
    const rnd = mulberry32(42)
    const junk = [Number.NaN, -500, Infinity, '12', '', null, undefined, 1e12]
    const ayahs = fixtureAyahs(1)
    for (let i = 0; i < 1500; i++) {
      const audio: AyahAudio[] = ayahs.map((a) => {
        const chapter = rnd() < 0.5
        const base = chapter ? a.number * 10000 : 0
        const words = a.words.flatMap((w) => {
          const s = base + w.position * 700 + Math.floor(rnd() * 900) - 300
          const out = [{ word: w.position, startMs: s, endMs: s + Math.floor(rnd() * 1200) - 200, estimated: rnd() < 0.2 }]
          if (rnd() < 0.1) out.push({ ...out[0], startMs: s + 3000 }) // repetition
          if (rnd() < 0.1) out[0] = { ...out[0], startMs: junk[Math.floor(rnd() * junk.length)] as number }
          if (rnd() < 0.05) out[0] = { ...out[0], word: Math.floor(rnd() * 12) - 2 }
          return rnd() < 0.08 ? [] : out
        })
        if (rnd() < 0.3) words.sort(() => rnd() - 0.5)
        return {
          ayah: a.number,
          url: chapter ? 'https://x/1.mp3' : `https://x/001${a.number}.mp3`,
          fileKind: chapter ? 'chapter' : 'per_ayah',
          bitrateKbps: chapter ? 128 : null,
          windowStartMs: chapter ? base + (rnd() < 0.1 ? 99999 : 0) : 0,
          windowEndMs: chapter ? (rnd() < 0.1 ? null : base + 9000) : rnd() < 0.2 ? 5000 : null,
          approximateWindow: rnd() < 0.2,
          words,
          wordCount: rnd() < 0.1 ? (junk[Math.floor(rnd() * junk.length)] as number) : a.words.length,
          timing: rnd() < 0.1 ? 'none' : 'word',
        } as AyahAudio
      })
      if (rnd() < 0.3) audio.push({ ...audio[Math.floor(rnd() * audio.length)], ayah: -1, wordCount: rnd() < 0.5 ? 5 : Number.NaN })
      const a1 = 1 + Math.floor(rnd() * 7)
      const a2 = 1 + Math.floor(rnd() * 7)
      const s = sel(1, a1, 1 + Math.floor(rnd() * 9), a2, 1 + Math.floor(rnd() * 9))
      const reciter = rnd() < 0.5 ? RECITER_A : RECITER_D
      const istiadha = rnd() < 0.5
      const plan = planAudio(s, rnd() < 0.2 ? [] : ayahs, audio, reciter, {
        basmala: rnd() < 0.3 ? audio[0] : null,
        istiadha,
        leadPadMs: rnd() < 0.1 ? -5 : undefined,
      })
      plan.clips.forEach(checkClip)
      // order: isti'adha, then the recitation (the basmala is never added in surah 1)
      plan.clips.forEach((c, k) => {
        if (c.ayah === -1) expect([k, istiadha]).toEqual([0, true])
        if (k > 0) expect(c.ayah).toBeGreaterThanOrEqual(1)
      })
      const estimate = estimatePlanDurationMs(plan)
      if (plan.clips.some((c) => c.srcEndMs === null)) expect(estimate).toBeNull()
      else expect(estimate).toBe(plan.clips.reduce((t, c) => t + ((c.srcEndMs as number) - c.srcStartMs), 0))
      const results = plan.clips.map((c) => ({
        srcStartMs: c.srcStartMs + Math.floor(rnd() * 400) - 200,
        durationMs: rnd() < 0.05 ? 0 : Math.max(1, (c.srcEndMs ?? c.srcStartMs + 4000) - c.srcStartMs + Math.floor(rnd() * 400) - 200),
        wordTimingsValid: rnd() > 0.2,
      }))
      const tl = buildTimeline(plan, results)
      expect(Number.isFinite(tl.durationMs)).toBe(true)
    }
  })
})
