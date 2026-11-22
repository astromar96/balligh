import { describe, expect, it } from 'vitest'
import type { AudioPlan, AyahAudio, ClipResult, Reciter, Selection, Timeline } from '../core/types'
import { AYAH_END_WORD, buildTimeline, compareRefs, planAudio } from './index'
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
import s1121 from './__fixtures__/audio/qcom_v4_recitations_7_by_ayah_112_1_segments.json'
import qdc7 from './__fixtures__/audio/qdc_audio_files_7_ch1_segments.json'
import qdc97 from './__fixtures__/audio/qdc_audio_files_97_ch1_segments.json'
import mp3q112 from './__fixtures__/audio/mp3quran_ayat_timing_s112_r123.json'
import mp3q1 from './__fixtures__/audio/mp3quran_ayat_timing_s1_r5.json'

const sel = (surah: number, a1: number, w1: number, a2: number, w2: number): Selection => ({
  surah,
  start: { ayah: a1, word: w1 },
  end: { ayah: a2, word: w2 },
})
const asPlanned = (plan: AudioPlan, perAyahLength = 3000): ClipResult[] =>
  plan.clips.map((c) => ({ srcStartMs: c.srcStartMs, durationMs: (c.srcEndMs ?? c.srcStartMs + perAyahLength) - c.srcStartMs, wordTimingsValid: true }))

const v4 = (key: string) =>
  v4Audio(key, everyAyahUrl('Alafasy_128kbps', 1, Number(key.split(':')[1])), ch1v4.audio_files.find((f) => f.verse_key === key)!.segments)
const qdc = (file: { audio_url: string; verse_timings: QdcVerseTiming[] }, key: string) =>
  qdcAudio(file.verse_timings.find((v) => v.verse_key === key)!, file.audio_url)!
const FATIHA = ['1:1', '1:2', '1:3', '1:4', '1:5', '1:6', '1:7']

