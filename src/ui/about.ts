// What «عن بلّغ والمصادر» lists: every source and licence the app depends on (research/00-gaps.md §6.2,
// tafsir-translation §10, the Tanzil text licence). Reciter and tafsir names come from the data catalogue, so the
// sheet stays in step with what the app actually offers. Pure (no React): unit-tested in about.test.ts.
import type { Reciter, TafsirSource } from '../core/types'
import type { Language, MessageKey } from './i18n'

export interface SourceItem {
  /** proper name, shown as written (Latin or Arabic) */
  name: string
  url: string | null
  /** what it gives the app */
  role: string
  /** licence or terms, when there is one to state */
  licence: string | null
  /** where the licence or terms can be read */
  licenceUrl?: string
}

export interface SourceGroup {
  title: MessageKey
  /** one line before the items (e.g. the QuranEnc no-modification rule) */
  note: string | null
  items: SourceItem[]
}

const QF_TERMS = 'https://api-docs.quran.foundation/legal/developer-terms/'

type Bi = { ar: string; en: string }
const pick = (lang: Language, b: Bi) => (lang === 'ar' ? b.ar : b.en)

/** Names joined in the UI's list style: «أ، ب وج» / "A, B and C". */
export function joinNames(lang: Language, names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  const and = lang === 'ar' ? ' و' : ' and '
  return names.slice(0, -1).join(lang === 'ar' ? '، ' : ', ') + and + names[names.length - 1]
}

