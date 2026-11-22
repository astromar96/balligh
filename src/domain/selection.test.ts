import { describe, expect, it } from 'vitest'
import type { Ayah, Selection } from '../core/types'
import {
  AYAH_END_WORD,
  ayahRangeSelection,
  clampSelection,
  compareRefs,
  describeSelection,
  expandToAyahs,
  isWordSelected,
  normalizeSelection,
  selectedWordCount,
  selectionWarnings,
  snapToPauses,
  trimToSelection,
  warningSeverity,
  type SelectionWarning,
} from './index'
import { DISPLAYS, fixtureAyah, fixtureAyahs, SURAHS, type Display } from './__fixtures__/load'

const sel = (surah: number, a1: number, w1: number, a2: number, w2: number): Selection => ({
  surah,
  start: { ayah: a1, word: w1 },
  end: { ayah: a2, word: w2 },
})

const baqarah = fixtureAyahs(2) // 2:2, 2:11, 2:12, 2:26, 2:195, 2:245, 2:255–257 (real api.quran.com words)

describe('compareRefs / normalizeSelection', () => {
  it('orders by ayah then word', () => {
    expect(compareRefs({ ayah: 2, word: 9 }, { ayah: 3, word: 1 })).toBeLessThan(0)
    expect(compareRefs({ ayah: 3, word: 2 }, { ayah: 3, word: 1 })).toBeGreaterThan(0)
    expect(compareRefs({ ayah: 3, word: 2 }, { ayah: 3, word: 2 })).toBe(0)
  })
  it('swaps a reversed selection and leaves the input alone', () => {
    const input = sel(2, 257, 5, 255, 3)
    expect(normalizeSelection(input)).toEqual(sel(2, 255, 3, 257, 5))
    expect(input).toEqual(sel(2, 257, 5, 255, 3))
    expect(normalizeSelection(sel(2, 255, 3, 257, 5))).toEqual(sel(2, 255, 3, 257, 5))
  })
})

describe('ayahRangeSelection / expandToAyahs / clampSelection', () => {
  it('selects whole ayahs with real word positions', () => {
    expect(ayahRangeSelection(2, 255, 257, baqarah)).toEqual(sel(2, 255, 1, 257, 24))
    expect(ayahRangeSelection(2, 257, 255, baqarah)).toEqual(sel(2, 255, 1, 257, 24))
    expect(ayahRangeSelection(112, 0, 9, fixtureAyahs(112))).toEqual(sel(112, 1, 1, 4, 5))
  })
  it('clamps to the surah and marks unknown word counts with AYAH_END_WORD', () => {
    expect(ayahRangeSelection(2, 280, 300, baqarah)).toEqual(sel(2, 280, 1, 286, AYAH_END_WORD))
    expect(ayahRangeSelection(1, 3, 3, [])).toEqual(sel(1, 3, 1, 3, AYAH_END_WORD))
  })
  it('expands a word selection to whole ayahs', () => {
    expect(expandToAyahs(sel(2, 255, 3, 257, 5), baqarah)).toEqual(sel(2, 255, 1, 257, 24))
    expect(expandToAyahs(sel(2, 257, 5, 255, 3), baqarah)).toEqual(sel(2, 255, 1, 257, 24))
  })
  it('clampSelection resolves AYAH_END_WORD and out-of-range numbers', () => {
    expect(clampSelection(sel(2, 255, 1, 257, AYAH_END_WORD), baqarah)).toEqual(sel(2, 255, 1, 257, 24))
    expect(clampSelection(sel(2, 255, 0, 255, 70), baqarah)).toEqual(sel(2, 255, 1, 255, 50))
    expect(clampSelection(sel(112, 9, 1, 3, 2), fixtureAyahs(112))).toEqual(sel(112, 3, 2, 4, 5))
    expect(clampSelection(sel(1, 1, 1, 7, AYAH_END_WORD), [])).toEqual(sel(1, 1, 1, 7, AYAH_END_WORD))
  })
})

