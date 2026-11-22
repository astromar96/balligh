// fetchAyahAudio / fetchBasmalaAudio / fetchIstiadhaAudio: audio URL + timing per the reciter's class
// (research/audio-timing.md §8, §11; adapters in timing.ts) and per the voice table (reciters.voice.ts,
// research/00-gaps.md §6.3). Timing requests: Quran.com v4 segments in pages of 50 (only the pages holding the
// ayahs), one QDC or mp3quran request per surah; cached within the host policy (QF content ≤ 6 days).
import type { Ayah, AyahAudio } from '../core/types'
import { DAY_MS, QF_TTL_MS, ProvidersFailedError, fetchJson, fetchPages, isAbortError, throwIfAborted, PER_PAGE, type PagedBody } from './http'
import { versesIn } from './meta'
import { fetchAyahsImpl } from './quran'
import type { ReciterCatalogEntry } from './reciters.catalog'
import { everyAyahFile, everyAyahUrl, fillTemplate, getCatalogEntry } from './reciters'
import { voiceOf } from './reciters.voice'
import {
  fromAyahWindow,
  fromQdcVerseTiming,
  fromV4Segments,
  indexQdcTimings,
  parseMp3quranTiming,
  perAyahWithoutWords,
  type Mp3quranRow,
  type QdcVerseTiming,
} from './timing'

export const QURAN_COM_V4 = 'https://api.quran.com/api/v4'
export const QURAN_COM_QDC = 'https://api.quran.com/api/qdc'
export const MP3QURAN_API = 'https://www.mp3quran.net/api/v3'
/** mp3quran sends max-age=86400 on its JSON. */
const MP3QURAN_TTL_MS = DAY_MS

// ───────────────────────── timing payloads ─────────────────────────

/** Page `page` (50 ayahs: 50(page−1)+1 … 50·page) of a recitation's per-ayah segments for a surah. */
export function v4SegmentsUrl(recitationId: number, surah: number, page = 1): string {
  return `${QURAN_COM_V4}/recitations/${recitationId}/by_chapter/${surah}?fields=segments&per_page=${PER_PAGE}&page=${page}`
}

interface V4Page extends PagedBody {
  audio_files?: { verse_key?: string; segments?: unknown }[]
}

/** verse_key → raw segments for one recitation, from the pages that hold ayahs first..last of the surah. */
export async function fetchV4Segments(recitationId: number, surah: number, first: number, last: number, signal?: AbortSignal): Promise<Map<string, unknown>> {
  const pages = await fetchPages<V4Page>((p) => v4SegmentsUrl(recitationId, surah, p), first, last, { signal, ttlMs: QF_TTL_MS })
  const map = new Map<string, unknown>()
  for (const json of pages) {
    for (const f of json.audio_files ?? []) if (typeof f.verse_key === 'string' && !map.has(f.verse_key)) map.set(f.verse_key, f.segments)
  }
  return map
}

export function qdcUrl(recitationId: number, surah: number): string {
  return `${QURAN_COM_QDC}/audio/reciters/${recitationId}/audio_files?chapter=${surah}&segments=true`
}

export interface QdcChapter {
  audioUrl: string
  timings: Map<string, QdcVerseTiming>
}

/** Absolute https URL; protocol-relative and http URLs of the audio hosts are upgraded (media-pipeline.md N6). */
export function httpsUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const u = url.trim()
  if (/^https:\/\/[^/]/.test(u)) return u
  if (/^\/\/[^/]/.test(u)) return `https:${u}`
  if (/^http:\/\/[^/]/.test(u)) return `https://${u.slice('http://'.length)}`
  return null
}

export function parseQdcChapter(json: unknown): QdcChapter | null {
  const f = (json as { audio_files?: { audio_url?: unknown; verse_timings?: unknown }[] })?.audio_files?.[0]
  const audioUrl = httpsUrl(f?.audio_url)
  if (!f || !audioUrl) return null
  return { audioUrl, timings: indexQdcTimings(f.verse_timings) }
}

export async function fetchQdcChapter(recitationId: number, surah: number, signal?: AbortSignal): Promise<QdcChapter | null> {
  return parseQdcChapter(await fetchJson(qdcUrl(recitationId, surah), { signal, ttlMs: QF_TTL_MS }))
}

export function mp3quranTimingUrl(read: number, surah: number): string {
  return `${MP3QURAN_API}/ayat_timing?surah=${surah}&read=${read}`
}

export async function fetchMp3quranTiming(read: number, surah: number, signal?: AbortSignal): Promise<Map<number, Mp3quranRow>> {
  return parseMp3quranTiming(await fetchJson(mp3quranTimingUrl(read, surah), { signal, ttlMs: MP3QURAN_TTL_MS }))
}

