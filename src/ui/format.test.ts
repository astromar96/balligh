import { ayahOrnament, fileBaseName, foldArabic, foldLatin, formatClock, formatMegabytes, fromIndic, keepHyphens, parseCount, toIndic } from './format'

describe('digits', () => {
  it('writes Arabic-Indic digits and reads all three digit sets back', () => {
    expect(toIndic('255–256')).toBe('٢٥٥–٢٥٦')
    expect(fromIndic('٢٥٥')).toBe('255')
    expect(fromIndic('۲۵۶')).toBe('256')
  })

  it('parses a positive count typed in any digit set, else null', () => {
    expect(parseCount('٢٥٦')).toBe(256)
    expect(parseCount(' 7 ')).toBe(7)
    expect(parseCount('آية ١٢')).toBe(12)
    expect(parseCount('')).toBeNull()
    expect(parseCount('0')).toBeNull()
    expect(parseCount('abc')).toBeNull()
  })
})

describe('formatClock', () => {
  it('rounds to seconds and pads them', () => {
    expect(formatClock(83_400, false)).toBe('1:23')
    expect(formatClock(5_000, false)).toBe('0:05')
    expect(formatClock(-20, false)).toBe('0:00')
  })

  it('uses Arabic-Indic digits for Arabic', () => {
    expect(formatClock(83_400, true)).toBe('١:٢٣')
  })
})

describe('formatMegabytes', () => {
  it('keeps one decimal under 10 MB and uses the Arabic decimal separator', () => {
    expect(formatMegabytes(1.5 * 1024 * 1024, false)).toBe('1.5')
    expect(formatMegabytes(1.5 * 1024 * 1024, true)).toBe('١٫٥')
    expect(formatMegabytes(23.4 * 1024 * 1024, false)).toBe('23')
  })
})

it('builds the ayah-end ornament from U+06DD and Arabic-Indic digits', () => {
  expect(ayahOrnament(255)).toBe('۝٢٥٥')
})

describe('search folding', () => {
  it('drops harakat and unifies alef, yeh and teh marbuta forms', () => {
    expect(foldArabic('ٱلْبَقَرَةِ')).toBe('البقره')
    expect(foldArabic('آل عِمْرَان')).toBe('ال عمران')
    expect(foldArabic('الأَنْبِيَاء')).toBe('الانبياء')
    expect(foldArabic('طه')).toBe('طه')
  })

  it('lower-cases Latin and drops punctuation and accents', () => {
    expect(foldLatin('Al-Baqarah')).toBe('albaqarah')
    expect(foldLatin("Āli 'Imrān")).toBe('aliimran')
  })
})

describe('fileBaseName', () => {
  it('names the file after the surah and the ayah range', () => {
    expect(fileBaseName('Al-Baqarah', 255, 256)).toBe('Al-Baqarah-255-256')
    expect(fileBaseName('Al-Ikhlas', 1, 1)).toBe('Al-Ikhlas-1')
  })

  it('keeps transliterations readable and falls back when nothing is left', () => {
    expect(fileBaseName('Āl ʿImrān', 1, 2)).toBe('Al-Imran-1-2')
    expect(fileBaseName("Ali 'Imran", 3, 3)).toBe('Ali-Imran-3')
    expect(fileBaseName('البقرة', 1, 5)).toBe('Quran-1-5')
  })
})

it('joins hyphenated names so a wrapped title breaks at spaces only', () => {
  expect(keepHyphens('Al-Fatihah')).toBe('Al-\u2060Fatihah')
  expect(keepHyphens("Ali 'Imran")).toBe("Ali 'Imran")
  expect(keepHyphens('Al-Fatihah').replace(/\u2060/g, '')).toBe('Al-Fatihah')
})
