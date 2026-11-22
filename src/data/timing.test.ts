// Timing adapters on real payloads: Quran.com v4 segments (class A), QDC verse timings (class B), mp3quran (class D).
import mq30s112 from './__fixtures__/mp3quran-timing-r30-s112.json'
import qcSeg1_10_1 from './__fixtures__/qc-v4-seg-1-10_1.json'
import qcSeg3ch1 from './__fixtures__/qc-v4-seg-3-ch1.json'
import qcSeg7_37_130 from './__fixtures__/qc-v4-seg-7-37_130.json'
import qcSeg7_37_152 from './__fixtures__/qc-v4-seg-7-37_152.json'
import qcSeg7ch1 from './__fixtures__/qc-v4-seg-7-ch1.json'
import qcSeg8_13_1 from './__fixtures__/qc-v4-seg-8-13_1.json'
import qcSeg8_2_255 from './__fixtures__/qc-v4-seg-8-2_255.json'
import qc1 from './__fixtures__/qc-verses-1.json'
import special from './__fixtures__/qc-verses-special.json'
import qdc97ch1 from './__fixtures__/qdc-97-ch1.json'
import qdc173ch1 from './__fixtures__/qdc-173-ch1-zero-length.json'
import qdc8ch36 from './__fixtures__/qdc-8-ch36-unsorted.json'
import khalifa from './__fixtures__/qdc-161-sample.json'
import anomalies from './__fixtures__/qdc-anomalies.json'
import { readJsonIfPresent, repoFile } from './__fixtures__/load'
import type { AyahAudio, WordTime } from '../core/types'
import {
  checkQdcSegments,
  fillMissing,
  fromAyahWindow,
  fromQdcVerseTiming,
  fromV4Segments,
  indexQdcTimings,
  parseMp3quranTiming,
  perAyahWithoutWords,
  spread,
  wordWeight,
  type QdcVerseTiming,
} from './timing'

type Verse = { verse_key: string; words: { char_type_name: string; text_uthmani: string }[] }
const textsOf = (v: Verse) => v.words.filter((w) => w.char_type_name === 'word').map((w) => w.text_uthmani)
const texts = (key: string) => textsOf((special as unknown as Record<string, Verse>)[key])
const fatiha = (ayah: number) => textsOf(qc1.verses[ayah - 1])
const segsOf = (json: { audio_files: { verse_key: string; segments: unknown }[] }, key: string) =>
  json.audio_files.find((f) => f.verse_key === key)?.segments

/** Every ayah's words 1..n appear (first occurrences in order) and times never run backwards. */
function expectWellFormed(a: AyahAudio) {
  const firsts: number[] = []
  for (const w of a.words) if (!firsts.includes(w.word)) firsts.push(w.word)
  expect(firsts).toEqual(Array.from({ length: a.wordCount }, (_, i) => i + 1))
  for (let i = 1; i < a.words.length; i++) expect(a.words[i].startMs).toBeGreaterThanOrEqual(a.words[i - 1].startMs)
  for (const w of a.words) expect(w.endMs).toBeGreaterThanOrEqual(w.startMs)
}