describe('buildTimeline', () => {
  const plan12 = planAudio(sel(1, 2, 3, 3, 1), fixtureAyahs(1), [v4('1:2'), v4('1:3')], RECITER_A, { basmala: null })

  it('shifts file time to output time per clip and tiles the ayahs', () => {
    const tl = buildTimeline(plan12, asPlanned(plan12))
    expect(tl).toEqual({
      durationMs: 4870,
      ayahs: [
        { ayah: 2, startMs: 0, endMs: 3680 },
        { ayah: 3, startMs: 3680, endMs: 4870 },
      ],
      words: [
        { ayah: 2, word: 3, startMs: 0, endMs: 650 },
        { ayah: 2, word: 4, startMs: 660, endMs: 3330 },
        { ayah: 3, word: 1, startMs: 3680, endMs: 4870 },
      ],
    })
  })
  it('follows the decoder: a snapped start shifts the words, a shorter file clips them', () => {
    const tl = buildTimeline(plan12, [
      { srcStartMs: 1760, durationMs: 3000, wordTimingsValid: true }, // 50 ms earlier, cut short at 4760
      { srcStartMs: 40, durationMs: 1190, wordTimingsValid: true },
    ])
    expect(tl.durationMs).toBe(4190)
    expect(tl.words).toEqual([
      { ayah: 2, word: 3, startMs: 50, endMs: 700 },
      { ayah: 2, word: 4, startMs: 710, endMs: 3000 },
      { ayah: 3, word: 1, startMs: 3000, endMs: 4190 },
    ])
  })
  it('drops the words of a clip whose word timings were contradicted by the decoded file (finding A)', () => {
    const tl = buildTimeline(plan12, [
      { srcStartMs: 0, durationMs: 5534, wordTimingsValid: false },
      { srcStartMs: 40, durationMs: 1190, wordTimingsValid: true },
    ])
    expect(tl.words.map((w) => w.ayah)).toEqual([3])
    expect(tl.ayahs).toEqual([
      { ayah: 2, startMs: 0, endMs: 5534 },
      { ayah: 3, startMs: 5534, endMs: 6724 },
    ])
  })
  it('splits an invalid merged clip in proportion to the planned ayah lengths', () => {
    const f = qdc7.audio_files[0]
    const plan = planAudio(sel(1, 2, 1, 3, 2), fixtureAyahs(1), [qdc(f, '1:2'), qdc(f, '1:3')], RECITER_B, { basmala: null })
    expect(plan.clips).toHaveLength(1)
    const [c] = plan.clips // [6025, 16300], ayah 3 from 11615
    const tl = buildTimeline(plan, [{ srcStartMs: 0, durationMs: 1000, wordTimingsValid: false }])
    expect(tl.words).toEqual([])
    const share = (11615 - c.srcStartMs) / (16300 - c.srcStartMs)
    expect(tl.ayahs.map((a) => a.ayah)).toEqual([2, 3])
    expect(tl.ayahs[0].startMs).toBe(0)
    expect(tl.ayahs[0].endMs).toBeCloseTo(1000 * share, 9)
    expect(tl.ayahs[1].startMs).toBe(tl.ayahs[0].endMs)
    expect(tl.ayahs[1].endMs).toBe(1000)
  })
  it('splits from the clip start when the first ayah entry starts at its earlier window (finding B)', () => {
    const f = qdc97.audio_files[0]
    const plan = planAudio(sel(1, 3, 1, 4, 3), fixtureAyahs(1), [qdc(f, '1:3'), qdc(f, '1:4')], RECITER_B, { basmala: null })
    expect(plan.clips).toHaveLength(1)
    const [c] = plan.clips
    expect([c.ayahs[0].startMs, c.srcStartMs]).toEqual([9610, 9790]) // Yasser 1:3: window 9610, cut 9790
    const tl = buildTimeline(plan, [{ srcStartMs: 0, durationMs: 1000, wordTimingsValid: false }])
    const share = (c.ayahs[1].startMs - c.srcStartMs) / ((c.srcEndMs as number) - c.srcStartMs)
    expect(tl.ayahs.map((a) => a.ayah)).toEqual([3, 4])
    expect(tl.ayahs[0].endMs).toBeCloseTo(1000 * share, 9)
    expect(tl.ayahs[1].endMs).toBe(1000)
  })
  it('gives the first word the speech found before the first segment (extendToSpeechOnset, finding B)', () => {
    const plan = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [v4Audio('112:1', 'u', s1121.audio_files[0].segments)], RECITER_A, {
      basmala: null,
    })
    expect(plan.clips[0].extendToSpeechOnset).toBe(true)
    const tl = buildTimeline(plan, [{ srcStartMs: 0, durationMs: 2650, wordTimingsValid: true }])
    expect(tl.words[0]).toEqual({ ayah: 1, word: 1, startMs: 0, endMs: 390 })
    expect(tl.words[1]).toEqual({ ayah: 1, word: 2, startMs: 400, endMs: 790 })
  })
  it("times the isti'adha as ayah -1 and the basmala as ayah 0, before the recitation", () => {
    const EA = 'Alafasy_128kbps'
    const bas = v4Audio('1:1', everyAyahUrl(EA, 1, 1), ch1v4.audio_files.find((f) => f.verse_key === '1:1')!.segments, 6031)
    const a1121 = v4Audio('112:1', everyAyahUrl(EA, 112, 1), s1121.audio_files[0].segments)
    const plan = planAudio(sel(112, 1, 1, 1, 4), [fixtureAyah('112:1')], [a1121, istiadhaAudio(EA)], RECITER_A, { basmala: bas, istiadha: true })
    expect(plan.clips.map((c) => c.ayah)).toEqual([-1, 0, 1])
    // what the media reports: the isti'adha file decoded to 6746 ms and trimmed by 300 ms of leading silence
    const results: ClipResult[] = [
      { srcStartMs: 300, durationMs: 6200, wordTimingsValid: true },
      { srcStartMs: 60, durationMs: 6031 - 60, wordTimingsValid: true },
      { srcStartMs: 30, durationMs: 2650 - 30, wordTimingsValid: true },
    ]
    const tl = buildTimeline(plan, results)
    expect(tl.ayahs).toEqual([
      { ayah: -1, startMs: 0, endMs: 6200 },
      { ayah: 0, startMs: 6200, endMs: 6200 + 5971 },
      { ayah: 1, startMs: 6200 + 5971, endMs: 6200 + 5971 + 2620 },
    ])
    expect(tl.durationMs).toBe(6200 + 5971 + 2620)
    // no word highlight in the untimed isti'adha; the basmala and the ayah keep theirs, in order
    expect(tl.words.some((w) => w.ayah === -1)).toBe(false)
    expect(tl.words.map((w) => w.ayah)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    expect(tl.words[0].startMs).toBeGreaterThanOrEqual(6200)
  })
  it('uses planned lengths when results are missing and ignores extra results', () => {
    const tl = buildTimeline(plan12, [])
    expect(tl.durationMs).toBe(5490 - 1810 + (1230 - 40))
    expect(buildTimeline(plan12, [...asPlanned(plan12), { srcStartMs: 0, durationMs: 99999, wordTimingsValid: true }]).durationMs).toBe(4870)
    expect(buildTimeline({ ...plan12, clips: [] }, [])).toEqual({ durationMs: 0, ayahs: [], words: [] })
  })
  it('removes overlaps and zero-length words, keeping every onset', () => {
    const plan: AudioPlan = {
      ...plan12,
      clips: [
        {
          ...plan12.clips[0],
          srcStartMs: 0,
          srcEndMs: 1000,
          words: [
            { ayah: 2, word: 1, startMs: 0, endMs: 600 },
            { ayah: 2, word: 2, startMs: 500, endMs: 900 },
            { ayah: 2, word: 3, startMs: 500, endMs: 950 },
            { ayah: 2, word: 4, startMs: 990, endMs: 990 },
          ],
          ayahs: [{ ayah: 2, startMs: 0, endMs: null }],
        },
      ],
    }
    const tl = buildTimeline(plan, [{ srcStartMs: 0, durationMs: 1000, wordTimingsValid: true }])
    expect(tl.words).toEqual([
      { ayah: 2, word: 1, startMs: 0, endMs: 500 },
      { ayah: 2, word: 3, startMs: 500, endMs: 950 },
    ])
  })
})

