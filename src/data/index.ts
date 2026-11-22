// data/ — every network call the app makes. Owner: data agent.
// Public contract below; implementations live in sibling files.
// All functions: fetch only (CORS simple GETs, credentials omitted — runs unchanged on web and native), no DOM,
// 15 s timeout + 2 retries with backoff on network/5xx/429, abortable, provider fallbacks, cached in memory and —
// on the web — in Cache Storage, each host no longer than src/data/cache-policy.json allows (Quran Foundation
// content, audio hosts included: ≤ 6 days — QF Developer Terms, research/00-gaps.md §2.9); purgeExpiredCaches()
// deletes what is past it. Paged Quran.com endpoints are read in pages of 50 (00-gaps §2.10).
import type {
  Ayah,
  AyahAudio,
  Reciter,
  Surah,
  TafsirEntry,
  TafsirResult,
  TafsirSource,
  TajweedSpan,
  TranslationEntry,
  TranslationSource,
  WaqfKind,
} from '../core/types'
import { fetchAyahAudioImpl, fetchBasmalaAudioImpl, fetchIstiadhaAudioImpl } from './audio'
import { purgeExpiredCaches as purgeExpiredCachesImpl } from './http'
import { fetchAyahsImpl, fetchSurahsImpl } from './quran'
import { RECITER_LIST, getReciterImpl } from './reciters'
import { searchQuranImpl, type SearchHit } from './search'
import { TAFSIR_LIST, fetchTafsirImpl, fetchTafsirResultImpl } from './tafsir'
import {
  normalizeQuranText as normalizeQuranTextImpl,
  parseTajweedVerse as parseTajweedVerseImpl,
  qpcToStandard as qpcToStandardImpl,
  splitWaqf as splitWaqfImpl,
} from './text'
import { TRANSLATION_LIST, fetchTranslationImpl, textDirection as textDirectionImpl } from './translations'

export type { SearchHit, TafsirResult }
export { HttpError, ProvidersFailedError } from './http'

// ── Cache ──

/**
 * Deletes cached responses that must not be kept any longer, from every Cache Storage cache of the origin (the
 * service worker's runtime caches included): entries past their expiry, entries of a cache-policy host older than
 * its maxAgeDays (QF hosts — API and audio — 6 days), QF entries that carry no x-balligh-stored stamp (their age
 * cannot be told), and the legacy data cache. Hosts outside the policy are left alone. Call once at app start;
 * idempotent, never rejects, concurrent calls share one run; resolves at once where Cache Storage does not exist
 * (native). data/ also starts it the first time it opens its cache.
 */
export function purgeExpiredCaches(): Promise<void> {
  return purgeExpiredCachesImpl()
}

// ── Quran text ──

/**
 * All 114 surahs (Arabic + English names, ayah counts). Cached after the first call.
 * Source: api.quran.com/api/v4/chapters; fallback api.alquran.cloud/v1/surah.
 */
export function fetchSurahs(signal?: AbortSignal): Promise<Surah[]> {
  return fetchSurahsImpl(signal)
}

/**
 * Every ayah of a surah with words, tajweed runs and pause marks, in order.
 * Source: api.quran.com/api/v4 verses/by_chapter in pages of 50 (words=true, fields=text_uthmani_tajweed,
 * word_fields=text_uthmani,text_qpc_hafs — research/00-gaps.md §2.5); fallback api.alquran.cloud (Tanzil
 * quran-uthmani + quran-tajweed, re-segmented to Quran.com word positions).
 * Word.text = qpcToStandard(words[].text_qpc_hafs) without its trailing pause mark — the encoding Amiri Quran draws
 * without a stray small meem (00-gaps §2.2; the fallback maps its Tanzil text to the same encoding). It may contain
 * a space for ۞ (quarter start, prefixed), ۩ (sajdah, appended), 8:6 «بَعْدَ مَا» and 37:130 «إِلْ يَاسِينَ».
 * Two pause-mark systems (00-gaps D1): Word.waqf = the kind of the Tanzil mark in words[].text_uthmani — what the
 * selection guard reads (keeps ۙ «do not stop», 68 words); Word.waqfChar = the mark PRINTED in the QPC text (what
 * the renderer draws; QPC prints no ۙ, so waqf can be set while waqfChar is null, and they differ in 353 words;
 * 36:52 carries two: waqfChar "ۜ ۗ"). Word.tajweed = non-overlapping runs (innermost rule wins) from the verse-level
 * text_uthmani_tajweed, grouped per word (quran-text-api §3.7) and projected onto Word.text (one class lost in
 * 77,429 words, 17:7:12; the tajweed string is never displayed). Word.position = Quran.com position = the index
 * audio word timings use. Ayah.sajdah also covers 22:77 (۩ only).
 */
export function fetchAyahs(surah: number, signal?: AbortSignal): Promise<Ayah[]> {
  return fetchAyahsImpl(surah, signal)
}