describe('isWordSelected / trimToSelection / selectedWordCount', () => {
  const s = sel(2, 255, 3, 257, 5)
  it('tests membership in reading order, either direction', () => {
    expect(isWordSelected(null, { ayah: 255, word: 3 })).toBe(false)
    expect(isWordSelected(s, { ayah: 255, word: 2 })).toBe(false)
    expect(isWordSelected(s, { ayah: 255, word: 3 })).toBe(true)
    expect(isWordSelected(s, { ayah: 256, word: 24 })).toBe(true)
    expect(isWordSelected(s, { ayah: 257, word: 5 })).toBe(true)
    expect(isWordSelected(s, { ayah: 257, word: 6 })).toBe(false)
    expect(isWordSelected(sel(2, 257, 5, 255, 3), { ayah: 256, word: 1 })).toBe(true)
    expect(isWordSelected(sel(2, 255, 1, 255, AYAH_END_WORD), { ayah: 255, word: 50 })).toBe(true)
  })
  it('trims the first and last ayah, keeping original positions', () => {
    const t = trimToSelection(s, baqarah)
    expect(t.ayahs.map((a) => a.number)).toEqual([255, 256, 257])
    expect(t.ayahs[0].words.map((w) => w.position)).toEqual(Array.from({ length: 48 }, (_, i) => i + 3))
    expect(t.ayahs[1].words).toHaveLength(24)
    expect(t.ayahs[2].words.map((w) => w.position)).toEqual([1, 2, 3, 4, 5])
    expect(t.partialStart).toBe(true)
    expect(t.partialEnd).toBe(true)
    expect(baqarah.find((a) => a.number === 255)!.words).toHaveLength(50) // input untouched
  })
  it('reports whole ayahs as not partial (also with AYAH_END_WORD)', () => {
    const t = trimToSelection(sel(2, 255, 1, 256, AYAH_END_WORD), baqarah)
    expect(t.partialStart).toBe(false)
    expect(t.partialEnd).toBe(false)
    expect(t.ayahs.map((a) => a.words.length)).toEqual([50, 24])
  })
  it('counts selected words', () => {
    expect(selectedWordCount(s, baqarah)).toBe(48 + 24 + 5)
    expect(selectedWordCount(sel(2, 255, 7, 255, 7), baqarah)).toBe(1)
  })
})

