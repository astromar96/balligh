import { describe, expect, it } from 'vitest'
import {
  balancedLines,
  blockHeight,
  breakLines,
  buildUnits,
  fitQuran,
  linesThatFit,
  pageStarts,
  paginate,
  unitStarts,
  splitPauseMarks,
  type LineMetrics,
  type QUnit,
} from './layout'
import { ayah, fakeFont, fakeTimeline, makeModel, syntheticAyah, word } from './testing/fakes'

const SPACE = 300
const M: LineMetrics = { top: 1.3, bottom: 0.7, pitch: 2 }

function unit(advance: number, extra: Partial<QUnit> = {}): QUnit {
  return { kind: 'word', ayahIndex: 0, ayah: 1, position: 1, advance, glyphs: [], glue: false, breakAfter: 0, weight: 1, ...extra }
}

describe('line breaking', () => {
  it('fills lines greedily with the font space between words', () => {
    const us = [unit(500), unit(500), unit(500)]
    const lines = breakLines(us, 1300, SPACE)
    expect(lines.map((l) => l.units.length)).toEqual([2, 1])
    expect(lines[0].width).toBe(1300)
    expect(lines[1].width).toBe(500)
  })

  it('never starts a line with an ayah number (glued to the word before it)', () => {
    const us = [unit(500), unit(500), unit(400, { kind: 'number', glue: true, breakAfter: 2 }), unit(500)]
    // 500+300+500 = 1300 fits, but the number must follow its word → the last word moves down with it
    const lines = breakLines(us, 1400, SPACE)
    expect(lines[0].units.map((u) => u.kind)).toEqual(['word'])
    expect(lines[1].units.map((u) => u.kind)).toEqual(['word', 'number'])
    for (const l of lines) expect(l.units[0].glue).toBe(false)
  })

  it('gives an over-wide chunk its own line instead of looping', () => {
    const lines = breakLines([unit(300), unit(5000), unit(300)], 1000, SPACE)
    expect(lines.map((l) => l.units.length)).toEqual([1, 1, 1])
  })

  it('balances lines: same line count as greedy, no ragged last line', () => {
    const us = Array.from({ length: 5 }, () => unit(500))
    const greedy = breakLines(us, 3000, SPACE)
    expect(greedy.map((l) => l.units.length)).toEqual([4, 1])
    const balanced = balancedLines(us, 3000, SPACE)
    expect(balanced).toHaveLength(2)
    expect(balanced.map((l) => l.units.length)).toEqual([3, 2])
    expect(Math.max(...balanced.map((l) => l.width))).toBeLessThanOrEqual(2100)
  })
})

describe('units', () => {
  it('places the pause mark in its own gap (sakt written on the word) and marks it as waqf', () => {
    expect(splitPauseMarks('ۛ')).toEqual({ sakt: '', gap: 'ۛ' })
    expect(splitPauseMarks('ۜ')).toEqual({ sakt: 'ۜ', gap: null })
    expect(splitPauseMarks('ۜ ۗ')).toEqual({ sakt: 'ۜ', gap: 'ۗ' }) // 36:52
    expect(splitPauseMarks(null)).toEqual({ sakt: '', gap: null })
    const font = fakeFont()
    const model = makeModel([ayah(2, [word(1, 'ريب', { waqf: 'jaiz', waqfChar: 'ۚ' }), word(2, 'فيه')])])
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: false })
    expect(units.map((u) => u.kind)).toEqual(['word', 'word', 'number'])
    const roles = units[0].glyphs.map((g) => g.role)
    expect(roles.filter((r) => r === 'waqf')).toHaveLength(1)
    // the mark sits in its own gap to the left of the word (x < word start), raised to 0.86 em
    const mark = units[0].glyphs.find((g) => g.role === 'waqf')!
    const wordStart = Math.min(...units[0].glyphs.filter((g) => g.role === 'text').map((g) => g.x))
    expect(mark.x).toBeLessThan(wordStart)
    expect(mark.y).toBe(860 - 900) // fake mark outline starts at y = 900
    expect(units[0].advance).toBe(1500 + 320) // 3 letters + gap max(space 300, mark 160 + 2×80)
    expect(units[0].breakAfter).toBe(1) // ج: stopping allowed
    expect(units[2].glue).toBe(true)
    expect(units[2].breakAfter).toBe(2)
    // 36:52 «مَّرۡقَدِنَاۜ ۗ»: sakt on the word, the waqf-awla mark in the gap; hidden marks → plain word
    const two = makeModel([ayah(52, [word(1, 'مرقدنا', { waqf: 'waqf_awla', waqfChar: 'ۜ ۗ' })], 36)])
    const u = buildUnits(two, font, { waqf: true, numbers: false, tajweed: false })[0]
    expect(u.glyphs.filter((g) => g.role === 'waqf').map((g) => g.gid)).toEqual(['ۗ'.charCodeAt(0), 'ۜ'.charCodeAt(0)])
    expect(u.advance).toBe(6 * 500 + 320)
    const hidden = buildUnits(two, font, { waqf: false, numbers: false, tajweed: false })[0]
    expect(hidden.glyphs.some((g) => g.role === 'waqf')).toBe(false)
    expect(hidden.advance).toBe(6 * 500)
  })

  it('shapes the ayah number as an LTR run of U+06DD + Arabic-Indic digits', () => {
    const font = fakeFont()
    const units = buildUnits(makeModel([syntheticAyah(255, 2)]), font, { waqf: true, numbers: true, tajweed: false })
    const num = units[units.length - 1]
    // fake font: LTR keeps logical order → first glyph is U+06DD, then ٢ ٥ ٥
    expect(num.glyphs.map((g) => g.gid)).toEqual([0x06dd, 0x0662, 0x0665, 0x0665])
    expect(num.glyphs.every((g) => g.role === 'number')).toBe(true)
  })

  it('omits the ornament of a partly selected last ayah and keeps the break hint off', () => {
    const font = fakeFont()
    const model = makeModel([syntheticAyah(43, 3)], { partialEnd: true })
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: false })
    expect(units.some((u) => u.kind === 'number')).toBe(false)
    expect(units[units.length - 1].breakAfter).toBe(0)
  })
})