export function aboutGroups(lang: Language, reciters: readonly Reciter[], tafsirs: readonly TafsirSource[]): SourceGroup[] {
  const names = (cls: Reciter['timingClass']) => joinNames(lang, reciters.filter((r) => r.timingClass === cls).map((r) => (lang === 'ar' ? r.nameAr : r.nameEn)))
  const wordTimed = reciters.filter((r) => r.timingClass === 'A').length
  const qfLicence = pick(lang, { ar: 'شروط المطوّرين لمؤسسة القرآن: تُحفظ مؤقتًا ستة أيام على الأكثر', en: 'Quran Foundation developer terms: cached for six days at most' })
  const ofl = 'SIL Open Font License 1.1'
  const item = (name: string, url: string | null, role: Bi, licence: Bi | string | null = null, licenceUrl?: string): SourceItem => ({
    name,
    url,
    role: pick(lang, role),
    licence: licence === null ? null : typeof licence === 'string' ? licence : pick(lang, licence),
    ...(licenceUrl ? { licenceUrl } : {}),
  })

  return [
    {
      title: 'aboutText',
      note: null,
      items: [
        item(
          'Quran.com / Quran Foundation',
          'https://quran.com',
          {
            ar: 'نص المصحف برواية حفص عن عاصم بخط مجمع الملك فهد (QPC)، وتلوين أحكام التجويد، وتوقيت كلمات التلاوة، وعدد من التفاسير والترجمات.',
            en: 'The Mushaf text in the Hafs ‘an ‘Asim reading (the King Fahd Complex QPC script), the tajweed markup, recitation word timings, and several tafsir works and translations.',
          },
          qfLicence,
          QF_TERMS,
        ),
        item(
          'Tanzil Project',
          'https://tanzil.net',
          {
            ar: 'علامات الوقف التي يعتمد عليها تنبيه القطع، والنص الاحتياطي حين يتعذّر Quran.com (عبر AlQuran.cloud).',
            en: 'The pause marks the cut guard relies on, and the fallback text when Quran.com cannot be reached (through AlQuran.cloud).',
          },
          { ar: 'رخصة CC BY 3.0، والنص لا يُغيَّر', en: 'CC BY 3.0; the text is never changed' },
          'https://creativecommons.org/licenses/by/3.0/',
        ),
        item(
          lang === 'ar' ? 'مصحف التجويد الملوّن — مجمع الملك فهد لطباعة المصحف الشريف' : 'Colour-coded tajweed Mushaf — King Fahd Glorious Quran Printing Complex',
          'https://qurancomplex.gov.sa',
          {
            ar: 'ألوان أحكام التجويد على نظامه (ألوان خطوط QCF V4)، وكل شرح لحكم يذكر مرجعه من تحفة الأطفال وكتب التجويد برواية حفص.',
            en: 'The tajweed colours follow its scheme (the QCF V4 palette); each rule’s explanation names its reference, from Tuhfat al-Atfal and standard Hafs tajweed works.',
          },
        ),
      ],
    },
    {
      title: 'aboutAudio',
      note: null,
      items: [
        item('EveryAyah.com', 'https://everyayah.com', {
          ar: 'ملفات التلاوة آيةً آية لأكثر القرّاء، والاستعاذة بصوت القارئ نفسه.',
          en: 'Verse-by-verse recitation files for most reciters, and the isti‘adha in each reciter’s own voice.',
        }),
        item(
          'QuranicAudio.com (Quran Foundation)',
          'https://quranicaudio.com',
          { ar: `تلاوات السور كاملةً مع توقيت كلماتها: ${names('B')}.`, en: `Whole-surah recitations with their word timings: ${names('B')}.` },
          qfLicence,
          QF_TERMS,
        ),
        item('mp3quran.net', 'https://mp3quran.net', {
          ar: `تلاوات السور كاملةً مع توقيت آياتها: ${names('D')}.`,
          en: `Whole-surah recitations with their verse timings: ${names('D')}.`,
        }),
        item(
          lang === 'ar' ? 'quran-align — كولن فير' : 'quran-align — Collin Fair',
          'https://github.com/cpfair/quran-align',
          {
            ar: `توقيت كلمات التلاوة لـ${wordTimed} قارئًا، يصل عبر Quran.com.`,
            en: `Word timings for ${wordTimed} reciters, served through Quran.com.`,
          },
          'CC BY 4.0',
          'https://creativecommons.org/licenses/by/4.0/',
        ),
      ],
    },
    {
      title: 'aboutTafsir',
      note: pick(lang, {
        ar: 'يظهر التفسير كما نشره مصدره بلا حذف ولا تعديل ولا إضافة، ويُذكر في كل مقطع اسم الكتاب وناشره ومصدره ورقم إصداره، ويُقسَّم على صفحات إذا طال.',
        en: 'Tafsir appears exactly as its source publishes it, with nothing cut, edited or added; every clip names the work, its publisher, the source and its version, and a long passage is split over pages.',
      }),
      items: [
        item(
          'QuranEnc.com',
          'https://quranenc.com',
          { ar: 'المختصر في تفسير القرآن الكريم (مركز تفسير للدراسات القرآنية) والتفسير الميسر.', en: 'Al-Mukhtasar (Tafsir Center for Quranic Studies) and Al-Muyassar.' },
          { ar: 'يُعاد نشره بلا تعديل، مع ذكر الناشر والمصدر ورقم الإصدار', en: 'Republished unmodified, naming the publisher, the source and the version' },
        ),
        item(
          lang === 'ar' ? 'QUL عبر spa5k/tafsir_api' : 'QUL via spa5k/tafsir_api',
          'https://github.com/spa5k/tafsir_api',
          { ar: 'نصوص التفاسير الكاملة، ومنها القرطبي والطبري والجلالين.', en: 'Complete tafsir texts, including al-Qurtubi, al-Tabari and al-Jalalayn.' },
          { ar: 'الأداة بترخيص MIT، والنصوص لأصحابها', en: 'The tool is MIT; the texts belong to their authors' },
        ),
        item(
          'Quranpedia',
          'https://quranpedia.net',
          { ar: 'كتب أحكام القرآن، ونسخة احتياطية لبعض التفاسير.', en: 'The Ahkam al-Quran books, and a fallback copy of some tafsir works.' },
          { ar: 'مجانية في التطبيقات، والأعمال المعاصرة لأصحابها', en: 'Free in apps; contemporary works belong to their publishers' },
        ),
        ...tafsirs.map((t) => ({ name: lang === 'ar' ? t.nameAr : t.nameEn, url: null, role: t.creditAr, licence: null })),
      ],
    },
    {
      title: 'aboutTranslations',
      note: null,
      items: [
        item(lang === 'ar' ? 'Quran.com وQuranEnc.com' : 'Quran.com and QuranEnc.com', null, {
          ar: 'الترجمات، ويُذكر اسم المترجم في كل مقطع. تُكتب كل ترجمة بخط Noto الخاص بلغتها.',
          en: 'The translations; every clip names its translator. Each is drawn in the Noto typeface of its script.',
        }),
      ],
    },
    {
      title: 'aboutFonts',
      note: null,
      items: [
        item('Amiri Quran', 'https://github.com/aliftype/amiri', { ar: 'خط نص القرآن، لخالد حسني.', en: 'The Quran text typeface, by Khaled Hosny.' }, ofl),
        item('Readex Pro', 'https://fonts.google.com/specimen/Readex+Pro', { ar: 'خط الواجهة.', en: 'The interface typeface.' }, ofl),
        item('Reem Kufi', 'https://fonts.google.com/specimen/Reem+Kufi', { ar: 'اسم التطبيق وعناوين الأقسام.', en: 'The app name and section titles.' }, ofl),
        item('Noto', 'https://fonts.google.com/noto', { ar: 'خطوط الترجمات بحسب كتابتها (عبر fontsource).', en: 'The translation typefaces, one per script (through fontsource).' }, ofl),
        item('Feather', 'https://feathericons.com', { ar: 'الأيقونات.', en: 'The icons.' }, 'MIT'),
      ],
    },
    {
      title: 'aboutSoftware',
      note: null,
      items: [
        item(lang === 'ar' ? 'Expo وReact Native' : 'Expo and React Native', 'https://expo.dev', { ar: 'إطار التطبيق.', en: 'The app framework.' }, 'MIT'),
        item('HarfBuzz (harfbuzzjs)', 'https://harfbuzz.github.io', { ar: 'تشكيل حروف القرآن لرسمها بدقة.', en: 'Shapes the Quran text so it is drawn exactly.' }, 'MIT'),
        item('Mediabunny', 'https://mediabunny.dev', { ar: 'صنع ملف الفيديو MP4 على الجهاز.', en: 'Makes the MP4 video on the device.' }, 'MPL-2.0'),
        item(
          lang === 'ar' ? 'مرمّز AAC من FFmpeg' : 'FFmpeg AAC encoder',
          'https://ffmpeg.org',
          {
            ar: 'يرمّز صوت الفيديو حين لا يدعمه المتصفح؛ يُحمَّل ملفًّا منفصلًا عند الحاجة فقط، فيمكن استبداله.',
            en: 'Encodes the video’s sound when the browser cannot; loaded as a separate file only when needed, so it can be replaced.',
          },
          { ar: 'LGPL-2.1 أو أحدث، والمصدر على ffmpeg.org', en: 'LGPL-2.1 or later; source at ffmpeg.org' },
        ),
      ],
    },
  ]
}
