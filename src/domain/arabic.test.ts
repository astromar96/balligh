import { describe, expect, it } from 'vitest'
import { normalizeForSearch, toArabicDigits } from './index'
import { fixtureAyah } from './__fixtures__/load'

describe('toArabicDigits', () => {
  it('converts numbers and digit strings', () => {
    expect(toArabicDigits(255)).toBe('٢٥٥')
    expect(toArabicDigits(0)).toBe('٠')
    expect(toArabicDigits(1234567890)).toBe('١٢٣٤٥٦٧٨٩٠')
    expect(toArabicDigits('2:255')).toBe('٢:٢٥٥')
    expect(toArabicDigits('۱۲۳')).toBe('١٢٣') // Persian digits
    expect(toArabicDigits('البقرة 255')).toBe('البقرة ٢٥٥')
  })
  it('uses the Arabic decimal separator for numbers only', () => {
    expect(toArabicDigits(1.5)).toBe('١٫٥')
    expect(toArabicDigits('1.5')).toBe('١.٥')
    expect(toArabicDigits(-3)).toBe('-٣')
  })
})

// Expected values from the reference normaliser (research/scripts/quran-text-api/search-normalize.ts, §4.3).
describe('normalizeForSearch', () => {
  it('matches Uthmani and simple spellings of the same words', () => {
    expect(normalizeForSearch('ٱلْكِتَـٰبُ')).toBe('الكتب')
    expect(normalizeForSearch('يَـٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا۟')).toBe('يايها الذين امنوا')
    expect(normalizeForSearch('يا أيها الذين آمنوا')).toBe('يا ايها الذين امنوا')
    expect(normalizeForSearch('الصَّلَوٰةَ')).toBe('الصلوه')
    expect(normalizeForSearch('ٱلرَّحْمَـٰنِ')).toBe('الرحمن')
  })
  it('drops pause marks, ۞ ۩ ۝, digits, tatweel and format characters', () => {
    expect(normalizeForSearch('رَيْبَ ۛ فِيهِ ۛ')).toBe('ريب فيه')
    expect(normalizeForSearch('۞ إِنَّ')).toBe('ان')
    expect(normalizeForSearch('﻿بِسْمِ‏ ١')).toBe('بسم')
    expect(normalizeForSearch('خُشُوعًا ۩')).toBe('خشوعا')
    expect(normalizeForSearch('۝٢٥٥')).toBe('')
  })
  it('folds hamza/alef/ya/ta-marbuta forms and collapses spaces', () => {
    expect(normalizeForSearch('إيمان')).toBe('ايمان')
    expect(normalizeForSearch('مؤمن')).toBe('مومن')
    expect(normalizeForSearch('رحمة')).toBe('رحمه')
    expect(normalizeForSearch('على  ی ک')).toBe('علي ي ك')
    expect(normalizeForSearch('شَىْءٍ')).toBe('شي')
    expect(normalizeForSearch('  ')).toBe('')
    expect(normalizeForSearch(null as unknown as string)).toBe('')
  })
  it('never reorders marks (no NFC/NFD): shadda-before-fatha text still matches', () => {
    expect(normalizeForSearch('ٱللَّهِ')).toBe('الله')
    expect(normalizeForSearch('اللَّهِ')).toBe('الله')
  })
  it('makes every real fixture word mark-free', () => {
    const marks = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/
    for (const key of ['2:255', '4:43', '36:52', '2:245', '18:1']) {
      for (const w of fixtureAyah(key).words) expect(normalizeForSearch(w.text)).not.toMatch(marks)
    }
  })
})