/**
 * QPC Hafs text (words[].text_qpc_hafs) → the encoding Word.text uses: QPC's open tanween (U+0657, U+065E, U+0656,
 * which Amiri Quran lacks) → U+08F0/U+08F1/U+08F2, and a word-final yeh drawn dotless (U+0649) as the Madani Mushaf
 * prints it. Everything else is kept. For drawing other QPC text the same way (e.g. the basmala of 1:1).
 */
export function qpcToStandard(text: string): string {
  return qpcToStandardImpl(text)
}

// ── Tajweed text helpers (pure, exported for tests and the UI) ──

/** Maps characters the bundled font lacks to their intended form (e.g. U+0672 → U+0670); drops invisible format characters (RLM, BOM); collapses spaces. Never NFC. */
export function normalizeQuranText(text: string): string {
  return normalizeQuranTextImpl(text)
}

/**
 * Parses one verse of text_uthmani_tajweed into word tokens (split on spaces, ayah-end span dropped).
 * Each token's text is normalised and carries its spans; a pause mark glued on with ZWNJ is returned
 * separately. Tokens ≠ words in 216 verses (۞, ۩, 8:6, 37:130): fetchAyahs groups them for you.
 */
export function parseTajweedVerse(html: string): { text: string; spans: TajweedSpan[]; waqfChar: string | null }[] {
  return parseTajweedVerseImpl(html)
}

/** Splits a trailing pause mark (with its separating space/ZWNJ) off a word's text. */
export function splitWaqf(text: string): { text: string; waqfChar: string | null; waqf: WaqfKind | null } {
  return splitWaqfImpl(text)
}

// ── Reciters & audio ──

/**
 * Reciters offered in the picker, popular first — vendored from the live-verified catalogue
 * research/fixtures/audio-timing/reciters.json (metadata only, no Quran content) by
 * src/data/tools/gen-reciters-catalog.mjs → reciters.catalog.ts. 28 reciters: 12 A, 3 B, 11 C, 2 D.
 */
export const RECITERS: Reciter[] = RECITER_LIST

export const DEFAULT_RECITER_ID = 'alafasy'

export function getReciter(id: string): Reciter | undefined {
  return getReciterImpl(id)
}

/**
 * Audio + timing for the given ayahs of a surah, in the same order as `ayahs`, normalised per
 * the reciter's class (research/audio-timing.md §8 adapters):
 * A — EveryAyah per-ayah URL + v4 segments (/recitations/{id}/by_chapter/{s}?fields=segments, pages of 50: only
 *     the pages holding the ayahs), values coerced to numbers, per-reciter offset_ms applied (26 ms for Husary /
 *     Abdul Basit murattal), multi-word segments spread by text weight, missing words interpolated (estimated:
 *     true), the 37:130 split word merged and the muqatta'at index jump repaired;
 * B — QDC chapter file URL + bitrate + verse window + [wordPosition1, startMs, endMs] words in chapter time. Every
 *     verse is validated (00-gaps §2.6): corrupt word labels (Khalifa: 247 verses) → that verse whole (words [],
 *     timing 'none', its window still cuts the file — D8); missing words interpolated. Khalifa's chapters 14 and
 *     72 are Xing VBR files that cannot be windowed: served from his per-ayah EveryAyah files (timing 'none');
 * C — per-ayah URL, words [];
 * D — mp3quran chapter URL + bitrate + ayat_timing window (approximateWindow: true), words [].
 * Labels that cannot be mapped, or more than half of an ayah's words untimed → that ayah whole (timing 'none';
 * estimated karaoke is off by a median 598 ms, D4). Never throws on bad timing data; whole ayahs when the timing
 * API is down; an ayah missing from a class-B/D source falls back to the reciter's per-ayah EveryAyah file.
 * AyahAudio.perAyahUrl: on chapter items (B/D), the reciter's own EveryAyah file of the ayah (null without one) —
 * the fallback when the chapter file cannot be windowed; null on per-ayah items. Tunaiji's EveryAyah 001001.mp3
 * (Minshawi's voice) is never returned; Ali Jaber's 1:1 is his bismillah.mp3 (his 001001.mp3 starts with the
 * isti'adha). bitrateKbps of chapter files is the catalogue's nominal CBR rate — probe the frame header before
 * slicing. Throws RangeError for an unknown reciter/ayah, ProvidersFailedError when no audio source answers.
 */
export function fetchAyahAudio(reciterId: string, surah: number, ayahs: number[], signal?: AbortSignal): Promise<AyahAudio[]> {
  return fetchAyahAudioImpl(reciterId, surah, ayahs, signal)
}

/**
 * The basmala clip source (ayah 0), from the per-reciter table (00-gaps §6.3): the reciter's own recitation of 1:1
 * through its class source — A its 001001.mp3 with the 1:1 word timings, B the QDC chapter-1 1:1 window (Tunaiji:
 * never the EveryAyah 001001.mp3, which is Minshawi's), C its 001001.mp3 (Ali Jaber: his bismillah.mp3), D the
 * mp3quran 1:1 window. Throws like fetchAyahAudio.
 */