// The guard reads Word.waqf (Tanzil marks) and compares text after normalizeForSearch, so every expectation below
// must hold for the Tanzil text the fixtures were first built from AND for the QPC display text data serves now.
describe.each(DISPLAYS)('snapToPauses on real pause marks (%s display text)', (display: Display) => {
  const A = (key: string) => [fixtureAyah(key, display)]
  const surah = (n: number) => fixtureAyahs(n, 1, 999, display)
  it('extends an end that is mid-phrase to the next allowed stop', () => {
    // 4:43 «لَا تَقْرَبُوا۟ ٱلصَّلَوٰةَ» → «… حَتَّىٰ تَغْتَسِلُوا۟ ۚ» (w19, jaiz)
    expect(snapToPauses(sel(4, 43, 1, 43, 6), A('4:43'))).toEqual(sel(4, 43, 1, 43, 19))
  })
  it('never ends on ۙ (mamnu): moves past it, although QPC prints no mark there', () => {
    // 16:57 «سُبْحَـٰنَهُۥ ۙ» (w4) → the ayah end
    expect(fixtureAyah('16:57', display).words[3].waqf).toBe('mamnu')
    expect(snapToPauses(sel(16, 57, 1, 57, 4), A('16:57'))).toEqual(sel(16, 57, 1, 57, 7))
  })
  it('never starts right after ۙ: moves back to the previous real stop', () => {
    expect(snapToPauses(sel(16, 57, 5, 57, 7), A('16:57'))).toEqual(sel(16, 57, 1, 57, 7))
  })
  it('keeps a selection that already sits on stops (ۛ muanaqa, ۘ lazim)', () => {
    expect(snapToPauses(sel(2, 2, 1, 2, 4), A('2:2'))).toEqual(sel(2, 2, 1, 2, 4))
    expect(snapToPauses(sel(2, 2, 5, 2, 7), A('2:2'))).toEqual(sel(2, 2, 5, 2, 7))
    expect(snapToPauses(sel(5, 73, 1, 73, 8), A('5:73'))).toEqual(sel(5, 73, 1, 73, 8))
  })
  it('moves a start back to the phrase start (inside a quotation: back to the speech verb)', () => {
    // 5:73 «إِنَّ ٱللَّهَ ثَالِثُ ثَلَـٰثَةٍۢ ۘ» starts inside «قَالُوٓا۟ …» → ayah start
    expect(snapToPauses(sel(5, 73, 5, 73, 8), A('5:73'))).toEqual(sel(5, 73, 1, 73, 8))
    // 2:255 w14 → just after w12 «نَوْمٌۭ ۚ»
    expect(snapToPauses(sel(2, 255, 14, 255, 16), A('2:255'))).toEqual(sel(2, 255, 13, 255, 19))
  })
  it('treats ۜ (saktah) as no stop', () => {
    expect(snapToPauses(sel(75, 27, 1, 27, 2), A('75:27'))).toEqual(sel(75, 27, 1, 27, 3))
    expect(snapToPauses(sel(83, 14, 3, 14, 4), A('83:14'))).toEqual(sel(83, 14, 2, 14, 8))
  })
  it('lets the trailing mark decide when a word carries two (36:52 «ۜ ۗ»)', () => {
    expect(snapToPauses(sel(36, 52, 2, 52, 5), A('36:52'))).toEqual(sel(36, 52, 1, 52, 6))
    expect(snapToPauses(sel(36, 52, 7, 52, 9), A('36:52'))).toEqual(sel(36, 52, 7, 52, 12))
  })
  it('never stops at both marks of a ۛ pair: a start right after one moves the end past the other', () => {
    // 2:2 «لَا رَيْبَ ۛ فِيهِ ۛ هُدًى»: «فِيهِ» alone stops at both
    expect(snapToPauses(sel(2, 2, 5, 2, 5), A('2:2'))).toEqual(sel(2, 2, 5, 2, 7))
    // 5:26 «عَلَيْهِمْ ۛ أَرْبَعِينَ سَنَةًۭ ۛ يَتِيهُونَ فِى ٱلْأَرْضِ ۚ»: «أَرْبَعِينَ سَنَةً» alone → to «ٱلْأَرْضِ ۚ»
    expect(snapToPauses(sel(5, 26, 5, 26, 6), A('5:26'))).toEqual(sel(5, 26, 5, 26, 9))
    // a start that does not follow the pair's first mark keeps its end on the second
    expect(snapToPauses(sel(2, 2, 1, 2, 5), A('2:2'))).toEqual(sel(2, 2, 1, 2, 5))
    // 2:195: the Tanzil pair w9/w10 counts although QPC prints no ۛ at all there (w10 shows ۚ)
    expect(snapToPauses(sel(2, 195, 10, 195, 10), A('2:195'))).toEqual(sel(2, 195, 10, 195, 14))
  })
  it('ignores the printed QPC mark: 26:59 «كَذَٰلِكَ» shows ۖ, the Tanzil text has no stop there', () => {
    const w1 = fixtureAyah('26:59', display).words[0]
    expect(w1.waqf).toBeNull()
    expect(w1.waqfChar).toBe(display === 'qpc' ? 'ۖ' : null)
    expect(snapToPauses(sel(26, 59, 1, 59, 1), A('26:59'))).toEqual(sel(26, 59, 1, 59, 4))
  })
  it('snaps both ends of a multi-ayah selection, never across the ayah boundary', () => {
    expect(snapToPauses(sel(2, 255, 3, 257, 5), surah(2))).toEqual(sel(2, 255, 1, 257, 9))
    expect(snapToPauses(sel(2, 256, 1, 257, AYAH_END_WORD), surah(2))).toEqual(sel(2, 256, 1, 257, 24))
  })
  it('leaves ends whose ayahs are unknown untouched', () => {
    expect(snapToPauses(sel(2, 100, 3, 100, 4), surah(2))).toEqual(sel(2, 100, 3, 100, 4))
  })
})

