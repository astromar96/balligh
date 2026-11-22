// Quran text sources behind one interface (PLAN "Research outcomes": hide api.quran.com — QF's legacy
// unauthenticated host — behind a QuranDataSource; fallback for text + tajweed is api.alquran.cloud).
// Display text = qpcToStandard(words[].text_qpc_hafs) (Amiri Quran; research/00-gaps.md §0.1, §2.2); Tanzil's
// words[].text_uthmani drives the §3.7 grouping and the pause guard (D1); tajweed classes are projected from the
// verse-level text_uthmani_tajweed (text.ts). The alquran.cloud fallback maps its Tanzil text to the same encoding.
// research/quran-text-api.md §1.4, §2, §3.7; 00-gaps §2.5 (canonical request), §2.10 (pages of 50).
import type { Ayah, Surah, VerseKey } from '../core/types'
import { AsyncMemo, PER_PAGE, QF_TTL_MS, fetchPages, firstAvailable, fetchJson, type PagedBody, type Provider } from './http'
import { versesIn } from './meta'
import { buildWords, parseAlquranCloudTajweed, parseQuranComTajweed, skeleton, type WordSource } from './text'

export const QURAN_COM_API = 'https://api.quran.com/api/v4'
export const ALQURAN_CLOUD_API = 'https://api.alquran.cloud/v1'

/** alquran.cloud terms allow storing; keep it as long as QF content so both sources age alike. */
const ALQURAN_CLOUD_TTL_MS = QF_TTL_MS

export interface QuranDataSource {
  id: string
  surahs(signal?: AbortSignal): Promise<Surah[]>
  ayahs(surah: number, signal?: AbortSignal): Promise<Ayah[]>
}

export class DataFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataFormatError'
  }
}

const SAJDAH_SIGN = '\u{06E9}'

// ───────────────────────── Quran.com v4 ─────────────────────────

interface QcChapter {
  id: number
  revelation_place: string
  bismillah_pre: boolean
  name_simple: string
  name_arabic: string
  verses_count: number
  translated_name?: { name?: string }
}

export function surahsFromQuranCom(json: unknown): Surah[] {
  const chapters = (json as { chapters?: QcChapter[] })?.chapters
  if (!Array.isArray(chapters) || chapters.length !== 114) throw new DataFormatError('chapters: expected 114')
  return chapters
    .map((c) => ({
      number: Number(c.id),
      nameArabic: String(c.name_arabic),
      nameSimple: String(c.name_simple),
      nameTranslated: String(c.translated_name?.name ?? c.name_simple),
      versesCount: Number(c.verses_count),
      revelationPlace: c.revelation_place === 'madinah' ? ('madinah' as const) : ('makkah' as const),
      bismillahPre: Boolean(c.bismillah_pre),
    }))
    .sort((a, b) => a.number - b.number)
}

interface QcWord {
  position: number
  char_type_name: string
  text_uthmani?: string
  text_qpc_hafs?: string
}

interface QcVerse {
  verse_number: number
  verse_key: string
  juz_number: number
  page_number: number
  sajdah_number: number | null
  text_uthmani_tajweed?: string
  words?: QcWord[]
}

interface QcVersesPage extends PagedBody {
  verses?: QcVerse[]
  pagination?: { per_page?: unknown; current_page?: unknown; next_page?: unknown; total_pages?: unknown; total_records?: unknown } | null
}

/**
 * Diagnostics (tests, the data lab): verses whose tajweed markup could not be aligned, and verses that came without
 * words[].text_qpc_hafs (displayed from their Tanzil text instead, mapped like the fallback).
 */
export const textDiagnostics = { alignmentFailures: 0, versesBuilt: 0, qpcMissing: 0 }

export function ayahFromQuranComVerse(surah: number, v: QcVerse): Ayah {
  const words = (v.words ?? []).filter((w) => w.char_type_name === 'word').sort((a, b) => a.position - b.position)
  if (words.length === 0) throw new DataFormatError(`${v.verse_key}: no words`)
  words.forEach((w, i) => {
    if (w.position !== i + 1) throw new DataFormatError(`${v.verse_key}: word positions not contiguous`)
    if (typeof w.text_uthmani !== 'string') throw new DataFormatError(`${v.verse_key}: words[].text_uthmani missing`)
  })
  const texts = words.map((w) => w.text_uthmani as string)
  // one encoding per verse: QPC when every word has it, else the Tanzil text mapped (never a mix)
  const qpc = words.every((w) => typeof w.text_qpc_hafs === 'string' && w.text_qpc_hafs.trim().length > 0)
  const sources: WordSource[] = words.map((w) => ({ tanzil: w.text_uthmani as string, qpc: qpc ? (w.text_qpc_hafs as string) : null }))
  const tajweed = typeof v.text_uthmani_tajweed === 'string' ? parseQuranComTajweed(v.text_uthmani_tajweed) : null
  const built = buildWords(sources, tajweed)
  textDiagnostics.versesBuilt++
  if (!qpc) textDiagnostics.qpcMissing++
  if (built.alignmentFailed) textDiagnostics.alignmentFailures++
  return {
    key: `${surah}:${v.verse_number}` as VerseKey,
    surah,
    number: Number(v.verse_number),
    words: built.words,
    juz: Number(v.juz_number),
    page: Number(v.page_number),
    sajdah: v.sajdah_number != null || texts.some((t) => t.includes(SAJDAH_SIGN)),
  }
}

