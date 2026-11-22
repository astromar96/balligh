import { describe, expect, it } from 'vitest'
import type { WaqfKind } from '../core/types'
import { WAQF_INFO, waqfKindOf } from './index'
import { fixtureAyah } from './__fixtures__/load'
import { canStopAfter, waqfOfWord } from './waqf'

const ALL: [WaqfKind, string, boolean][] = [
  ['wasl_awla', 'ۖ', true], // ۖ صلى
  ['waqf_awla', 'ۗ', true], // ۗ قلى
  ['lazim', 'ۘ', true], // ۘ مـ
  ['mamnu', 'ۙ', false], // ۙ لا
  ['jaiz', 'ۚ', true], // ۚ ج
  ['muanaqa', 'ۛ', true], // ۛ ∴
  ['saktah', 'ۜ', false], // ۜ س
]

describe('WAQF_INFO', () => {
  it('covers the seven Madinah Mushaf marks with their code points and stop rule', () => {
    expect(Object.keys(WAQF_INFO).sort()).toEqual(ALL.map(([k]) => k).sort())
    for (const [kind, char, canStop] of ALL) {
      const info = WAQF_INFO[kind]
      expect(info.kind).toBe(kind)
      expect(info.char).toBe(char)
      expect(info.canStop).toBe(canStop)
      expect(info.nameAr.length).toBeGreaterThan(2)
      expect(info.meaningAr).toMatch(/[؀-ۿ]/)
    }
  })
})

describe('waqfKindOf', () => {
  it('maps each mark, alone or with spaces / ZWNJ around it', () => {
    for (const [kind, char] of ALL) {
      expect(waqfKindOf(char)).toBe(kind)
      expect(waqfKindOf(` ${char}`)).toBe(kind)
      expect(waqfKindOf(`‌${char} `)).toBe(kind)
    }
  })
  it('reads the trailing mark of a word as the API spells it', () => {
    expect(waqfKindOf('رَيْبَ ۛ')).toBe('muanaqa')
    expect(waqfKindOf('عِوَجَاۜ')).toBe('saktah') // 18:1, glued without a space
    expect(waqfKindOf('مَّرْقَدِنَا ۜ ۗ')).toBe('waqf_awla') // 36:52: two marks, the last decides
    expect(waqfKindOf('بَصْۜطَةًۭ ۖ')).toBe('wasl_awla') // 7:69: ۜ inside the word is a letter hint
  })
  it('ignores marks inside a word and anything that is not a pause mark', () => {
    expect(waqfKindOf('وَيَبْصُۜطُ')).toBeNull() // 2:245
    expect(waqfKindOf('هُوَ')).toBeNull()
    expect(waqfKindOf('۞')).toBeNull() // rub el hizb is not a pause
    expect(waqfKindOf('')).toBeNull()
    expect(waqfKindOf('   ')).toBeNull()
    expect(waqfKindOf(undefined as unknown as string)).toBeNull()
  })
})

describe('canStopAfter on real words', () => {
  it('follows the fixture words of 2:2, 16:57, 18:1 and 2:245', () => {
    const w22 = fixtureAyah('2:2').words
    expect(w22[3].waqf).toBe('muanaqa')
    expect(canStopAfter(w22[3])).toBe(true)
    expect(canStopAfter(w22[2])).toBe(false)
    expect(canStopAfter(fixtureAyah('16:57').words[3])).toBe(false) // ۙ
    expect(canStopAfter(fixtureAyah('18:1').words[10])).toBe(false) // ۜ
    expect(fixtureAyah('2:245').words[13].waqf).toBeNull()
    expect(canStopAfter(undefined)).toBe(false)
  })
  it('reads Word.waqf (the Tanzil mark, 00-gaps D1) and never the printed waqfChar', () => {
    expect(canStopAfter({ position: 1, text: 'x', waqf: null, waqfChar: 'ۚ', tajweed: [] })).toBe(false)
    expect(canStopAfter({ position: 1, text: 'x', waqf: 'jaiz', waqfChar: null, tajweed: [] })).toBe(true)
    expect(waqfOfWord({ position: 1, text: 'x', waqf: 'nonsense' as never, waqfChar: 'ۚ', tajweed: [] })).toBeNull()
    // QPC display text: 16:57 w4 prints nothing where Tanzil has ۙ; 26:59 w1 prints ۖ where Tanzil has none;
    // 2:195 w10 prints ۚ where Tanzil has the second ۛ of a pair
    const n57 = fixtureAyah('16:57', 'qpc').words[3]
    expect([n57.waqf, n57.waqfChar, canStopAfter(n57)]).toEqual(['mamnu', null, false])
    const s59 = fixtureAyah('26:59', 'qpc').words[0]
    expect([s59.waqf, s59.waqfChar, canStopAfter(s59)]).toEqual([null, 'ۖ', false])
    const b195 = fixtureAyah('2:195', 'qpc').words[9]
    expect([b195.waqf, b195.waqfChar, waqfOfWord(b195)]).toEqual(['muanaqa', 'ۚ', 'muanaqa'])
  })
})