describe.each(DISPLAYS)('selectionWarnings: research/features.md §2.3 cases on real data (%s display text)', (display: Display) => {
  const A = (key: string) => [fixtureAyah(key, display)]
  const surah = (n: number, from = 1, to = 999) => fixtureAyahs(n, from, to, display)
  const warn = (s: Selection, ayahs: Ayah[]) => selectionWarnings(s, ayahs)

  it('4:43 w1–w6 «لا تقربوا الصلاة» ends mid-phrase; up to «حَتَّىٰ تَغْتَسِلُوا۟ ۚ» it is fine', () => {
    expect(warn(sel(4, 43, 1, 43, 6), A('4:43'))).toEqual([{ kind: 'ends-mid-phrase', at: { ayah: 43, word: 6 } }])
    expect(warn(sel(4, 43, 1, 43, 19), A('4:43'))).toEqual([])
  })
  it('2:26 w1–w4 «إن الله لا يستحيي» ends mid-phrase', () => {
    expect(warn(sel(2, 26, 1, 26, 4), A('2:26'))).toEqual([{ kind: 'ends-mid-phrase', at: { ayah: 26, word: 4 } }])
  })
  it('16:57 w1–w4 ends on ۙ (QPC prints no mark there: the guard still reads it)', () => {
    expect(warn(sel(16, 57, 1, 57, 4), A('16:57'))).toEqual([{ kind: 'ends-on-mamnu', at: { ayah: 57, word: 4 } }])
  })
  it('a start right after ۙ is mid-phrase', () => {
    expect(warn(sel(16, 57, 5, 57, 7), A('16:57'))).toEqual([{ kind: 'starts-mid-phrase', at: { ayah: 57, word: 5 } }])
  })
  it('5:73 w5–w8 starts inside «قَالُوٓا۟ …» (strong), ends on ۘ', () => {
    expect(warn(sel(5, 73, 5, 73, 8), A('5:73'))).toEqual([
      { kind: 'starts-after-speech-verb', at: { ayah: 73, word: 5 }, verb: { ayah: 73, word: 4 } },
    ])
  })
  it('5:64 w3–w6 starts inside «وَقَالَتِ ٱلْيَهُودُ …» and ends mid-phrase', () => {
    expect(warn(sel(5, 64, 3, 64, 6), A('5:64'))).toEqual([
      { kind: 'starts-after-speech-verb', at: { ayah: 64, word: 3 }, verb: { ayah: 64, word: 1 } },
      { kind: 'ends-mid-phrase', at: { ayah: 64, word: 6 } },
    ])
  })
  it('a speech verb before the last stop does not count (5:64 «بِمَا قَالُوا۟ ۘ بَلْ …»)', () => {
    expect(warn(sel(5, 64, 11, 64, 16), A('5:64'))).toEqual([])
  })
  it('finds the speech verb nearest the start, with و/ف and in the passive (2:11 «قِيلَ», «قَالُوٓا۟»)', () => {
    expect(warn(sel(2, 11, 9, 11, 11), A('2:11'))).toEqual([
      { kind: 'starts-after-speech-verb', at: { ayah: 11, word: 9 }, verb: { ayah: 11, word: 8 } },
    ])
    expect(warn(sel(2, 11, 4, 11, 7), A('2:11'))).toEqual([
      { kind: 'starts-after-speech-verb', at: { ayah: 11, word: 4 }, verb: { ayah: 11, word: 2 } },
      { kind: 'ends-mid-phrase', at: { ayah: 11, word: 7 } },
    ])
  })
  it('107:4 (curated): a whole ayah that must not end a clip, fixed by extending into 107:5', () => {
    const maun = surah(107)
    expect(warn(sel(107, 4, 1, 4, 2), maun)).toEqual([{ kind: 'ends-curated', at: { ayah: 4, word: 2 }, extendTo: { ayah: 5, word: 5 } }])
    expect(warn(sel(107, 1, 1, 4, AYAH_END_WORD), maun)).toEqual([
      { kind: 'ends-curated', at: { ayah: 4, word: 2 }, extendTo: { ayah: 5, word: 5 } },
    ])
    expect(warn(sel(107, 4, 1, 5, 5), maun)).toEqual([])
    expect(warn(sel(107, 4, 1, 4, 1), maun)).toEqual([{ kind: 'ends-mid-phrase', at: { ayah: 4, word: 1 } }])
    // 107:5 not loaded: extend to its end; 107:4 not loaded either: the end word says "ayah end"
    expect(warn(sel(107, 4, 1, 4, 2), A('107:4'))).toEqual([
      { kind: 'ends-curated', at: { ayah: 4, word: 2 }, extendTo: { ayah: 5, word: AYAH_END_WORD } },
    ])
    expect(warn(sel(107, 4, 1, 4, AYAH_END_WORD), [])).toEqual([
      { kind: 'ends-curated', at: { ayah: 4, word: AYAH_END_WORD }, extendTo: { ayah: 5, word: AYAH_END_WORD } },
    ])
  })
  it('103:2 → 103:3 «إِلَّا …»: the next ayah qualifies the end', () => {
    const asr = surah(103)
    const w = { kind: 'next-starts-with-illa', at: { ayah: 2, word: 4 }, extendTo: { ayah: 3, word: 9 } }
    expect(warn(sel(103, 2, 1, 2, 4), asr)).toEqual([w])
    expect(warn(sel(103, 1, 1, 2, AYAH_END_WORD), asr)).toEqual([w])
    expect(warn(sel(103, 1, 1, 3, 9), asr)).toEqual([])
    expect(warn(sel(103, 2, 1, 2, 4), A('103:2'))).toEqual([]) // the next ayah is unknown: no guess
  })
  it('matches «إِلَّآ» with madd too, and extends to the next phrase end (15:58–60, ۙ in 15:60 is no stop)', () => {
    const hijr = surah(15)
    expect(warn(sel(15, 58, 1, 58, 6), hijr)).toEqual([
      { kind: 'next-starts-with-illa', at: { ayah: 58, word: 6 }, extendTo: { ayah: 59, word: 6 } },
    ])
    expect(warn(sel(15, 59, 1, 59, 6), hijr)).toEqual([
      { kind: 'next-starts-with-illa', at: { ayah: 59, word: 6 }, extendTo: { ayah: 60, word: 6 } },
    ])
  })
  it('never mistakes «أَلَآ» or «أَلَّا» for «إِلَّا» (2:11 → 2:12, 53:37 → 53:38)', () => {
    expect(warn(sel(2, 11, 1, 11, 11), surah(2))).toEqual([])
    expect(warn(sel(53, 37, 1, 37, 3), surah(53))).toEqual([])
  })
  it('ends on ۛ or ۖ: an info hint, not a warning', () => {
    const hint = (ayah: number, word: number, mark: 'wasl_awla' | 'muanaqa'): SelectionWarning => ({
      kind: 'pause-hint',
      at: { ayah, word },
      mark,
      bothStops: false,
    })
    expect(warn(sel(2, 2, 1, 2, 4), A('2:2'))).toEqual([hint(2, 4, 'muanaqa')])
    expect(warn(sel(2, 2, 1, 2, 5), A('2:2'))).toEqual([hint(2, 5, 'muanaqa')])
    expect(warn(sel(5, 26, 1, 26, 4), A('5:26'))).toEqual([hint(26, 4, 'muanaqa')])
    expect(warn(sel(2, 255, 1, 255, 32), A('2:255'))).toEqual([hint(255, 32, 'wasl_awla')])
    // the Tanzil ۛ of 2:195 w9, where QPC prints nothing
    expect(warn(sel(2, 195, 1, 195, 9), A('2:195'))).toEqual([hint(195, 9, 'muanaqa')])
    expect(warn(sel(2, 2, 1, 2, 4), A('2:2')).map(warningSeverity)).toEqual(['info'])
  })
  it('stopping at both marks of a ۛ pair is a warning (2:2 «فِيهِ», 5:26 «أَرْبَعِينَ سَنَةً»)', () => {
    const both = (ayah: number, word: number): SelectionWarning => ({ kind: 'pause-hint', at: { ayah, word }, mark: 'muanaqa', bothStops: true })
    expect(warn(sel(2, 2, 5, 2, 5), A('2:2'))).toEqual([both(2, 5)])
    expect(warn(sel(5, 26, 5, 26, 6), A('5:26'))).toEqual([both(26, 6)])
    expect(warn(sel(2, 195, 10, 195, 10), A('2:195'))).toEqual([both(195, 10)])
    expect(warningSeverity(both(2, 5))).toBe('warning')
    expect(warn(sel(2, 2, 5, 2, 7), A('2:2'))).toEqual([]) // stops at the first mark only
  })
  it('reads the Tanzil mark, never the printed one (26:59 «كَذَٰلِكَ»: QPC ۖ, Tanzil none)', () => {
    expect(warn(sel(26, 59, 1, 59, 1), A('26:59'))).toEqual([{ kind: 'ends-mid-phrase', at: { ayah: 59, word: 1 } }])
  })
  it('ayah ends and allowed stops: no warning', () => {
    expect(warn(sel(2, 255, 13, 255, 19), A('2:255'))).toEqual([])
    expect(warn(sel(2, 255, 1, 257, AYAH_END_WORD), surah(2))).toEqual([])
    expect(warn(sel(5, 73, 1, 73, 8), A('5:73'))).toEqual([])
  })
  it('ۜ (saktah) is not a stop; 69:28 ends its ayah on ۜ, which is fine', () => {
    expect(warn(sel(75, 27, 1, 27, 2), A('75:27'))).toEqual([{ kind: 'ends-mid-phrase', at: { ayah: 27, word: 2 } }])
    expect(warn(sel(69, 28, 1, 28, 4), A('69:28'))).toEqual([])
  })
  it('flags selections above 120 words', () => {
    // 2:26 … 2:257 in the fixture: 39 + 14 + 16 + 50 + 24 + 24 words
    expect(warn(sel(2, 26, 1, 257, AYAH_END_WORD), surah(2))).toEqual([{ kind: 'long', count: 167 }])
    expect(warn(sel(2, 255, 1, 257, 24), surah(2)).some((x) => x.kind === 'long')).toBe(false)
  })
  it('reports start, end and length together, start first', () => {
    expect(warn(sel(2, 26, 2, 257, 5), surah(2)).map((x) => x.kind)).toEqual(['starts-mid-phrase', 'ends-mid-phrase', 'long'])
  })
})