export function ayahsFromQuranComPages(surah: number, pages: unknown[]): Ayah[] {
  const verses: QcVerse[] = []
  for (const p of pages) {
    const vs = (p as QcVersesPage)?.verses
    if (!Array.isArray(vs)) throw new DataFormatError(`surah ${surah}: no verses`)
    verses.push(...vs)
  }
  verses.sort((a, b) => a.verse_number - b.verse_number)
  const total = Number((pages[0] as QcVersesPage)?.pagination?.total_records)
  if (Number.isInteger(total) && total !== verses.length) throw new DataFormatError(`surah ${surah}: ${verses.length}/${total} verses`)
  if (verses.length !== versesIn(surah)) throw new DataFormatError(`surah ${surah}: ${verses.length} verses, expected ${versesIn(surah)}`)
  verses.forEach((v, i) => {
    if (Number(v.verse_number) !== i + 1) throw new DataFormatError(`surah ${surah}: verse numbers not contiguous`)
  })
  return verses.map((v) => ayahFromQuranComVerse(surah, v))
}

/** The canonical text request (00-gaps §2.5): pages of 50 verses, verse tajweed, Tanzil + QPC word texts. */
export function quranComVersesUrl(surah: number, page = 1): string {
  return `${QURAN_COM_API}/verses/by_chapter/${surah}?words=true&per_page=${PER_PAGE}&page=${page}&fields=text_uthmani_tajweed&word_fields=text_uthmani,text_qpc_hafs`
}

export const QURAN_COM_SOURCE: QuranDataSource = {
  id: 'quran.com',
  async surahs(signal) {
    return surahsFromQuranCom(await fetchJson(`${QURAN_COM_API}/chapters?language=en`, { signal, ttlMs: QF_TTL_MS }))
  },
  async ayahs(surah, signal) {
    const pages = await fetchPages<QcVersesPage>((page) => quranComVersesUrl(surah, page), 1, versesIn(surah), { signal, ttlMs: QF_TTL_MS })
    return ayahsFromQuranComPages(surah, pages)
  },
}

// ───────────────────────── alquran.cloud (Tanzil text) ─────────────────────────

interface AqcSurahMeta {
  number: number
  name: string
  englishName: string
  englishNameTranslation: string
  numberOfAyahs: number
  revelationType: string
}

const MARKS = /[\p{M}\u{0640}]/gu

export function surahsFromAlquranCloud(json: unknown): Surah[] {
  const data = (json as { data?: AqcSurahMeta[] })?.data
  if (!Array.isArray(data) || data.length !== 114) throw new DataFormatError('alquran.cloud surah list: expected 114')
  return data.map((s) => {
    const n = Number(s.number)
    const arabic = String(s.name).replace(MARKS, '').replace(/\u{0671}/gu, '\u{0627}').replace(/^سورة\s+/u, '').trim()
    return {
      number: n,
      nameArabic: arabic,
      nameSimple: String(s.englishName),
      nameTranslated: String(s.englishNameTranslation),
      versesCount: Number(s.numberOfAyahs),
      revelationPlace: /medin/i.test(s.revelationType) ? ('madinah' as const) : ('makkah' as const),
      bismillahPre: n !== 1 && n !== 9,
    }
  })
}

const BASMALA_SKELETON = skeleton('بسم الله الرحمن الرحيم')
const INVISIBLE_G = /[\u{200B}-\u{200F}\u{2060}\u{FEFF}]/gu
/** Quran.com keeps these as ONE word; the Tanzil text has two tokens (quran-text-api §1.4). */
const TANZIL_MERGES: Readonly<Record<string, { index: number; skeleton: string }>> = {
  '37:130': { index: 2, skeleton: 'الياسين' },
}

/**
 * Words of a Tanzil Uthmani verse in Quran.com's segmentation: basmala prefix and BOM stripped, pause-mark and
 * ۩ tokens glued to the previous word after a space, ۞ glued to the next, 37:130 «إِلْ يَاسِينَ» merged.
 */