describe('fromV4Segments (class A)', () => {
  const v4 = (key: string, segments: unknown, wordTexts: string[], offsetMs = 0) =>
    fromV4Segments({ ayah: Number(key.split(':')[1]), verseKey: key, url: 'https://everyayah.com/x.mp3', segments, wordTexts, offsetMs })

  it('maps [w0, w1Excl, start, end] to measured words (Alafasy 1:1) and adds the per-reciter offset', () => {
    const a = v4('1:1', segsOf(qcSeg7ch1, '1:1'), fatiha(1))
    expect(a).toMatchObject({ fileKind: 'per_ayah', bitrateKbps: null, windowStartMs: 0, windowEndMs: null, wordCount: 4, timing: 'word' })
    expect(a.words).toEqual([
      { word: 1, startMs: 60, endMs: 610, estimated: false },
      { word: 2, startMs: 620, endMs: 1310, estimated: false },
      { word: 3, startMs: 1320, endMs: 2450, estimated: false },
      { word: 4, startMs: 2460, endMs: 5970, estimated: false },
    ])
    expect(v4('1:1', segsOf(qcSeg7ch1, '1:1'), fatiha(1), 26).words[0]).toEqual({ word: 1, startMs: 86, endMs: 636, estimated: false })
  })

  it('coerces string numbers (Sudais) and spreads a multi-word segment by text weight', () => {
    const a = v4('1:1', segsOf(qcSeg3ch1, '1:1'), fatiha(1))
    expect(a.timing).toBe('partly-estimated')
    expect(a.words[0]).toEqual({ word: 1, startMs: 380, endMs: 730, estimated: false })
    expect(a.words.slice(1).every((w) => w.estimated && typeof w.startMs === 'number')).toBe(true)
    expect(a.words[1].startMs).toBe(740)
    expect(a.words[3].endMs).toBe(3082)
    // الرحمن weighs more than الله: its share of the segment is longer
    expect(a.words[2].endMs - a.words[2].startMs).toBeGreaterThan(a.words[1].endMs - a.words[1].startMs)
    expectWellFormed(a)
  })

  it('handles multi-word segments in a long ayah (Minshawi Mujawwad 2:255)', () => {
    const a = v4('2:255', segsOf(qcSeg8_2_255, '2:255'), texts('2:255'))
    expect(a.wordCount).toBe(50)
    expect(a.words.filter((w) => w.estimated).map((w) => w.word)).toEqual([1, 2, 3])
    expectWellFormed(a)
  })

  it("repairs the muqatta'at index jump when the shift fits the word count (Abdul Basit Mujawwad 10:1)", () => {
    const a = v4('10:1', segsOf(qcSeg1_10_1, '10:1'), texts('10:1'))
    expect(a.timing).toBe('word')
    expect(a.words.map((w) => [w.word, w.startMs])).toEqual([
      [1, 880],
      [2, 12850],
      [3, 14660],
      [4, 16140],
      [5, 18250],
    ])
  })

  it('falls back to the whole ayah when the jump cannot be repaired (Minshawi Mujawwad 13:1): no guessed labels', () => {
    const a = v4('13:1', segsOf(qcSeg8_13_1, '13:1'), texts('13:1'))
    expect(a).toMatchObject({ words: [], timing: 'none', wordCount: 15, fileKind: 'per_ayah', perAyahUrl: null })
  })

  it('falls back to the whole ayah when more than half of the words have no segment', () => {
    const fiveWords = ['قل', 'هو', 'الله', 'احد', 'صمد']
    expect(v4('112:1', [[0, 1, 0, 500], [4, 5, 2000, 2500]], fiveWords).timing).toBe('none') // 3 of 5 untimed
    const twoMissing = v4('112:1', [[0, 1, 0, 500], [2, 3, 900, 1200], [4, 5, 2000, 2500]], fiveWords)
    expect(twoMissing.timing).toBe('partly-estimated')
    expectWellFormed(twoMissing)
    // a multi-word segment times its words (as a group): not missing
    expect(v4('112:1', [[0, 5, 0, 2500]], fiveWords).timing).toBe('partly-estimated')
  })

  it('merges the two timing halves of 37:130 «إِلْ يَاسِينَ» into word 3', () => {
    const a = v4('37:130', segsOf(qcSeg7_37_130, '37:130'), texts('37:130'))
    expect(a.timing).toBe('word')
    expect(a.words).toEqual([
      { word: 1, startMs: 60, endMs: 1020, estimated: false },
      { word: 2, startMs: 1030, endMs: 3080, estimated: false },
      { word: 3, startMs: 3090, endMs: 6290, estimated: false },
    ])
    // a pause between the halves does not make them a repetition
    const gap = v4('37:130', [[0, 1, 0, 900], [1, 2, 910, 1500], [2, 3, 1510, 1800], [3, 4, 2400, 3000]], texts('37:130'))
    expect(gap.words.map((w) => [w.word, w.startMs, w.endMs])).toEqual([
      [1, 0, 900],
      [2, 910, 1500],
      [3, 1510, 3000],
    ])
  })

  it('passes stale timings through unchanged (Alafasy 37:152 — media checks them against the decoded file)', () => {
    const a = v4('37:152', segsOf(qcSeg7_37_152, '37:152'), texts('37:152'))
    expect(a.timing).toBe('word')
    expect(a.words.at(-1)?.endMs).toBe(19320)
  })

  it('never throws on junk: malformed tuples are dropped, nothing usable → timing none', () => {
    const junk = [[0, 1, 'x', 5], [1], [2, 1, 0, 5], null, 'a', [0, 1, -5, 3]]
    expect(v4('1:1', junk, fatiha(1))).toMatchObject({ words: [], timing: 'none', wordCount: 4 })
    expect(v4('1:1', undefined, fatiha(1)).timing).toBe('none')
    const partial = v4('1:1', [[0, 1, 100, 500], [3, 4, 1500, 2000]], fatiha(1))
    expect(partial.timing).toBe('partly-estimated')
    expect(partial.words.map((w) => [w.word, w.estimated])).toEqual([
      [1, false],
      [2, true],
      [3, true],
      [4, false],
    ])
    expectWellFormed(partial)
  })
})

