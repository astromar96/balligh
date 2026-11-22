import { describe, expect, it } from 'vitest'
import { CURATED_END, curatedEnd, isIlla, isSpeechVerb } from './guard'
import { DISPLAYS, fixtureAyah, type Display } from './__fixtures__/load'

const word = (key: string, position: number, display: Display) => {
  const w = fixtureAyah(key, display).words.find((x) => x.position === position)
  if (!w) throw new Error(`no word ${key}:${position}`)
  return w.text
}

describe.each(DISPLAYS)('text tests on real words (%s display text)', (display: Display) => {
  it('recognises the speech verbs of research/features.md §2.3, with و/ف and the passive', () => {
    expect(isSpeechVerb(word('5:73', 4, display))).toBe(true) // قَالُوٓا۟
    expect(isSpeechVerb(word('5:64', 1, display))).toBe(true) // وَقَالَتِ
    expect(isSpeechVerb(word('5:73', 19, display))).toBe(true) // يَقُولُونَ
    expect(isSpeechVerb(word('2:11', 2, display))).toBe(true) // قِيلَ
    expect(isSpeechVerb(word('5:26', 1, display))).toBe(true) // قَالَ
    expect(isSpeechVerb(word('5:73', 5, display))).toBe(false) // إِنَّ
    expect(isSpeechVerb(word('16:57', 1, display))).toBe(false) // وَيَجْعَلُونَ
  })
  it('recognises «إِلَّا» and «إِلَّآ», never «أَلَآ» or «أَلَّا»', () => {
    expect(isIlla(word('103:3', 1, display))).toBe(true)
    expect(isIlla(word('15:59', 1, display))).toBe(true) // إِلَّآ (madd)
    expect(isIlla(word('15:60', 1, display))).toBe(true)
    expect(isIlla(word('2:255', 4, display))).toBe(true) // mid-ayah «إِلَّا» is still the particle
    expect(isIlla(word('2:12', 1, display))).toBe(false) // أَلَآ
    expect(isIlla(word('53:38', 1, display))).toBe(false) // أَلَّا
    expect(isIlla(word('103:2', 1, display))).toBe(false) // إِنَّ
  })
})

describe('isIlla / isSpeechVerb edge cases', () => {
  it('accepts every encoding of hamza below and ignores ۞ and spaces', () => {
    expect(isIlla('إلا')).toBe(true)
    expect(isIlla('إِلَّا')).toBe(true) // alef + combining hamza below
    expect(isIlla('ٳلَّا')).toBe(true) // ٳ
    expect(isIlla('۞ إِلَّا')).toBe(true)
    expect(isIlla('ألا')).toBe(false)
    expect(isIlla('الا')).toBe(false)
    expect(isIlla('إِلَّا ٱللَّهَ')).toBe(false) // one word only
    expect(isIlla('')).toBe(false)
    expect(isIlla(undefined as unknown as string)).toBe(false)
  })
  it('matches whole words only', () => {
    expect(isSpeechVerb('فَقَالُوا۟')).toBe(true)
    expect(isSpeechVerb('قَالَتَا')).toBe(true)
    expect(isSpeechVerb('قِيلًا')).toBe(false) // 56:26 «قِيلًا سَلَـٰمًا»: a noun
    expect(isSpeechVerb('وَقِيلِهِۦ')).toBe(false) // 43:88
    expect(isSpeechVerb('قَالُوٓا۟ ۚ')).toBe(true) // a trailing pause mark does not matter
    expect(isSpeechVerb('بِمَا')).toBe(false)
    expect(isSpeechVerb(null as unknown as string)).toBe(false)
  })
})

describe('CURATED_END', () => {
  it('is the small, sourced list of research/features.md §2.3: 107:4 only', () => {
    expect(CURATED_END.map((c) => `${c.surah}:${c.ayah}`)).toEqual(['107:4'])
    expect(CURATED_END[0].source).toMatch(/features\.md §2\.3/)
    expect(CURATED_END[0].source).toMatch(/islamqa\.info\/ar\/answers\/229818/)
    expect(curatedEnd(107, 4)).toBe(CURATED_END[0])
    expect(curatedEnd(107, 5)).toBeNull()
    expect(curatedEnd(4, 107)).toBeNull()
  })
})
