// Translations (research/tafsir-translation.md §1.2, §7). Quran.com v4 /translations/{id}/by_chapter/{s} in pages
// of 50 (research/00-gaps.md §2.10: only the pages that hold the ayahs), footnote markers stripped. QuranEnc is
// the fallback where it carries the same translator's edition. Every edition declares the ISO 15924 script of
// its text (the renderer picks the Noto family for it, 00-gaps §6.4); its direction follows from the script, and
// both were checked against the live text of every edition (live.test.ts: textScript / textDirection, §2.11).
import type { TranslationEntry, TranslationSource } from '../core/types'
import { QF_TTL_MS, DAY_MS, PER_PAGE, firstAvailable, fetchJson, fetchPages, throwIfAborted, type PagedBody, type Provider } from './http'
import { decodeEntities } from './tafsir'
import { checkRange } from './meta'

const QURAN_COM = 'https://api.quran.com/api/v4'
const QURANENC = 'https://quranenc.com/api/v1'
/** QuranEnc answers no-store; a week in the app, like its tafsir (cache-policy.json: quranenc.com 7 days). */
const QURANENC_TTL_MS = 7 * DAY_MS

// ───────────────────────── script and direction of a text (00-gaps §2.11) ─────────────────────────

const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thaana}\p{Script=Nko}\p{Script=Syriac}]/u
/** ISO 15924 scripts written right to left (the ones Quran.com translations use, plus Syriac) */
const RTL_SCRIPTS: ReadonlySet<string> = new Set(['Arab', 'Hebr', 'Thaa', 'Nkoo', 'Syrc'])

/**
 * Direction of a text from its first letter: Arabic, Hebrew, Thaana, N'Ko or Syriac → rtl (00-gaps §2.11; the
 * /resources/languages direction is wrong or missing for 10 editions). Empty or letterless text → ltr.
 */
export function textDirection(text: string): 'ltr' | 'rtl' {
  const first = /\p{L}/u.exec(text)?.[0] ?? ''
  return RTL_LETTER.test(first) ? 'rtl' : 'ltr'
}

/** Direction of a script code ("Arab" → rtl). */
export function scriptDirection(script: string): 'ltr' | 'rtl' {
  return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr'
}