// ───────────────────────── per-class builders ─────────────────────────

/** Word texts with their pause mark (the estimator weighs a pause sign). */
function wordTexts(a: Ayah): string[] {
  return a.words.map((w) => (w.waqfChar ? `${w.text} ${w.waqfChar}` : w.text))
}

interface Ctx {
  surah: number
  entry: ReciterCatalogEntry
  signal?: AbortSignal
}

/** The reciter's own per-ayah file, whole, no word timings (null without one — e.g. Tunaiji's foreign 1:1). */
function everyAyahAudio(ctx: Ctx, ayah: Ayah): AyahAudio | null {
  const url = everyAyahUrl(ctx.entry, ctx.surah, ayah.number)
  return url ? perAyahWithoutWords(ayah.number, url, ayah.words.length) : null
}

async function mp3quranAudio(ctx: Ctx, ayahs: Ayah[]): Promise<Map<number, AyahAudio>> {
  const mq = ctx.entry.mp3quran
  const out = new Map<number, AyahAudio>()
  if (!mq || mq.timingRead == null) return out
  const rows = await fetchMp3quranTiming(mq.timingRead, ctx.surah, ctx.signal)
  const url = fillTemplate(mq.urlTemplate, ctx.surah)
  for (const a of ayahs) {
    const row = rows.get(a.number)
    const perAyahUrl = everyAyahUrl(ctx.entry, ctx.surah, a.number)
    if (row) out.set(a.number, fromAyahWindow({ ayah: a.number, url, bitrateKbps: mq.bitrateKbps, row, wordCount: a.words.length, perAyahUrl }))
  }
  return out
}

/** Fallback audio for ayahs the class source could not serve (reciter's fallbackAudio, then EveryAyah). */
async function fallbackAudio(ctx: Ctx, ayahs: Ayah[], causes: unknown[]): Promise<Map<number, AyahAudio>> {
  const out = new Map<number, AyahAudio>()
  if (ayahs.length === 0) return out
  const order: ('everyayah' | 'mp3quran')[] = ctx.entry.fallbackAudio === 'mp3quran' ? ['mp3quran', 'everyayah'] : ['everyayah', 'mp3quran']
  let pending = ayahs
  for (const kind of order) {
    if (pending.length === 0) break
    try {
      if (kind === 'everyayah') {
        for (const a of pending) {
          const audio = everyAyahAudio(ctx, a)
          if (audio) out.set(a.number, audio)
        }
      } else {
        for (const [k, v] of await mp3quranAudio(ctx, pending)) out.set(k, v)
      }
    } catch (e) {
      if (isAbortError(e)) throw e
      causes.push(e)
    }
    pending = pending.filter((a) => !out.has(a.number))
  }
  return out
}

async function classA(ctx: Ctx, ayahs: Ayah[]): Promise<Map<number, AyahAudio>> {
  const { entry, surah } = ctx
  const out = new Map<number, AyahAudio>()
  const ea = entry.everyayah
  if (!ea || !entry.v4) return out
  let segments: Map<string, unknown> | null = null
  const numbers = ayahs.map((a) => a.number)
  try {
    segments = await fetchV4Segments(entry.v4.recitationId, surah, Math.min(...numbers), Math.max(...numbers), ctx.signal)
  } catch (e) {
    if (isAbortError(e)) throw e
    segments = null // timing API down: the audio still plays, as whole ayahs
  }
  for (const a of ayahs) {
    const url = fillTemplate(ea.urlTemplate, surah, a.number)
    const raw = segments?.get(`${surah}:${a.number}`)
    out.set(
      a.number,
      raw === undefined
        ? perAyahWithoutWords(a.number, url, a.words.length)
        : fromV4Segments({ ayah: a.number, verseKey: `${surah}:${a.number}`, url, segments: raw, wordTexts: wordTexts(a), offsetMs: entry.v4.offsetMs }),
    )
  }
  return out
}

async function classB(ctx: Ctx, ayahs: Ayah[], causes: unknown[]): Promise<Map<number, AyahAudio>> {
  const { entry, surah } = ctx
  const out = new Map<number, AyahAudio>()
  if (!entry.qdc) return out
  let chapter: QdcChapter | null = null
  try {
    chapter = await fetchQdcChapter(entry.qdc.recitationId, surah, ctx.signal)
  } catch (e) {
    if (isAbortError(e)) throw e
    causes.push(e)
  }
  if (!chapter) return out
  for (const a of ayahs) {
    const vt = chapter.timings.get(`${surah}:${a.number}`)
    if (!vt) continue
    const audio = fromQdcVerseTiming({
      ayah: a.number,
      url: chapter.audioUrl,
      bitrateKbps: entry.qdc.bitrateKbps,
      verseTiming: vt,
      wordTexts: wordTexts(a),
      perAyahUrl: everyAyahUrl(entry, surah, a.number),
    })
    if (audio) out.set(a.number, audio)
  }
  return out
}