describe('fit and pagination', () => {
  const font = fakeFont()
  const bounds = { min: 40, max: 90, page: 56 }

  it('short passages get the largest size, long ones a smaller one', () => {
    const short = buildUnits(makeModel([syntheticAyah(1, 4)]), font, { waqf: true, numbers: true, tajweed: false })
    const long = buildUnits(makeModel([syntheticAyah(1, 40)]), font, { waqf: true, numbers: true, tajweed: false })
    const a = fitQuran(short, font, SPACE, 900, 900, bounds, 1, M)
    const b = fitQuran(long, font, SPACE, 900, 900, bounds, 1, M)
    expect(a.size).toBe(90)
    expect(b.size).toBeLessThan(90)
    expect(b.size).toBeGreaterThanOrEqual(40)
    expect(b.paginated).toBe(false)
    // the fitted block really fits
    expect(blockHeight(b.pages[0].lines.length, b.size, M)).toBeLessThanOrEqual(900 + 1e-6)
  })

  it('fontScale multiplies the fitted size and paginates when it overflows', () => {
    const long = buildUnits(makeModel([syntheticAyah(1, 40)]), font, { waqf: true, numbers: true, tajweed: false })
    const base = fitQuran(long, font, SPACE, 900, 900, bounds, 1, M)
    const small = fitQuran(long, font, SPACE, 900, 900, bounds, 0.8, M)
    expect(small.size).toBeCloseTo(base.size * 0.8, 5)
    const big = fitQuran(long, font, SPACE, 900, 900, bounds, 1.4, M)
    expect(big.size).toBeCloseTo(base.size * 1.4, 5)
    expect(big.paginated).toBe(true)
  })

  it('paginates text that cannot fit at the minimum size; every page fits', () => {
    const model = makeModel([syntheticAyah(1, 50), syntheticAyah(2, 60), syntheticAyah(3, 50)])
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: false })
    const fit = fitQuran(units, font, SPACE, 900, 700, bounds, 1, M)
    expect(fit.paginated).toBe(true)
    expect(fit.size).toBe(56)
    const maxLines = linesThatFit(700, fit.size, M)
    let covered = 0
    for (const p of fit.pages) {
      expect(p.lines.length).toBeLessThanOrEqual(maxLines)
      expect(p.first).toBe(covered)
      covered = p.end
    }
    expect(covered).toBe(units.length)
  })

  it('a first page with less room (opening lines above it): its own line budget, the rest share another', () => {
    const units = buildUnits(makeModel([syntheticAyah(1, 50), syntheticAyah(2, 60)]), font, { waqf: true, numbers: true, tajweed: false })
    const pages = paginate(units, 4500, SPACE, 5, 2)
    expect(pages[0].lines.length).toBeLessThanOrEqual(2)
    expect(pages.length).toBeGreaterThan(2)
    for (const p of pages.slice(1)) expect(p.lines.length).toBeLessThanOrEqual(5)
    // contiguous, every unit once
    expect(pages[0].first).toBe(0)
    pages.slice(1).forEach((p, i) => expect(p.first).toBe(pages[i].end))
    expect(pages.at(-1)!.end).toBe(units.length)
    // a budget below one line still makes progress
    expect(paginate(units, 4500, SPACE, 3, 0)[0].lines.length).toBe(1)
  })

  it('fitQuran pages: the first page fits `height`, the later pages `restHeight`', () => {
    const model = makeModel([syntheticAyah(1, 50), syntheticAyah(2, 60), syntheticAyah(3, 50)])
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: false })
    const fit = fitQuran(units, font, SPACE, 900, 400, bounds, 1, M, 900)
    expect(fit.paginated).toBe(true)
    expect(fit.size).toBe(56)
    expect(blockHeight(fit.pages[0].lines.length, fit.size, M)).toBeLessThanOrEqual(400 + 1e-6)
    for (const p of fit.pages.slice(1)) expect(blockHeight(p.lines.length, fit.size, M)).toBeLessThanOrEqual(900 + 1e-6)
    // later pages are fuller than the first
    expect(Math.max(...fit.pages.slice(1, -1).map((p) => p.lines.length))).toBeGreaterThan(fit.pages[0].lines.length)
    expect(fit.pages.at(-1)!.end).toBe(units.length)
  })

  it('prefers to end a page after an ayah (then after a pause mark)', () => {
    // words are 2000 units, two per line; a 3-line page could hold ayah 1 (3 words + ornament) and the
    // first two words of ayah 2 — it should end after ayah 1's ornament instead
    const model = makeModel([syntheticAyah(1, 3), syntheticAyah(2, 30)])
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: false })
    const greedyFirstPage = breakLines(units, 4500, SPACE).slice(0, 3).flatMap((l) => l.units)
    expect(greedyFirstPage.at(-1)?.ayah).toBe(2)
    const pages = paginate(units, 4500, SPACE, 3)
    const firstEnd = units[pages[0].end - 1]
    expect(firstEnd.kind).toBe('number')
    expect(firstEnd.ayah).toBe(1)
    // with pause marks only, a page ends after a mark where stopping is allowed
    const marked = makeModel([
      ayah(1, Array.from({ length: 12 }, (_, i) => word(i + 1, 'بتثج', i === 3 ? { waqf: 'jaiz', waqfChar: 'ۚ' } : {}))),
    ])
    const mu = buildUnits(marked, font, { waqf: false, numbers: true, tajweed: false })
    const mp = paginate(mu, 4500, SPACE, 3)
    expect(mu[mp[0].end - 1].position).toBe(4)
  })
})