describe('fromQdcVerseTiming (class B)', () => {
  const qdc = (vt: QdcVerseTiming, wordTexts: string[], url = 'https://download.quranicaudio.com/x.mp3') =>
    fromQdcVerseTiming({ ayah: Number(vt.verse_key.split(':')[1]), url, bitrateKbps: 128, verseTiming: vt, wordTexts })
  const anomaly = (prefix: string, key: string) => {
    const entry = Object.entries(anomalies).find(([k]) => k.startsWith(prefix))?.[1] as { verse_timings: QdcVerseTiming[] }
    return entry.verse_timings.find((v) => v.verse_key === key) as QdcVerseTiming
  }

  it('reads chapter-time word windows and the verse window (Dosari 1:1)', () => {
    const vt = indexQdcTimings(qdc97ch1.audio_files[0].verse_timings).get('1:1') as QdcVerseTiming
    const a = qdc(vt, fatiha(1)) as AyahAudio
    expect(a).toMatchObject({ fileKind: 'chapter', bitrateKbps: 128, windowStartMs: 280, windowEndMs: 3080, approximateWindow: false, timing: 'word' })
    expect(a.words.map((w) => [w.word, w.startMs, w.endMs])).toEqual([
      [1, 180, 780],
      [2, 800, 1430],
      [3, 1430, 2330],
      [4, 2330, 3080],
    ])
  })

  it('indexes unsorted verse_timings by verse_key (Minshawi Mujawwad ch 36)', () => {
    const idx = indexQdcTimings(qdc8ch36.audio_files[0].verse_timings)
    expect(qdc8ch36.audio_files[0].verse_timings[0].verse_key).toBe('36:15')
    expect([...idx.keys()]).toEqual(['36:15', '36:16', '36:17', '36:18', '36:19'])
    expect(idx.get('36:17')?.timestamp_from).toBe(322130)
    expect(indexQdcTimings('nope').size).toBe(0)
  })

  it('keeps reciter repetitions (Alafasy 13:4 repeats words 10–12 and 16–17)', () => {
    const a = qdc(anomaly('repetition_alafasy_13_4', '13:4'), texts('13:4')) as AyahAudio
    expect(a.timing).toBe('word')
    expect(a.words.filter((w) => w.word === 10)).toHaveLength(2)
    expect(a.words.filter((w) => w.word === 17)).toHaveLength(2)
    expectWellFormed(a)
  })

  it('cuts and highlights a verse with corrupt word labels as a whole ayah (Tunaiji 13:1, D8)', () => {
    const a = qdc(anomaly('corrupt_tunaiji', '13:1'), texts('13:1')) as AyahAudio
    expect(a).toMatchObject({ fileKind: 'chapter', windowStartMs: 0, windowEndMs: 35210, words: [], timing: 'none', wordCount: 15 })
  })

  it('drops the malformed [101612] tuple (Tunaiji 13:4) and merges the split 37:130 word (Dosari)', () => {
    const t = qdc(anomaly('trailing_malformed', '13:4'), texts('13:4')) as AyahAudio
    expect(t.timing).toBe('word')
    expectWellFormed(t)
    const s = qdc(anomaly('split_word_37_130', '37:130'), texts('37:130')) as AyahAudio
    expect(s.words.map((w) => [w.word, w.startMs, w.endMs])).toEqual([
      [1, 756900, 757830],
      [2, 757830, 759190],
      [3, 759190, 761230],
    ])
    // Khalid al-Jalil (QDC 170) pauses 100 ms between the halves: still one word
    const jalil = qdc({ verse_key: '37:130', timestamp_from: 665589, timestamp_to: 668722, segments: [[1, 665589, 666610], [2, 666630, 667340], [3, 667340, 667611], [4, 667711, 668672]] }, texts('37:130')) as AyahAudio
    expect(jalil.words.map((w) => [w.word, w.startMs, w.endMs])).toEqual([
      [1, 665589, 666610],
      [2, 666630, 667340],
      [3, 667340, 668672],
    ])
  })

  it('returns null for a verse that is not in the file (zero-length 1:1 of recitation 173)', () => {
    const vt = indexQdcTimings(qdc173ch1.audio_files[0].verse_timings).get('1:1') as QdcVerseTiming
    expect(qdc(vt, fatiha(1))).toBeNull()
    expect(qdc({ verse_key: '1:2', timestamp_from: 'x', timestamp_to: 5 }, fatiha(2))).toBeNull()
  })

  it('passes the per-ayah fallback file through, null by default', () => {
    const vt = indexQdcTimings(qdc97ch1.audio_files[0].verse_timings).get('1:2') as QdcVerseTiming
    const url = 'https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/001002.mp3'
    expect(fromQdcVerseTiming({ ayah: 2, url: 'https://x/1.mp3', bitrateKbps: 128, verseTiming: vt, wordTexts: fatiha(2), perAyahUrl: url })?.perAyahUrl).toBe(url)
    expect(qdc(vt, fatiha(2))?.perAyahUrl).toBeNull()
  })

  it('rounds float milliseconds and fills words without segments', () => {
    const a = qdc({ verse_key: '1:2', timestamp_from: 1000.4, timestamp_to: 5000, segments: [[1, 1000.6, 2000.2], [4, 4000, 5000]] }, fatiha(2)) as AyahAudio
    expect(a.words[0]).toEqual({ word: 1, startMs: 1001, endMs: 2000, estimated: false })
    expect(a.words.map((w) => [w.word, w.estimated])).toEqual([
      [1, false],
      [2, true],
      [3, true],
      [4, false],
    ])
    expect(a.windowStartMs).toBe(1000)
  })
})