export function fetchBasmalaAudio(reciterId: string, signal?: AbortSignal): Promise<AyahAudio> {
  return fetchBasmalaAudioImpl(reciterId, signal)
}

/**
 * The isti'adha clip source (ayah -1): EveryAyah's audhubillah.mp3 in the reciter's OWN voice (Alafasy, Husary,
 * Shatri, Ali Jaber, Hudhaifi — Reciter.istiadha), a whole per-ayah file of 5 words without word timings; null
 * for every other reciter — Shuraim's, Ghamdi's and Ayyoub's files are Alafasy's recording (00-gaps §2.8, D7).
 * No network request. Throws RangeError for an unknown reciter.
 */
export function fetchIstiadhaAudio(reciterId: string, signal?: AbortSignal): Promise<AyahAudio | null> {
  return fetchIstiadhaAudioImpl(reciterId, signal)
}

// ── Tafsir ──

/**
 * Tafsir sources, short ones first (research/tafsir-translation.md §1.1; each has ordered provider fallbacks inside data/):
 * mukhtasar (default), muyassar, jalalayn, saadi, ibnkathir, tabari, baghawi, wasit, qurtubi (kind 'ahkam'),
 * ahkam-ibn-alarabi, ahkam-jassas, ahkam-kiya-harrasi, ahkam-ibn-alfaras (kind 'ahkam'; no entry for ayahs without rulings).
 * creditAr names the primary provider; fetchTafsirResult returns the credit of the provider actually used.
 */
export const TAFSIRS: TafsirSource[] = TAFSIR_LIST

export const DEFAULT_TAFSIR_ID = 'mukhtasar'

/**
 * Tafsir for ayahs fromAyah..toAyah of a surah, trying the source's providers in order.
 * Grouped passages (3 shapes in the wild) are returned once with their ayah range (which may extend beyond the
 * request); ayahs with no entry are simply absent. Text is never modified beyond HTML→plain-text conversion
 * (paragraphs separated by "\n\n"; the QUL surah intro and [[editor notes]] are not part of the works and are dropped).
 */
export function fetchTafsir(tafsirId: string, surah: number, fromAyah: number, toAyah: number, signal?: AbortSignal): Promise<TafsirEntry[]> {
  return fetchTafsirImpl(tafsirId, surah, fromAyah, toAyah, signal)
}

/** Same as fetchTafsir, plus which provider answered and the licence credit line for it (QuranEnc: live version). */
export function fetchTafsirResult(tafsirId: string, surah: number, fromAyah: number, toAyah: number, signal?: AbortSignal): Promise<TafsirResult> {
  return fetchTafsirResultImpl(tafsirId, surah, fromAyah, toAyah, signal)
}

// ── Translations ──

/**
 * Quran.com translations verified on 2026-11-21, default first per language (The Clear Quran, 131, is not public).
 * `script` (ISO 15924: Latn, Arab, Cyrl, Beng, Deva, Taml, Hans, Jpan, Kore) and `dir` were checked against each
 * edition's live text — not taken from /resources/languages, which is wrong or missing for 10 editions (00-gaps §2.11).
 */
export const TRANSLATIONS: TranslationSource[] = TRANSLATION_LIST

/**
 * Plain text per ayah (footnote markers removed). Quran.com /translations/{id}/by_chapter/{s} in pages of 50, only
 * the pages that hold the range; QuranEnc fallback for some editions.
 */
export function fetchTranslation(translationId: number, surah: number, fromAyah: number, toAyah: number, signal?: AbortSignal): Promise<TranslationEntry[]> {
  return fetchTranslationImpl(translationId, surah, fromAyah, toAyah, signal)
}

/**
 * Direction of a text from its first letter (Arabic, Hebrew, Thaana, N'Ko, Syriac → rtl), the rule of 00-gaps §2.11 —
 * for text whose direction is not known in advance.
 */
export function textDirection(text: string): 'ltr' | 'rtl' {
  return textDirectionImpl(text)
}

// ── Search ──

/**
 * Client-side search over the whole Quran (research/quran-text-api.md §4): the text is downloaded once
 * (Quran.com text_imlaei_simple + text_uthmani_simple, ~2 × 246 KB gzip, cached ≤ 6 days; fallback
 * alquran.cloud quran-simple-clean + quran-uthmani) and matched with the §4.3 normaliser (marks, hamza,
 * alef/yeh/teh-marbuta variants folded), so modern («الصلاة») and Uthmani («ٱلصَّلَوٰةَ», «الصلوة») spellings
 * both match. Whole-token phrase matches come first in Mushaf order, then substring matches (prefixes such as
 * «رحم») up to `limit` (default 50). "2:255" / "٢:٢٥٥" returns that verse. `text` is the verse in simple modern
 * spelling (no diacritics) for result lists — draw the Quran text itself from fetchAyahs.
 */
export function searchQuran(query: string, limit?: number, signal?: AbortSignal): Promise<{ surah: number; ayah: number; text: string }[]> {
  return searchQuranImpl(query, limit, signal)
}