describe('timing', () => {
  it('uses word timings for page starts and keeps them monotone', () => {
    const font = fakeFont()
    const model = makeModel([syntheticAyah(1, 6), syntheticAyah(2, 6)])
    const tl = fakeTimeline(model, { wordMs: 500, gapMs: 400 })
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: false })
    const starts = unitStarts(units, tl)
    // word 1 of ayah 2 starts after 6 words + a gap
    const i = units.findIndex((u) => u.ayah === 2 && u.position === 1)
    expect(starts[i]).toBe(6 * 500 + 400)
    for (let k = 1; k < starts.length; k++) expect(starts[k]).toBeGreaterThanOrEqual(starts[k - 1])
    const pages = paginate(units, 2700, 300, 1)
    const ps = pageStarts(pages, starts)
    expect(ps[0]).toBe(0)
    pages.forEach((p, k) => {
      if (k > 0) expect(ps[k]).toBe(starts[p.first])
    })
  })

  it('spreads an ayah window by word length when there are no word timings', () => {
    const font = fakeFont()
    const model = makeModel([ayah(1, [word(1, 'بب'), word(2, 'تتتتتت')])])
    const tl = { durationMs: 8000, ayahs: [{ ayah: 1, startMs: 1000, endMs: 9000 }], words: [] }
    const units = buildUnits(model, font, { waqf: true, numbers: false, tajweed: false })
    const starts = unitStarts(units, tl)
    expect(starts[0]).toBe(1000)
    expect(starts[1]).toBe(1000 + 8000 * (2 / 8))
  })
})