// ── property: random selections over real timing data of every class (seeded PRNG, no Math.random) ──

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

interface Scenario {
  name: string
  surah: number
  reciter: Reciter
  audio: AyahAudio[]
  basmala: AyahAudio | null
  /** true when the data has exact word timings for every word (classes A/B on clean payloads) */
  wordExact: boolean
}

const fqdc7 = qdc7.audio_files[0]
const fqdc97 = qdc97.audio_files[0]
const SCENARIOS: Scenario[] = [
  { name: 'A · Alafasy v4 per-ayah, Al-Fatiha', surah: 1, reciter: RECITER_A, audio: FATIHA.map(v4), basmala: null, wordExact: true },
  { name: 'B · Alafasy QDC chapter, Al-Fatiha', surah: 1, reciter: RECITER_B, audio: FATIHA.map((k) => qdc(fqdc7, k)), basmala: null, wordExact: true },
  { name: 'B · Yasser QDC chapter, Al-Fatiha', surah: 1, reciter: RECITER_B, audio: FATIHA.map((k) => qdc(fqdc97, k)), basmala: null, wordExact: true },
  {
    name: 'C · per-ayah without timings, Al-Ikhlas + basmala',
    surah: 112,
    reciter: RECITER_C,
    audio: [1, 2, 3, 4].map((n) => perAyahAudio(`112:${n}`, everyAyahUrl('MaherAlMuaiqly128kbps', 112, n))),
    basmala: perAyahAudio('1:1', everyAyahUrl('MaherAlMuaiqly128kbps', 1, 1)),
    wordExact: false,
  },
  {
    name: 'D · mp3quran approximate windows, Al-Ikhlas + basmala',
    surah: 112,
    reciter: RECITER_D,
    audio: mp3q112.map((r) => mp3quranAudio(112, r, 'https://cdn.mp3quran.net/audio/mishary-alafasy/r1/112.mp3')),
    basmala: mp3quranAudio(1, mp3q1.find((r) => r.ayah === 1)!, 'https://cdn.mp3quran.net/audio/ahmad-ajmi/r1/001.mp3'),
    wordExact: false,
  },
  {
    name: 'A · Alafasy 112:1 + basmala',
    surah: 112,
    reciter: RECITER_A,
    audio: [v4Audio('112:1', everyAyahUrl('Alafasy_128kbps', 112, 1), s1121.audio_files[0].segments)],
    basmala: v4('1:1'),
    wordExact: true,
  },
]

function randomSelection(rnd: () => number, surah: number, maxAyah: number): Selection {
  const ayahs = fixtureAyahs(surah).filter((a) => a.number <= maxAyah)
  const a1 = ayahs[Math.floor(rnd() * ayahs.length)]
  const a2 = ayahs[Math.floor(rnd() * ayahs.length)]
  const w1 = 1 + Math.floor(rnd() * a1.words.length)
  const w2 = rnd() < 0.1 ? AYAH_END_WORD : 1 + Math.floor(rnd() * a2.words.length)
  return sel(surah, a1.number, w1, a2.number, w2) // either order: planAudio normalises
}