describe('class-B validation (research/00-gaps.md §2.6, D8) on Khalifa al-Tunaiji (QDC 161)', () => {
  type Chapter = { audio_files: { audio_url: string; verse_timings: QdcVerseTiming[] }[] }
  const sample = khalifa as unknown as Record<string, unknown>
  const wordCounts = sample._word_counts as Record<string, number>
  const verses = Object.entries(sample)
    .filter(([k]) => k !== '_word_counts')
    .map(([, ch]) => (ch as Chapter).audio_files[0])
    .flatMap((f) => f.verse_timings.map((vt) => ({ vt, url: f.audio_url })))
  const n = (key: string) => wordCounts[key]
  const wordTexts = (key: string) => Array.from({ length: n(key) }, () => 'كلمة')
  const build = (key: string) => {
    const v = verses.find((x) => x.vt.verse_key === key)!
    return fromQdcVerseTiming({ ayah: Number(key.split(':')[1]), url: v.url, bitrateKbps: 64, verseTiming: v.vt, wordTexts: wordTexts(key) }) as AyahAudio
  }
  /** the segments as the adapter cleans them, before the 37:130 remap (what the scan validated) */
  const raw = (vt: QdcVerseTiming) =>
    (vt.segments as unknown[][]).filter((s) => Array.isArray(s) && s.length === 3).map((s) => s.map((x) => Math.round(Number(x))))

  it('classifies every sampled verse exactly as the whole-Quran scan did (classb-scan.json)', async () => {
    type Scan = { reciters: Record<string, { problems: { verse: string; status: string }[] }> }
    const scan = await readJsonIfPresent<Scan>(repoFile('research/fixtures/gaps/classb-scan.json'))
    const got = Object.fromEntries(verses.map(({ vt }) => [vt.verse_key, checkQdcSegments(raw(vt), n(vt.verse_key)).status]))
    expect(got).toEqual({
      '13:3': 'ok',
      '13:4': 'ok_with_repeats',
      '13:7': 'missing_words',
      '13:11': 'missing_words',
      '13:13': 'invalid_order',
      '25:2': 'ok_with_repeats',
      '25:15': 'missing_words',
      '25:16': 'missing_words',
      '25:17': 'ok',
      '30:9': 'ok_with_repeats',
      '30:24': 'ok',
      '30:25': 'invalid_order',
      '30:38': 'missing_words',
      '30:53': 'missing_words',
      '37:130': 'overflow',
    })
    if (!scan) return
    // the scan lists every problem verse of these chapters (its 400-entry cap is reached only at 58:4)
    const problems = new Map(scan.reciters['161'].problems.map((p) => [p.verse, p.status]))
    for (const [key, status] of Object.entries(got)) expect(problems.get(key) ?? 'ok|ok_with_repeats', key).toContain(status)
  })

  it('ayah level for corrupt labels; interpolation when at most half the words are missing; measured words otherwise', () => {
    for (const key of ['13:13', '30:25']) expect(build(key), key).toMatchObject({ words: [], timing: 'none', approximateWindow: false })
    const corrupt = build('30:25')
    expect(corrupt.windowEndMs! > corrupt.windowStartMs).toBe(true) // the window still cuts the verse
    for (const key of ['13:7', '13:11', '25:15', '25:16', '30:53']) {
      const a = build(key)
      expect(a.timing, key).toBe('partly-estimated')
      expectWellFormed(a)
      expect(a.words.some((w) => !w.estimated)).toBe(true)
    }
    // 25:16 misses exactly half (5 of 10): interpolated; 30:38 misses 9 of 16: ayah level
    expect(checkQdcSegments(raw(verses.find((v) => v.vt.verse_key === '25:16')!.vt), 10).missing).toHaveLength(5)
    expect(build('30:38')).toMatchObject({ words: [], timing: 'none' })
    for (const key of ['13:3', '25:17', '30:24']) {
      const a = build(key)
      expect(a.timing, key).toBe('word')
      expectWellFormed(a)
    }
    for (const key of ['13:4', '25:2', '30:9']) {
      const a = build(key)
      expect(a.timing, key).toBe('word')
      expect(a.words.length, key).toBeGreaterThan(a.wordCount) // the repetition is kept
      expectWellFormed(a)
    }
    // 37:130: QDC times «إِلْ يَاسِينَ» as two words; after the remap it is valid
    const split = build('37:130')
    expect(split.timing).toBe('word')
    expect(split.words.map((w) => w.word)).toEqual([1, 2, 3])
  })

  it('checkQdcSegments on hand-made cases', () => {
    expect(checkQdcSegments([], 3).status).toBe('no_segments')
    expect(checkQdcSegments([[1, 0, 10], [4, 10, 20]], 3).status).toBe('overflow')
    expect(checkQdcSegments([[0, 0, 10], [1, 10, 20]], 3).status).toBe('invalid_order')
    expect(checkQdcSegments([[1, 10, 20], [2, 5, 30]], 2).status).toBe('invalid_order') // starts run backwards
    expect(checkQdcSegments([[2, 0, 10], [1, 10, 20]], 2).status).toBe('invalid_order') // first occurrences out of order
    expect(checkQdcSegments([[1, 0, 10], [3, 20, 30]], 3)).toEqual({ status: 'missing_words', missing: [2] })
    expect(checkQdcSegments([[1, 0, 10], [2, 10, 20], [1, 20, 30], [2, 30, 40]], 2).status).toBe('ok_with_repeats')
    expect(checkQdcSegments([[1, 0, 10], [2, 10, 20]], 2)).toEqual({ status: 'ok', missing: [] })
  })
})