describe('the guard does not depend on the display encoding (exhaustive over the fixture)', () => {
  const SURAH_NUMBERS = [1, 2, 4, 5, 13, 15, 16, 18, 26, 36, 37, 53, 69, 75, 83, 103, 107, 112]
  const cases: { s: Selection; surah: number }[] = []
  for (const n of SURAH_NUMBERS) {
    const ayahs = fixtureAyahs(n)
    for (const a of ayahs) {
      const count = a.words.length
      for (let w1 = 1; w1 <= count; w1++) for (let w2 = w1; w2 <= count; w2++) cases.push({ s: sel(n, a.number, w1, a.number, w2), surah: n })
    }
    for (const a of ayahs) for (const b of ayahs) if (b.number > a.number) cases.push({ s: sel(n, a.number, 1, b.number, AYAH_END_WORD), surah: n })
  }
  const bySurah = (display: Display) => new Map(SURAH_NUMBERS.map((n) => [n, fixtureAyahs(n, 1, 999, display)]))
  const uthmani = bySurah('uthmani')
  const qpc = bySurah('qpc')

  it(`gives the same warnings and snaps for all ${cases.length} single-ayah word ranges and ayah ranges`, () => {
    expect(cases.length).toBeGreaterThan(6_000)
    for (const { s, surah } of cases) {
      const u = uthmani.get(surah) as Ayah[]
      const q = qpc.get(surah) as Ayah[]
      expect(selectionWarnings(s, q)).toEqual(selectionWarnings(s, u))
      expect(snapToPauses(s, q)).toEqual(snapToPauses(s, u))
    }
  })
  it('a snapped selection keeps only hints the snap cannot fix (ayah-end warnings, ۖ/ۛ info, length)', () => {
    const fixable = new Set(['starts-mid-phrase', 'starts-after-speech-verb', 'ends-mid-phrase', 'ends-on-mamnu'])
    for (const { s, surah } of cases) {
      const q = qpc.get(surah) as Ayah[]
      for (const w of selectionWarnings(snapToPauses(s, q), q)) {
        expect(fixable.has(w.kind), `${JSON.stringify(s)} → ${w.kind}`).toBe(false)
        if (w.kind === 'pause-hint') expect(w.bothStops).toBe(false)
      }
    }
  })
})

