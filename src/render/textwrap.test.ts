import { describe, expect, it } from 'vitest'
import type { TextStyle } from '../core/types'
import { NBSP, fitLineScale, wrapCredit, wrapText, type Measure } from './textwrap'

const st: TextStyle = { family: 'ReadexPro', sizePx: 10, color: '#000', align: 'center', direction: 'ltr' }
// every character (spaces included) is 5 px wide
const measure: Measure = (t) => t.length * 5

describe('text wrapping', () => {
  it('fills lines greedily and starts a new line at paragraph breaks', () => {
    expect(wrapText('aa bb cc dd', 35, st, measure)).toEqual(['aa bb', 'cc dd'])
    expect(wrapText('aa\nbb cc', 100, st, measure)).toEqual(['aa', 'bb cc'])
  })

  it('never breaks at a no-break space (an ayah number stays with its text)', () => {
    const lines = wrapText(`one two three${NBSP}(4)`, 70, st, measure)
    expect(lines).toEqual(['one two', `three${NBSP}(4)`])
  })

  it('splits a token wider than the line', () => {
    expect(wrapText('abcdefghij', 25, st, measure)).toEqual(['abcde', 'fghij'])
  })

  it('never drops or shortens text (licensed tafsir is paged, not cut)', () => {
    const text = 'الله الذي لا إله يعبد بحق إلا هو '.repeat(30).trim()
    const lines = wrapText(text, 120, st, measure)
    expect(lines.join(' ')).toBe(text)
    expect(lines.some((l) => l.includes('…'))).toBe(false)
  })

  it('breaks text without spaces at word boundaries, never inside a grapheme', () => {
    // Thai: no spaces between words; a tone mark must stay with its consonant
    const thai = 'ด้วยพระนามของอัลลอฮ์ผู้ทรงกรุณาปรานี'
    const lines = wrapText(thai, 60, st, measure)
    expect(lines.join('')).toBe(thai)
    for (const l of lines) expect(/^\p{M}/u.test(l)).toBe(false)
  })

  it('wraps a credit between its parts only, never inside the host or a name', () => {
    const host = 'Quran.com / Quran Foundation'
    const credit = `تيسير الكريم الرحمن — عبد الرحمن السعدي · ${host}`
    // the whole line does not fit, each part does: one part per line, the separator dropped at the break
    expect(wrapCredit(credit, 200, st, measure)).toEqual(['تيسير الكريم الرحمن — عبد الرحمن السعدي', host])
    // the work is wider than a line: it breaks at its em dash, the host stays whole
    expect(wrapCredit(credit, 150, st, measure)).toEqual(['تيسير الكريم الرحمن', 'عبد الرحمن السعدي', host])
    // what fits stays on one line
    expect(wrapCredit(credit, 1000, st, measure)).toEqual([credit])
    // a single part wider than the line falls back to words, still losing nothing
    const lines = wrapCredit(host, 60, st, measure)
    expect(lines.join(' ')).toBe(host)
    for (const l of lines) expect(measure(l, st)).toBeLessThanOrEqual(60)
  })

  it('shrinks a line down to the minimum scale', () => {
    expect(fitLineScale('aaaa', 100, st, measure)).toBe(1)
    expect(fitLineScale('a'.repeat(30), 100, st, measure, 0.8)).toBe(0.8)
  })
})