function checkTimeline(tl: Timeline, results: ClipResult[]) {
  const total = results.reduce((n, r) => n + Math.max(0, r.durationMs), 0)
  expect(tl.durationMs).toBeCloseTo(total, 6)
  for (let i = 0; i < tl.words.length; i++) {
    const w = tl.words[i]
    expect(w.endMs).toBeGreaterThan(w.startMs)
    expect(w.startMs).toBeGreaterThanOrEqual(0)
    expect(w.endMs).toBeLessThanOrEqual(tl.durationMs + 1e-9)
    if (i > 0) expect(w.startMs).toBeGreaterThanOrEqual(tl.words[i - 1].endMs) // monotonic, no overlap
  }
  // ayah spans tile [0, duration] exactly
  if (total > 0) {
    expect(tl.ayahs[0].startMs).toBe(0)
    expect(tl.ayahs[tl.ayahs.length - 1].endMs).toBeCloseTo(tl.durationMs, 6)
  }
  for (let i = 0; i < tl.ayahs.length; i++) {
    expect(tl.ayahs[i].endMs).toBeGreaterThan(tl.ayahs[i].startMs)
    if (i > 0) expect(tl.ayahs[i].startMs).toBe(tl.ayahs[i - 1].endMs)
  }
}

describe('planAudio + buildTimeline (property, seeded)', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name}: 400 random selections`, () => {
      const rnd = mulberry32(0x5eed + sc.name.length)
      const ayahs = fixtureAyahs(sc.surah)
      const maxAyah = Math.max(...sc.audio.map((a) => a.ayah))
      for (let i = 0; i < 400; i++) {
        const s = randomSelection(rnd, sc.surah, maxAyah)
        const plan = planAudio(s, ayahs, sc.audio, sc.reciter, { basmala: sc.basmala })
        const ps = plan.playedSelection
        const count = (n: number) => ayahs.find((a) => a.number === n)!.words.length
        const clampRef = (r: { ayah: number; word: number }) => ({ ayah: r.ayah, word: Math.min(r.word, count(r.ayah)) })
        const [lo, hi] = (compareRefs(s.start, s.end) <= 0 ? [s.start, s.end] : [s.end, s.start]).map(clampRef)
        expect(plan.clips.length).toBeGreaterThan(0)
        // what is heard covers the selection; it equals it whenever exact word timings exist
        expect(compareRefs(ps.start, lo)).toBeLessThanOrEqual(0)
        expect(compareRefs(ps.end, hi)).toBeGreaterThanOrEqual(0)
        if (sc.wordExact) {
          expect(ps).toEqual({ surah: sc.surah, start: lo, end: hi })
          expect(plan.exact).toBe(true)
        } else {
          expect(ps.start.word).toBe(1)
          expect(plan.wordLevel).toBe(false)
        }
        // the basmala opens the clip exactly when the played selection starts the surah
        const opens = ps.start.ayah === 1 && ps.start.word === 1 && sc.surah !== 1 && sc.basmala !== null
        expect(plan.clips[0].ayah === 0).toBe(opens)

        // decoder results: as planned, or moved by pause-snapping / onset extension, sometimes invalid
        const exactRun = rnd() < 0.4
        const results: ClipResult[] = plan.clips.map((c) => {
          const planned = (c.srcEndMs ?? c.srcStartMs + 2500 + Math.floor(rnd() * 4000)) - c.srcStartMs
          if (exactRun) return { srcStartMs: c.srcStartMs, durationMs: planned, wordTimingsValid: true }
          const shift = Math.floor(rnd() * 700) - 500
          return {
            srcStartMs: Math.max(0, c.srcStartMs + shift),
            durationMs: Math.max(50, planned - shift + Math.floor(rnd() * 600) - 300),
            wordTimingsValid: rnd() > 0.15,
          }
        })
        const tl = buildTimeline(plan, results)
        checkTimeline(tl, results)
        const inPlayed = (a: number, w: number) => compareRefs({ ayah: a, word: w }, ps.start) >= 0 && compareRefs({ ayah: a, word: w }, ps.end) <= 0
        for (const w of tl.words) expect(w.ayah === 0 || inPlayed(w.ayah, w.word)).toBe(true)
        for (const a of tl.ayahs) expect(a.ayah === 0 || (a.ayah >= ps.start.ayah && a.ayah <= ps.end.ayah)).toBe(true)

        if (exactRun && sc.wordExact) {
          // no selected word is lost, and first occurrences follow reading order
          const seen = new Map<string, number>()
          tl.words.forEach((w, k) => {
            if (w.ayah !== 0 && !seen.has(`${w.ayah}:${w.word}`)) seen.set(`${w.ayah}:${w.word}`, k)
          })
          const expected: string[] = []
          for (const a of ayahs) {
            for (const w of a.words) if (inPlayed(a.number, w.position)) expected.push(`${a.number}:${w.position}`)
          }
          expect([...seen.keys()]).toEqual(expected)
        }
      }
    })
  }
})