export function tanzilWords(text: string, surah: number, ayah: number): string[] {
  let tokens = text.replace(INVISIBLE_G, '').trim().split(/\s+/u).filter(Boolean)
  if (ayah === 1 && surah !== 1 && surah !== 9 && tokens.length > 4 && skeleton(tokens.slice(0, 4).join('')) === BASMALA_SKELETON) {
    tokens = tokens.slice(4)
  }
  const words: string[] = []
  let prefix = ''
  for (const tok of tokens) {
    if (skeleton(tok) === '') {
      if (tok.startsWith('\u{06DE}') || words.length === 0) prefix += `${tok} `
      else words[words.length - 1] += ` ${tok}`
      continue
    }
    words.push(prefix + tok)
    prefix = ''
  }
  const merge = TANZIL_MERGES[`${surah}:${ayah}`]
  if (merge && words.length > merge.index + 1 && skeleton(words[merge.index] + words[merge.index + 1]) === merge.skeleton) {
    words.splice(merge.index, 2, `${words[merge.index]} ${words[merge.index + 1]}`)
  }
  return words
}

interface AqcAyah {
  numberInSurah: number
  text: string
  juz: number
  page: number
  sajda: boolean | object
}

interface AqcEdition {
  edition?: { identifier?: string }
  ayahs?: AqcAyah[]
}

export function ayahsFromAlquranCloud(surah: number, json: unknown): Ayah[] {
  const data = (json as { data?: AqcEdition[] })?.data
  if (!Array.isArray(data)) throw new DataFormatError('alquran.cloud: no data')
  const uthmani = data.find((e) => e.edition?.identifier === 'quran-uthmani')?.ayahs
  const tajweed = data.find((e) => e.edition?.identifier === 'quran-tajweed')?.ayahs
  if (!Array.isArray(uthmani) || uthmani.length !== versesIn(surah)) throw new DataFormatError(`alquran.cloud ${surah}: expected ${versesIn(surah)} ayahs of quran-uthmani`)
  const tajweedByAyah = new Map<number, string>()
  for (const a of tajweed ?? []) tajweedByAyah.set(Number(a.numberInSurah), a.text)
  return uthmani.map((a, i) => {
    const number = Number(a.numberInSurah)
    if (number !== i + 1) throw new DataFormatError(`alquran.cloud ${surah}: ayah numbers not contiguous`)
    const texts = tanzilWords(a.text, surah, number)
    if (texts.length === 0) throw new DataFormatError(`alquran.cloud ${surah}:${number}: no words`)
    const raw = tajweedByAyah.get(number)
    // no QPC text here: the display is the Tanzil text mapped to the same encoding (text.ts tanzilToStandard)
    const sources: WordSource[] = texts.map((t) => ({ tanzil: t, qpc: null }))
    const built = buildWords(sources, raw === undefined ? null : parseAlquranCloudTajweed(raw.replace(INVISIBLE_G, '')))
    textDiagnostics.versesBuilt++
    if (built.alignmentFailed) textDiagnostics.alignmentFailures++
    return {
      key: `${surah}:${number}` as VerseKey,
      surah,
      number,
      words: built.words,
      juz: Number(a.juz),
      page: Number(a.page),
      sajdah: (a.sajda !== false && a.sajda != null) || texts.some((t) => t.includes(SAJDAH_SIGN)),
    }
  })
}

export const ALQURAN_CLOUD_SOURCE: QuranDataSource = {
  id: 'alquran.cloud',
  async surahs(signal) {
    return surahsFromAlquranCloud(await fetchJson(`${ALQURAN_CLOUD_API}/surah`, { signal, ttlMs: ALQURAN_CLOUD_TTL_MS }))
  },
  async ayahs(surah, signal) {
    const json = await fetchJson(`${ALQURAN_CLOUD_API}/surah/${surah}/editions/quran-uthmani,quran-tajweed`, { signal, ttlMs: ALQURAN_CLOUD_TTL_MS })
    return ayahsFromAlquranCloud(surah, json)
  },
}

// ───────────────────────── public API ─────────────────────────

export const QURAN_SOURCES: QuranDataSource[] = [QURAN_COM_SOURCE, ALQURAN_CLOUD_SOURCE]

const memo = new AsyncMemo(40)

function checkSurah(surah: number): void {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new RangeError(`surah must be 1..114, got ${surah}`)
}

export function fetchSurahsImpl(signal?: AbortSignal): Promise<Surah[]> {
  return memo.get(
    'surahs',
    QF_TTL_MS,
    async (s) => (await firstAvailable('surah list', QURAN_SOURCES.map((src): Provider<Surah[]> => ({ id: src.id, run: () => src.surahs(s) })), s)).value,
    signal,
  )
}

export async function fetchAyahsImpl(surah: number, signal?: AbortSignal): Promise<Ayah[]> {
  checkSurah(surah)
  return memo.get(
    `ayahs:${surah}`,
    QF_TTL_MS,
    async (s) => (await firstAvailable(`surah ${surah}`, QURAN_SOURCES.map((src): Provider<Ayah[]> => ({ id: src.id, run: () => src.ayahs(surah, s) })), s)).value,
    signal,
  )
}

/** Drops parsed text kept in memory (tests). */
export function clearQuranMemo(): void {
  memo.clear()
}