const SCRIPT_LETTERS: readonly (readonly [string, RegExp])[] = [
  ['Latn', /\p{Script=Latin}/u],
  ['Arab', /\p{Script=Arabic}/u],
  ['Cyrl', /\p{Script=Cyrillic}/u],
  ['Grek', /\p{Script=Greek}/u],
  ['Hebr', /\p{Script=Hebrew}/u],
  ['Thaa', /\p{Script=Thaana}/u],
  ['Nkoo', /\p{Script=Nko}/u],
  ['Syrc', /\p{Script=Syriac}/u],
  ['Beng', /\p{Script=Bengali}/u],
  ['Deva', /\p{Script=Devanagari}/u],
  ['Taml', /\p{Script=Tamil}/u],
  ['Mlym', /\p{Script=Malayalam}/u],
  ['Gujr', /\p{Script=Gujarati}/u],
  ['Telu', /\p{Script=Telugu}/u],
  ['Knda', /\p{Script=Kannada}/u],
  ['Sinh', /\p{Script=Sinhala}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Khmr', /\p{Script=Khmer}/u],
  ['Ethi', /\p{Script=Ethiopic}/u],
  ['Hang', /\p{Script=Hangul}/u],
  ['Hira', /\p{Script=Hiragana}/u],
  ['Kana', /\p{Script=Katakana}/u],
  ['Hani', /\p{Script=Han}/u],
]

/**
 * The ISO 15924 script most letters of a text are written in; Japanese (Han with kana) → "Jpan", Korean (Hangul,
 * with or without Han) → "Kore", Han alone → "Hans" (the Chinese editions offered are simplified). null without
 * letters. Checks the script each edition declares.
 */
export function textScript(text: string): string | null {
  const counts = new Map<string, number>()
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue
    const hit = SCRIPT_LETTERS.find(([, re]) => re.test(ch))
    if (hit) counts.set(hit[0], (counts.get(hit[0]) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  if (counts.has('Hira') || counts.has('Kana')) return 'Jpan'
  if (counts.has('Hang')) return 'Kore'
  let best = ''
  let max = 0
  for (const [script, n] of counts) {
    if (n > max) {
      best = script
      max = n
    }
  }
  return best === 'Hani' ? 'Hans' : best
}

// ───────────────────────── editions ─────────────────────────

interface TranslationDef extends Omit<TranslationSource, 'dir'> {
  /** same translator's edition on QuranEnc (fallback), verified in /translations/list on 2026-11-21 */
  quranEnc?: string
}

/**
 * Verified present in /resources/translations on 2026-11-21 (The Clear Quran, 131, is not public). Default first
 * per language. `script` checked against each edition's live text (101 Uzbek is Cyrillic, on QuranEnc too).
 */
const DEFS: TranslationDef[] = [
  { id: 20, lang: 'en', langName: 'English', name: 'Saheeh International', script: 'Latn', quranEnc: 'english_saheeh' },
  { id: 85, lang: 'en', langName: 'English', name: 'M.A.S. Abdel Haleem', script: 'Latn' },
  { id: 203, lang: 'en', langName: 'English', name: 'Al-Hilali & Khan', script: 'Latn', quranEnc: 'english_hilali_khan' },
  { id: 19, lang: 'en', langName: 'English', name: 'M. Pickthall', script: 'Latn' },
  { id: 22, lang: 'en', langName: 'English', name: 'A. Yusuf Ali', script: 'Latn' },
  { id: 31, lang: 'fr', langName: 'Français', name: 'Muhammad Hamidullah', script: 'Latn' },
  { id: 779, lang: 'fr', langName: 'Français', name: 'Rashid Maash', script: 'Latn', quranEnc: 'french_rashid' },
  { id: 54, lang: 'ur', langName: 'اردو', name: 'Maulana Muhammad Junagarhi', script: 'Arab', quranEnc: 'urdu_junagarhi' },
  { id: 234, lang: 'ur', langName: 'اردو', name: 'Fatah Muhammad Jalandhari', script: 'Arab' },
  { id: 33, lang: 'id', langName: 'Bahasa Indonesia', name: 'Kementerian Agama RI', script: 'Latn', quranEnc: 'indonesian_affairs' },
  { id: 77, lang: 'tr', langName: 'Türkçe', name: 'Diyanet İşleri', script: 'Latn' },
  { id: 83, lang: 'es', langName: 'Español', name: 'Sheikh Isa Garcia', script: 'Latn', quranEnc: 'spanish_garcia' },
  { id: 27, lang: 'de', langName: 'Deutsch', name: 'Frank Bubenheim & Nadeem Elyas', script: 'Latn', quranEnc: 'german_bubenheim' },
  { id: 39, lang: 'ms', langName: 'Bahasa Melayu', name: 'Abdullah Muhammad Basmeih', script: 'Latn' },
  { id: 161, lang: 'bn', langName: 'বাংলা', name: 'Taisirul Quran', script: 'Beng' },
  { id: 45, lang: 'ru', langName: 'Русский', name: 'Эльмир Кулиев', script: 'Cyrl' },
  { id: 135, lang: 'fa', langName: 'فارسی', name: 'IslamHouse.com', script: 'Arab' },
  { id: 122, lang: 'hi', langName: 'हिन्दी', name: 'Maulana Azizul Haque al-Umari', script: 'Deva', quranEnc: 'hindi_omari' },
  { id: 56, lang: 'zh', langName: '中文', name: 'Ma Jian', script: 'Hans' },
  { id: 218, lang: 'ja', langName: '日本語', name: 'Saeed Sato', script: 'Jpan', quranEnc: 'japanese_saeedsato' },
  { id: 219, lang: 'ko', langName: '한국어', name: 'Hamed Choi', script: 'Kore' },
  { id: 153, lang: 'it', langName: 'Italiano', name: 'Hamza Roberto Piccardo', script: 'Latn' },
  { id: 103, lang: 'pt', langName: 'Português', name: 'Helmi Nasr', script: 'Latn', quranEnc: 'portuguese_nasr' },
  { id: 49, lang: 'sw', langName: 'Kiswahili', name: 'Ali Muhsin Al-Barwani', script: 'Latn', quranEnc: 'swahili_barawani' },
  { id: 229, lang: 'ta', langName: 'தமிழ்', name: 'Sheikh Omar Sharif bin Abdul Salam', script: 'Taml', quranEnc: 'tamil_omar' },
  { id: 101, lang: 'uz', langName: 'Ўзбекча', name: 'Alauddin Mansour', script: 'Cyrl', quranEnc: 'uzbek_mansour' },
  { id: 126, lang: 'bs', langName: 'Bosanski', name: 'Besim Korkut', script: 'Latn' },
  { id: 89, lang: 'sq', langName: 'Shqip', name: 'Sherif Ahmeti', script: 'Latn' },
  { id: 235, lang: 'nl', langName: 'Nederlands', name: 'Malak Faris Abdalsalaam', script: 'Latn' },
]

export const TRANSLATION_LIST: TranslationSource[] = DEFS.map(({ quranEnc: _q, ...src }) => ({ ...src, dir: scriptDirection(src.script) }))

const PRESENTATION_FORMS = /[\u{FB50}-\u{FDFF}\u{FE70}-\u{FEFC}]/u

/**
 * Quran.com / QuranEnc translation text → plain text: footnote markers (<sup foot_note=…>n</sup>, [12], [١٢],
 * [১], ¹²³, glossary *) and any other tag removed, entities decoded, a leading "255. " / "(255) " ayah number
 * removed, spaces tidied. ZWNJ inside Persian words is kept. Arabic presentation forms (QuranEnc Urdu) are
 * NFKC-folded — on the translation line only, never on Quran text.
 */
export function cleanTranslation(raw: string, ayah?: number): string {
  let t = raw
    .replace(/<sup\b[^>]*foot_note[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  t = decodeEntities(t)
    .replace(/\s*\[[0-9\u{0660}-\u{0669}\u{06F0}-\u{06F9}\u{09E6}-\u{09EF}]+\]/gu, '')
    .replace(/[\u{00B9}\u{00B2}\u{00B3}\u{2070}-\u{2079}]+/gu, '')
    .replace(/\*/g, '')
  if (ayah !== undefined) t = t.replace(new RegExp(`^\\s*[\\(\\[]?${ayah}[\\)\\]]?[.:\\-\u{2013}]?\\s+`, 'u'), '')
  if (PRESENTATION_FORMS.test(t)) t = t.normalize('NFKC')
  return t.replace(/\s+([.,;:!?\u{060C}\u{061B}])/gu, '$1').replace(/\s{2,}/g, ' ').trim()
}

interface QcTranslationItem {
  resource_id?: number
  verse_key?: string
  verse_number?: number
  text?: string
}

interface QcTranslationPage extends PagedBody {
  translations?: QcTranslationItem[]
}

/** Page `page` (ayahs 50(page−1)+1 … 50·page) of a Quran.com translation of a surah. */
export function quranComTranslationUrl(translationId: number, surah: number, page = 1): string {
  return `${QURAN_COM}/translations/${translationId}/by_chapter/${surah}?per_page=${PER_PAGE}&page=${page}&fields=verse_key,verse_number`
}

/**
 * ayah → plain text of one Quran.com translation response (a by_chapter page). Items are keyed by verse_number,
 * else verse_key, else their position on the page (offset by the page's own pagination).
 */
export function translationsFromQuranCom(json: unknown, surah: number): Map<number, string> {
  const body = json as QcTranslationPage | null
  const items = body?.translations
  const out = new Map<number, string>()
  if (!Array.isArray(items)) return out
  const perPage = Number(body?.pagination?.per_page)
  const current = Number(body?.pagination?.current_page)
  const offset = Number.isInteger(perPage) && Number.isInteger(current) && current > 0 ? perPage * (current - 1) : 0
  items.forEach((it, i) => {
    let ayah = Number(it.verse_number)
    if (!Number.isInteger(ayah) && typeof it.verse_key === 'string') {
      const [s, a] = it.verse_key.split(':').map(Number)
      if (s === surah) ayah = a
    }
    if (!Number.isInteger(ayah) || ayah < 1) ayah = offset + i + 1
    if (typeof it.text === 'string' && !out.has(ayah)) out.set(ayah, cleanTranslation(it.text, ayah))
  })
  return out
}

export function translationsFromQuranEnc(json: unknown): Map<number, string> {
  const items = (json as { result?: { aya?: string | number; translation?: string }[] })?.result
  const out = new Map<number, string>()
  if (!Array.isArray(items)) return out
  for (const it of items) {
    const ayah = Number(it.aya)
    if (Number.isInteger(ayah) && ayah > 0 && typeof it.translation === 'string') out.set(ayah, cleanTranslation(it.translation, ayah))
  }
  return out
}

export async function fetchTranslationImpl(translationId: number, surah: number, fromAyah: number, toAyah: number, signal?: AbortSignal): Promise<TranslationEntry[]> {
  throwIfAborted(signal)
  checkRange(surah, fromAyah, toAyah)
  const d = DEFS.find((x) => x.id === translationId)
  const providers: Provider<Map<number, string>>[] = [
    {
      id: 'quran.com',
      run: async (s) => {
        const pages = await fetchPages<QcTranslationPage>((p) => quranComTranslationUrl(translationId, surah, p), fromAyah, toAyah, { signal: s, ttlMs: QF_TTL_MS })
        const m = new Map<number, string>()
        for (const page of pages) for (const [ayah, text] of translationsFromQuranCom(page, surah)) if (!m.has(ayah)) m.set(ayah, text)
        // a removed resource answers 200 with no items (e.g. 131) — treat as unavailable
        if (m.size === 0) throw new Error(`quran.com translation ${translationId}: no text for surah ${surah}`)
        return m
      },
    },
  ]
  if (d?.quranEnc) {
    const key = d.quranEnc
    providers.push({
      id: `quranenc:${key}`,
      run: async (s) => {
        const j = await fetchJson(`${QURANENC}/translation/sura/${key}/${surah}`, { signal: s, ttlMs: QURANENC_TTL_MS })
        const m = translationsFromQuranEnc(j)
        if (m.size === 0) throw new Error(`quranenc ${key}: no text for surah ${surah}`)
        return m
      },
    })
  }
  const { value } = await firstAvailable(`translation ${translationId} ${surah}`, providers, signal)
  const out: TranslationEntry[] = []
  for (let a = fromAyah; a <= toAyah; a++) {
    const text = value.get(a)
    if (text) out.push({ ayah: a, text })
  }
  return out
}
