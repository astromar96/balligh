// Test helper: contract-shaped ayahs from ayahs.json (real Quran.com words; see its _source).
import type { Ayah, Surah } from '../../core/types'
import json from './ayahs.json'

const SURAHS = json.surahs as unknown as Record<string, Ayah[]>

/** Ayahs of a surah in the fixture: 1 (whole), 2 (255–257 only), 112 (whole). */
export function fixtureAyahs(surah: 1 | 2 | 112): Ayah[] {
  return SURAHS[String(surah)].map((a) => ({ ...a, words: a.words.map((w) => ({ ...w })) }))
}

export const SURAH_LIST: Surah[] = [
  { number: 1, nameArabic: 'الفاتحة', nameSimple: 'Al-Fatihah', nameTranslated: 'The Opener', versesCount: 7, revelationPlace: 'makkah', bismillahPre: false },
  { number: 2, nameArabic: 'البقرة', nameSimple: 'Al-Baqarah', nameTranslated: 'The Cow', versesCount: 286, revelationPlace: 'madinah', bismillahPre: true },
  { number: 3, nameArabic: 'آل عمران', nameSimple: "Ali 'Imran", nameTranslated: 'Family of Imran', versesCount: 200, revelationPlace: 'madinah', bismillahPre: true },
  { number: 9, nameArabic: 'التوبة', nameSimple: 'At-Tawbah', nameTranslated: 'The Repentance', versesCount: 129, revelationPlace: 'madinah', bismillahPre: false },
  { number: 20, nameArabic: 'طه', nameSimple: 'Taha', nameTranslated: 'Ta-Ha', versesCount: 135, revelationPlace: 'makkah', bismillahPre: true },
  { number: 21, nameArabic: 'الأنبياء', nameSimple: 'Al-Anbya', nameTranslated: 'The Prophets', versesCount: 112, revelationPlace: 'makkah', bismillahPre: true },
  { number: 55, nameArabic: 'الرحمن', nameSimple: 'Ar-Rahman', nameTranslated: 'The Beneficent', versesCount: 78, revelationPlace: 'madinah', bismillahPre: true },
  { number: 112, nameArabic: 'الإخلاص', nameSimple: 'Al-Ikhlas', nameTranslated: 'The Sincerity', versesCount: 4, revelationPlace: 'makkah', bismillahPre: true },
]
