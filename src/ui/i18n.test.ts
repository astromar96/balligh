import { countLabel, formatNumber, isRtl, missingKeys, pluralAr, translate } from './i18n'

it('has every message in both languages', () => {
  expect(missingKeys()).toEqual({ ar: [], en: [] })
})

describe('translate', () => {
  it('fills parameters, writing numbers in Arabic-Indic digits for Arabic', () => {
    expect(translate('ar', 'warnLong', { n: 150 })).toContain('١٥٠')
    expect(translate('en', 'warnLong', { n: 150 })).toContain('150')
    expect(translate('ar', 'durationLabel', { time: '١:٢٣' })).toBe('المدة ١:٢٣')
  })

  it('leaves an unknown parameter visible instead of dropping it', () => {
    expect(translate('en', 'durationLabel', {})).toBe('Length {time}')
  })
})

describe('counts', () => {
  const forms = { one: 'آية', two: 'آيتان', few: 'آيات', many: 'آية' }

  it('picks the Arabic count form', () => {
    expect(pluralAr(1, forms)).toBe('آية')
    expect(pluralAr(2, forms)).toBe('آيتان')
    expect(pluralAr(3, forms)).toBe('آيات')
    expect(pluralAr(10, forms)).toBe('آيات')
    expect(pluralAr(11, forms)).toBe('آية')
    expect(pluralAr(103, forms)).toBe('آيات')
    expect(pluralAr(286, forms)).toBe('آية')
  })

  it('labels counts in both languages', () => {
    expect(countLabel('ar', 1, 'ayah')).toBe('آية')
    expect(countLabel('ar', 2, 'word')).toBe('كلمتان')
    expect(countLabel('ar', 7, 'ayah')).toBe('٧ آيات')
    expect(countLabel('ar', 286, 'ayah')).toBe('٢٨٦ آية')
    expect(countLabel('en', 1, 'ayah')).toBe('1 verse')
    expect(countLabel('en', 50, 'word')).toBe('50 words')
    expect(countLabel('ar', 2, 'image')).toBe('صورتان')
    expect(countLabel('ar', 3, 'image')).toBe('٣ صور')
    expect(countLabel('ar', 12, 'image')).toBe('١٢ صورة')
    expect(countLabel('en', 3, 'image')).toBe('3 images')
  })
})

it('knows the reading direction and the digits of each language', () => {
  expect(isRtl('ar')).toBe(true)
  expect(isRtl('en')).toBe(false)
  expect(formatNumber('ar', 42)).toBe('٤٢')
  expect(formatNumber('en', 42)).toBe('42')
})
