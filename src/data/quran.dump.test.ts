// Whole-Quran checks of the display pipeline over the researcher's local dump
// (research/fixtures/quran-text-api/all-verses.json: raw QF data, gitignored, never committed or bundled).
// Skipped when the dump is absent; the LIVE suite (live.test.ts) runs the same audit against the API.
// Expected figures: research/00-gaps.md §2.1 (projection), §2.2 (stray meem), §2.3 (two pause-mark systems).
import type { Word } from '../core/types'
import { readJsonIfPresent, repoFile } from './__fixtures__/load'
import { loadAmiriShaper } from './__fixtures__/shaper'
import { auditVerse, emptyCounts, meemCounts, type AuditCounts, type AuditWord } from './audit'

interface DumpVerse {
  key: string
  text_uthmani_tajweed: string
  words: (AuditWord & { char_type_name: string })[]
}

const data = await readJsonIfPresent<{ verses: DumpVerse[] }>(repoFile('research/fixtures/quran-text-api/all-verses.json'))

describe.skipIf(!data)('whole-Quran display text (research dump)', () => {
  let counts: AuditCounts
  let display: Word[][]

  beforeAll(() => {
    if (!data) return
    counts = emptyCounts()
    display = []
    for (const v of data.verses) {
      const words = v.words.filter((w) => w.char_type_name === 'word')
      const built = auditVerse(counts, v.key, v.text_uthmani_tajweed, words)
      display.push((built ?? []).map((b) => b.word))
    }
    console.log('[dump audit]', JSON.stringify(counts))
  }, 120_000)

  it('groups all 6,236 verses and projects tajweed onto qpcToStandard(text_qpc_hafs): ≥ 77,388 exact, one class lost (17:7:12)', () => {
    expect(counts.verses).toBe(6236)
    expect(counts.words).toBe(77429)
    expect(counts.alignmentFailures).toBe(0)
    expect(counts.tokenMerges).toBe(216)
    expect(counts.qpcMissingWords).toBe(0)
    expect(counts.wordsProjectedExactly).toBeGreaterThanOrEqual(77388)
    expect(counts.lostRules).toEqual(['17:7:12 madda_normal'])
    expect(counts.lostDisplayRuleKeys).toEqual(['17:7:12'])
    expect(counts.badSpans).toBe(0)
    expect(counts.badDisplayWords).toBe(0)
  })

  it("agrees with QF's word-level markup except in the 11 words the research lists (9 with another class set)", () => {
    expect(counts.wordLevelCompared).toBe(77429)
    expect(counts.wordLevelDiffKeys).toEqual(['3:153:13', '6:39:4', '8:6:6', '8:6:7', '8:6:9', '8:6:11', '27:10:7', '28:31:8', '37:130:3', '53:62:3', '96:19:5'])
    expect(counts.wordLevelSetDiffer).toBe(9)
  })

  it('draws no stray meem: Tanzil text_uthmani has 6,678 (+ 304 iqlab), the display none', () => {
    if (!data) return
    const tanzil = data.verses.map((v) => v.words.filter((w) => w.char_type_name === 'word').map((w) => w.text_uthmani))
    expect(meemCounts(tanzil)).toEqual({ words: 6982, iqlab: 304, spurious: 6678 })
    expect(meemCounts(display.map((ws) => ws.map((w) => w.text)))).toEqual({ words: 0, iqlab: 0, spurious: 0 })
    expect(counts.tanweenMeemWords).toBe(0)
  })

  it('keeps both pause-mark systems (D1): Tanzil and QPC marks differ in 353 words; ۙ guards 68 words, 67 with no printed mark', () => {
    expect(counts.waqfMarkDiffWords).toBe(353)
    // 52:37:7 is the 353rd: QPC writes ۜ inside the word «ٱلۡمُصَۜيۡطِرُونَ» (a letter hint, not a pause), Tanzil U+06E3
    expect(counts.waqfTrailingDiffWords).toBe(352)
    expect(counts.mamnu).toBe(68)
    expect(counts.mamnuWithoutPrintedMark).toBe(67)
    expect(counts.waqfFieldErrors).toBe(0)
  })

  it('shapes every display word, pause mark and the ayah-end ornaments with Amiri Quran: no .notdef', async () => {
    const shaper = await loadAmiriShaper()
    expect(shaper).not.toBeNull()
    if (!shaper) return
    // the check can fail: raw QPC open dammatan (U+065E) has no glyph in Amiri Quran
    expect(shaper.glyphs('عَلِيمٞ')).toContain(0)
    const missing: string[] = []
    const marks = new Set<string>()
    display.forEach((words, vi) =>
      words.forEach((w) => {
        if (shaper.glyphs(w.text).includes(0)) missing.push(`${data?.verses[vi].key}:${w.position} ${w.text}`)
        if (w.waqfChar) marks.add(w.waqfChar)
      }),
    )
    for (const m of marks) if (shaper.glyphs(` ${m}`).includes(0)) missing.push(`mark ${m}`)
    for (const n of ['١', '٢٥٥', '٢٨٦']) if (shaper.glyphs(`\u{06DD}${n}`, 'ltr').includes(0)) missing.push(`ornament ${n}`)
    expect(missing).toEqual([])
  }, 120_000)
})