// ───────────────────────── public ─────────────────────────

export async function fetchAyahAudioImpl(reciterId: string, surah: number, ayahs: number[], signal?: AbortSignal): Promise<AyahAudio[]> {
  throwIfAborted(signal)
  const entry = getCatalogEntry(reciterId)
  if (!entry) throw new RangeError(`unknown reciter: ${reciterId}`)
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new RangeError(`surah must be 1..114, got ${surah}`)
  for (const n of ayahs) if (!Number.isInteger(n) || n < 1 || n > versesIn(surah)) throw new RangeError(`ayah ${surah}:${n} does not exist`)
  if (ayahs.length === 0) return []
  // the text gives word counts and the weights the estimator needs (the reader has it loaded already)
  const text = await fetchAyahsImpl(surah, signal)
  const ayahByNumber = new Map(text.map((a) => [a.number, a]))
  const wanted: Ayah[] = []
  for (const n of new Set(ayahs)) {
    const a = ayahByNumber.get(n)
    if (!a) throw new RangeError(`ayah ${surah}:${n} does not exist`)
    wanted.push(a)
  }
  const ctx: Ctx = { surah, entry, signal }
  const causes: unknown[] = []
  let got = new Map<number, AyahAudio>()
  switch (entry.timingClass) {
    case 'A':
      got = await classA(ctx, wanted)
      break
    case 'B':
      if (voiceOf(entry.id).vbrChapters.includes(surah)) {
        // Xing VBR chapter file (Tunaiji ch 14, 72): never windowed — his own per-ayah files, whole ayahs (§2.6)
        for (const a of wanted) {
          const audio = everyAyahAudio(ctx, a)
          if (audio) got.set(a.number, audio)
        }
      } else got = await classB(ctx, wanted, causes)
      break
    case 'C':
      for (const a of wanted) {
        const audio = everyAyahAudio(ctx, a)
        if (audio) got.set(a.number, audio)
      }
      break
    case 'D':
      try {
        got = await mp3quranAudio(ctx, wanted)
      } catch (e) {
        if (isAbortError(e)) throw e
        causes.push(e)
      }
      break
  }
  const missing = wanted.filter((a) => !got.has(a.number))
  if (missing.length) for (const [k, v] of await fallbackAudio(ctx, missing, causes)) got.set(k, v)
  const unresolved = wanted.filter((a) => !got.has(a.number))
  if (unresolved.length) throw new ProvidersFailedError(`audio for ${reciterId} ${surah}:${unresolved.map((a) => a.number).join(',')}`, causes)
  return ayahs.map((n) => got.get(n) as AyahAudio)
}

/**
 * The basmala clip source (ayah 0): the reciter's own recitation of 1:1 through its class source (00-gaps §6.3) —
 * class A its 001001.mp3 with the 1:1 word timings, B the QDC chapter-1 1:1 window (Tunaiji: never the EveryAyah
 * 001001.mp3, which is Minshawi's), C its 001001.mp3 (Ali Jaber: bismillah.mp3, his 001001.mp3 starts with the
 * isti'adha), D the mp3quran 1:1 window.
 */
export async function fetchBasmalaAudioImpl(reciterId: string, signal?: AbortSignal): Promise<AyahAudio> {
  const [audio] = await fetchAyahAudioImpl(reciterId, 1, [1], signal)
  return { ...audio, ayah: 0 }
}

/** «أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ» */
const ISTIADHA_WORDS = 5

/**
 * The isti'adha clip source (ayah -1): EveryAyah's audhubillah.mp3 when it is the reciter's own voice (Alafasy,
 * Husary, Shatri, Ali Jaber, Hudhaifi), whole, no word timings; null for every other reciter — Shuraim's,
 * Ghamdi's and Ayyoub's files are Alafasy's recording (00-gaps §2.8, D7). No network request.
 */
export async function fetchIstiadhaAudioImpl(reciterId: string, signal?: AbortSignal): Promise<AyahAudio | null> {
  throwIfAborted(signal)
  const entry = getCatalogEntry(reciterId)
  if (!entry) throw new RangeError(`unknown reciter: ${reciterId}`)
  if (voiceOf(reciterId).istiadha !== 'own') return null
  const url = everyAyahFile(entry, 'audhubillah.mp3')
  return url ? perAyahWithoutWords(-1, url, ISTIADHA_WORDS) : null
}