describe('warningSeverity', () => {
  it("rates every kind; only a pause hint that does not stop at both marks of a pair is 'info'", () => {
    const at = { ayah: 1, word: 1 }
    const all: SelectionWarning[] = [
      { kind: 'starts-mid-phrase', at },
      { kind: 'starts-after-speech-verb', at, verb: at },
      { kind: 'ends-mid-phrase', at },
      { kind: 'ends-on-mamnu', at },
      { kind: 'ends-curated', at, extendTo: at },
      { kind: 'next-starts-with-illa', at, extendTo: at },
      { kind: 'pause-hint', at, mark: 'wasl_awla', bothStops: false },
      { kind: 'pause-hint', at, mark: 'muanaqa', bothStops: false },
      { kind: 'pause-hint', at, mark: 'muanaqa', bothStops: true },
      { kind: 'long', count: 200 },
    ]
    expect(all.map(warningSeverity)).toEqual(['warning', 'warning', 'warning', 'warning', 'warning', 'warning', 'info', 'info', 'warning', 'warning'])
  })
})

describe('describeSelection', () => {
  const s2 = SURAHS[2]
  it('labels whole ayahs and ranges', () => {
    expect(describeSelection(sel(2, 255, 1, 255, 50), s2, baqarah)).toBe('البقرة ٢٥٥')
    expect(describeSelection(sel(2, 255, 1, 257, 24), s2, baqarah)).toBe('البقرة ٢٥٥–٢٥٧')
    expect(describeSelection(sel(2, 255, 1, 257, AYAH_END_WORD), s2, [])).toBe('البقرة ٢٥٥–٢٥٧')
  })
  it('labels partial ayahs', () => {
    expect(describeSelection(sel(2, 255, 1, 255, 7), s2, baqarah)).toBe('البقرة ٢٥٥ (الكلمات ١–٧)')
    expect(describeSelection(sel(2, 255, 3, 255, 3), s2, baqarah)).toBe('البقرة ٢٥٥ (الكلمة ٣)')
    expect(describeSelection(sel(2, 255, 13, 255, 50), s2, baqarah)).toBe('البقرة ٢٥٥ (من الكلمة ١٣)')
    expect(describeSelection(sel(2, 255, 3, 257, 5), s2, baqarah)).toBe('البقرة ٢٥٥–٢٥٧ (من الكلمة ٣ إلى الكلمة ٥)')
    expect(describeSelection(sel(2, 255, 1, 257, 5), s2, baqarah)).toBe('البقرة ٢٥٥–٢٥٧ (إلى الكلمة ٥)')
    expect(describeSelection(sel(2, 255, 3, 257, 24), s2, baqarah)).toBe('البقرة ٢٥٥–٢٥٧ (من الكلمة ٣)')
  })
  it('orders a reversed selection and survives a missing surah name', () => {
    expect(describeSelection(sel(2, 257, 5, 255, 3), s2, baqarah)).toBe('البقرة ٢٥٥–٢٥٧ (من الكلمة ٣ إلى الكلمة ٥)')
    const noName = { ...SURAHS[112], nameArabic: '' }
    expect(describeSelection(sel(112, 1, 1, 4, 5), noName, fixtureAyahs(112))).toBe('سورة ١١٢ ١–٤')
  })
  // the same cases as src/ui/describe.test.ts, which this replaces
  it('labels passages in English with the same cases as the Arabic', () => {
    const CASES: [Selection, string, string][] = [
      [sel(2, 255, 1, 255, 50), 'Al-Baqarah 255', 'البقرة ٢٥٥'],
      [sel(2, 255, 1, 257, AYAH_END_WORD), 'Al-Baqarah 255–257', 'البقرة ٢٥٥–٢٥٧'],
      [sel(2, 255, 3, 255, 3), 'Al-Baqarah 255 (word 3)', 'البقرة ٢٥٥ (الكلمة ٣)'],
      [sel(2, 255, 1, 255, 7), 'Al-Baqarah 255 (words 1–7)', 'البقرة ٢٥٥ (الكلمات ١–٧)'],
      [sel(2, 255, 3, 255, 50), 'Al-Baqarah 255 (from word 3)', 'البقرة ٢٥٥ (من الكلمة ٣)'],
      [sel(2, 255, 5, 256, 4), 'Al-Baqarah 255–256 (from word 5 to word 4)', 'البقرة ٢٥٥–٢٥٦ (من الكلمة ٥ إلى الكلمة ٤)'],
      [sel(2, 255, 1, 256, 4), 'Al-Baqarah 255–256 (to word 4)', 'البقرة ٢٥٥–٢٥٦ (إلى الكلمة ٤)'],
    ]
    for (const [s, en, ar] of CASES) {
      expect(describeSelection(s, s2, baqarah, 'en')).toBe(en)
      expect(describeSelection(s, s2, baqarah, 'ar')).toBe(ar)
      expect(describeSelection(s, s2, baqarah)).toBe(ar)
    }
  })
  it('names an unknown surah by number in both languages', () => {
    expect(describeSelection(sel(2, 255, 1, 255, 50), null, baqarah, 'en')).toBe('Surah 2 255')
    expect(describeSelection(sel(2, 255, 1, 255, 50), null, baqarah, 'ar')).toBe('سورة ٢ ٢٥٥')
    expect(describeSelection(sel(112, 1, 2, 1, 3), { ...SURAHS[112], nameSimple: ' ' }, fixtureAyahs(112), 'en')).toBe('Surah 112 1 (words 2–3)')
  })
  it('labels QPC display ayahs exactly like Tanzil ones', () => {
    const q = fixtureAyahs(2, 1, 999, 'qpc')
    expect(describeSelection(sel(2, 255, 3, 257, 5), s2, q)).toBe(describeSelection(sel(2, 255, 3, 257, 5), s2, baqarah))
    expect(describeSelection(sel(2, 255, 3, 257, 5), s2, q, 'en')).toBe('Al-Baqarah 255–257 (from word 3 to word 5)')
  })
})