describe('classes C and D', () => {
  it('parses mp3quran ayat_timing, skipping the intro row and malformed rows', () => {
    const rows = parseMp3quranTiming(mq30s112)
    expect([...rows.keys()]).toEqual([1, 2, 3, 4])
    expect(rows.get(1)).toEqual({ ayah: 1, startMs: 6111, endMs: 8358 })
    const odd = parseMp3quranTiming([{ ayah: 0, start_time: 0, end_time: 6000 }, { ayah: '2', start_time: '10', end_time: '20.6' }, { ayah: 3, start_time: 50, end_time: 40 }, null])
    expect([...odd.values()]).toEqual([{ ayah: 2, startMs: 10, endMs: 21 }])
    expect(parseMp3quranTiming({ error: 1 }).size).toBe(0)
  })

  it('builds approximate chapter windows (D) and whole per-ayah files (C)', () => {
    const row = parseMp3quranTiming(mq30s112).get(2)!
    expect(fromAyahWindow({ ayah: 2, url: 'https://server.mp3quran.net/x/112.mp3', bitrateKbps: 128, row, wordCount: 2 })).toEqual({
      ayah: 2,
      url: 'https://server.mp3quran.net/x/112.mp3',
      fileKind: 'chapter',
      bitrateKbps: 128,
      windowStartMs: 8358,
      windowEndMs: 10479,
      approximateWindow: true,
      words: [],
      wordCount: 2,
      timing: 'none',
      perAyahUrl: null,
    })
    const ea = 'https://everyayah.com/data/Ghamadi_40kbps/112002.mp3'
    expect(fromAyahWindow({ ayah: 2, url: 'https://cdn.mp3quran.net/x/112.mp3', bitrateKbps: 128, row, wordCount: 2, perAyahUrl: ea }).perAyahUrl).toBe(ea)
    expect(perAyahWithoutWords(3, 'https://everyayah.com/data/x/112003.mp3', 4)).toMatchObject({ fileKind: 'per_ayah', words: [], timing: 'none', wordCount: 4, perAyahUrl: null })
  })
})

describe('estimation helpers', () => {
  it('weighs words by letters, maddah, dagger alef, shadda and a pause sign', () => {
    expect(wordWeight('قل')).toBe(2)
    expect(wordWeight('قل ۚ')).toBe(5)
    expect(wordWeight('جا\u{0653}ء')).toBe(5.5)
    expect(wordWeight('')).toBe(1)
  })

  it('spreads a span proportionally and fills gaps between measured words', () => {
    expect(spread(0, 1000, [{ word: 1, text: 'قل' }, { word: 2, text: 'قل' }])).toEqual([
      { word: 1, startMs: 0, endMs: 500, estimated: true },
      { word: 2, startMs: 500, endMs: 1000, estimated: true },
    ])
    const timed: WordTime[] = [{ word: 1, startMs: 0, endMs: 400, estimated: false }]
    const filled = fillMissing(timed, ['قل', 'هو', 'الله'], 0, 1000)
    expect(filled.map((w) => w.word)).toEqual([1, 2, 3])
    expect(filled.at(-1)!.endMs).toBeLessThanOrEqual(1000)
    expect(filled.slice(1).every((w) => w.estimated && w.startMs >= 400)).toBe(true)
  })
})