describe('robustness', () => {
  it('handles empty and malformed input without throwing', () => {
    const empty: Ayah[] = []
    const s = sel(2, 255, 3, 257, 5)
    expect(trimToSelection(s, empty)).toEqual({ ayahs: [], partialStart: false, partialEnd: false })
    expect(selectedWordCount(s, empty)).toBe(0)
    expect(selectionWarnings(s, empty)).toEqual([])
    expect(snapToPauses(s, empty)).toEqual(s)
    const broken = [{ ...fixtureAyah('112:1'), words: [] }] as Ayah[]
    expect(() => describeSelection(sel(112, 1, 1, 1, 4), SURAHS[112], broken)).not.toThrow()
    expect(() => describeSelection(sel(112, 1, 1, 1, 4), SURAHS[112], broken, 'en')).not.toThrow()
    expect(normalizeSelection({ surah: 1, start: { ayah: Number.NaN, word: 2 }, end: { ayah: 1, word: 1 } } as Selection)).toEqual(
      sel(1, 1, 1, 1, 2),
    )
    const odd = [{ ...fixtureAyah('2:2'), words: fixtureAyah('2:2').words.map((w) => ({ ...w, text: undefined as unknown as string, waqf: 'x' as never })) }]
    expect(() => selectionWarnings(sel(2, 2, 3, 2, 5), odd)).not.toThrow()
    expect(warningSeverity(undefined as unknown as SelectionWarning)).toBe('warning')
  })
})
