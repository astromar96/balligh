// Test helper: turns the real API payloads in this folder into the contract types the way data/ does
// (research/audio-timing.md §8 adapters, ported from research/scripts/audio-timing/cut-planner.ts). Kept tiny
// and independent on purpose: src/data is written concurrently and the domain tests must not depend on it.
// Tajweed span offsets are only approximate here (domain uses the rule ids and word texts, not the offsets).
// Two display encodings: 'uthmani' (words[].text_uthmani, what the fixtures were first built from) and 'qpc'
// (qpcToStandard(words[].text_qpc_hafs), contract v2's Word.text). Either way Word.waqf is the Tanzil mark
// (text_uthmani, 00-gaps D1) and Word.waqfChar the mark printed in the display text.
import type { Ayah, AyahAudio, Reciter, Surah, TajweedSpan, WaqfKind, Word, WordTime } from '../../core/types'
import versesJson from './verses.json'

export interface ApiWord {
  position: number
  char_type_name: string
  text_uthmani: string
  text_uthmani_tajweed?: string | null
  text_qpc_hafs?: string
}

export type Display = 'uthmani' | 'qpc'
export const DISPLAYS: readonly Display[] = ['uthmani', 'qpc']

/** research/fonts-rendering.md §2.3 (= data.qpcToStandard): QPC's three private open-tanween marks → U+08F0–08F2. */
export const qpcToStandard = (s: string) => s.replace(/ٗ/g, 'ࣰ').replace(/ٞ/g, 'ࣱ').replace(/ٖ/g, 'ࣲ')
export interface ApiVerse {
  verse_key: string
  verse_number: number
  juz_number: number
  page_number: number
  sajdah_number: number | null
  words: ApiWord[]
}

// ── text ──

const MARK_KIND: Record<string, WaqfKind> = {
  'ۘ': 'lazim',
  'ۙ': 'mamnu',
  'ۚ': 'jaiz',
  'ۖ': 'wasl_awla',
  'ۗ': 'waqf_awla',
  'ۛ': 'muanaqa',
  'ۜ': 'saktah',
}
const TRAILING_MARKS = /[\s‌]*([ۖ-ۜ](?:[\s‌]*[ۖ-ۜ])*)[\s‌]*$/

/** "رَيْبَ ۛ" → text "رَيْبَ" + muanaqa; with two trailing marks (36:52 «ۜ ۗ») the last one counts. */
export function splitWaqf(raw: string): { text: string; waqf: WaqfKind | null; waqfChar: string | null } {
  const text = raw.replace(/^۞\s*/, '') // ۞ prefixed to word 1 of a quarter
  const m = TRAILING_MARKS.exec(text)
  if (!m) return { text: text.trim(), waqf: null, waqfChar: null }
  const marks = m[1].replace(/[\s‌]/g, '')
  const last = marks[marks.length - 1]
  return { text: text.slice(0, m.index).trim(), waqf: MARK_KIND[last] ?? null, waqfChar: last }
}

/** `<rule class=X>…</rule>` (nested allowed) → plain text + spans over it. */
export function parseRuleMarkup(markup: string): { plain: string; spans: TajweedSpan[] } {
  const spans: TajweedSpan[] = []
  const open: { rule: string; start: number }[] = []
  let plain = ''
  for (const m of markup.matchAll(/<rule class=([\w-]+)>|<\/rule>|[^<]+|</g)) {
    if (m[1]) open.push({ rule: m[1], start: plain.length })
    else if (m[0] === '</rule>') {
      const o = open.pop()
      if (o && plain.length > o.start) spans.push({ start: o.start, end: plain.length, rule: o.rule })
    } else plain += m[0]
  }
  return { plain, spans }
}

/** One verse of an api.quran.com v4 response (words=true) as the contract's Ayah, in either display encoding. */
export function toAyah(v: ApiVerse, display: Display = 'uthmani'): Ayah {
  const [surah, number] = v.verse_key.split(':').map(Number)
  const words: Word[] = v.words
    .filter((w) => w.char_type_name === 'word')
    .map((w) => {
      const tanzil = splitWaqf(w.text_uthmani)
      if (display === 'qpc' && typeof w.text_qpc_hafs !== 'string') throw new Error(`fixture ${v.verse_key}:${w.position} has no text_qpc_hafs`)
      const shown = display === 'qpc' ? splitWaqf(qpcToStandard(w.text_qpc_hafs as string)) : tanzil
      const text = shown.text
      const { spans } = parseRuleMarkup(w.text_uthmani_tajweed ?? '')
      const tajweed = spans
        .map((s) => ({ ...s, start: Math.min(s.start, text.length), end: Math.min(s.end, text.length) }))
        .filter((s) => s.end > s.start)
      return { position: w.position, text, waqf: tanzil.waqf, waqfChar: shown.waqfChar, tajweed }
    })
  return { key: `${surah}:${number}`, surah, number, words, juz: v.juz_number, page: v.page_number, sajdah: v.sajdah_number != null }
}

const VERSES = new Map<string, ApiVerse>((versesJson.verses as ApiVerse[]).map((v) => [v.verse_key, v]))

/** Ayahs of one surah from the fixture, optionally only from..to. */
export function fixtureAyahs(surah: number, from = 1, to = 999, display: Display = 'uthmani'): Ayah[] {
  const out: Ayah[] = []
  for (const v of VERSES.values()) {
    const [s, a] = v.verse_key.split(':').map(Number)
    if (s === surah && a >= from && a <= to) out.push(toAyah(v, display))
  }
  return out.sort((x, y) => x.number - y.number)
}

export function fixtureAyah(key: string, display: Display = 'uthmani'): Ayah {
  const v = VERSES.get(key)
  if (!v) throw new Error(`fixture has no verse ${key}`)
  return toAyah(v, display)
}

/** The raw fixture verse (for tests that compare encodings). */
export function fixtureVerse(key: string): ApiVerse {
  const v = VERSES.get(key)
  if (!v) throw new Error(`fixture has no verse ${key}`)
  return v
}

/** Word texts of a verse, pause marks included (what the timing adapters weigh). */
export function wordTexts(key: string): string[] {
  const v = VERSES.get(key)
  if (!v) throw new Error(`fixture has no verse ${key}`)
  return v.words.filter((w) => w.char_type_name === 'word').map((w) => w.text_uthmani)
}

// ── timing adapters (research/audio-timing.md §8) ──

const PAUSE_MARK = /[ۖ-ۜ]/
function wordWeight(text: string): number {
  const letters = (text.match(/[ء-غف-يٱ]/g) ?? []).length
  const madd = (text.match(/ٓ/g) ?? []).length
  const dagger = (text.match(/ٰ/g) ?? []).length
  const shadda = (text.match(/ّ/g) ?? []).length
  return Math.max(letters, 1) + 2.5 * madd + 0.5 * dagger + 0.5 * shadda + 3 * (PAUSE_MARK.test(text) ? 1 : 0)
}

function spread(t0: number, t1: number, words: { word: number; text: string }[]): WordTime[] {
  const ws = words.map((w) => wordWeight(w.text))
  const total = ws.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  return words.map((w, i) => {
    const s = t0 + ((t1 - t0) * acc) / total
    acc += ws[i]
    const e = t0 + ((t1 - t0) * acc) / total
    return { word: w.word, startMs: Math.round(s), endMs: Math.round(e), estimated: true }
  })
}

function fillMissing(timed: WordTime[], texts: string[], winStart: number, winEnd: number): WordTime[] {
  const n = texts.length
  const firstOcc = new Map<number, WordTime>()
  for (const w of timed) if (!firstOcc.has(w.word)) firstOcc.set(w.word, w)
  if (firstOcc.size === n) return timed
  const out = [...timed]
  let w = 1
  while (w <= n) {
    if (firstOcc.has(w)) {
      w++
      continue
    }
    let z = w
    while (z + 1 <= n && !firstOcc.has(z + 1)) z++
    const prev = firstOcc.get(w - 1)
    const next = firstOcc.get(z + 1)
    const t0 = prev ? prev.endMs : Math.max(winStart, (next?.startMs ?? winEnd) - 700 * (z - w + 1))
    const t1 = next ? next.startMs : winEnd
    const run = []
    for (let k = w; k <= z; k++) run.push({ word: k, text: texts[k - 1] })
    out.push(...spread(t0, Math.max(t0, t1), run))
    w = z + 1
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.word - b.word)
}

/** Quran.com and QDC timings split 37:130 «إِلْ يَاسِينَ» in two; value = its Quran.com position. */
const SPLIT_IN_TIMING: Record<string, number> = { '37:130': 3 }

/**
 * Class A: v4 per-ayah segments `[wordStart0, wordEndExclusive, startMs, endMs]` (strings allowed).
 * `fileDurationMs` only bounds estimates; the contract's per-ayah window stays [0, null].
 */
export function v4Audio(key: string, url: string, segments: unknown[], fileDurationMs = 0, offsetMs = 0, texts = wordTexts(key)): AyahAudio {
  const n = texts.length
  const ayah = Number(key.split(':')[1])
  let segs = (segments ?? [])
    .filter((s): s is unknown[] => Array.isArray(s) && s.length === 4)
    .map((s) => s.map(Number))
    .filter((s) => s.every(Number.isFinite) && s[3] >= s[2] && s[1] > s[0])
    .sort((x, y) => x[2] - y[2])
  const split = SPLIT_IN_TIMING[key]
  let maxEnd = Math.max(0, ...segs.map((s) => s[1]))
  if (split && maxEnd === n + 1) {
    segs = segs.map(([w0, w1, t0, t1]) => [w0 >= split ? w0 - 1 : w0, w1 > split ? w1 - 1 : w1, t0, t1])
    maxEnd = n
  }
  const base = { ayah, url, fileKind: 'per_ayah' as const, bitrateKbps: null, windowStartMs: 0, windowEndMs: null, approximateWindow: false, wordCount: n, perAyahUrl: null }
  if (!segs.length || maxEnd > n) {
    const t0 = segs.length ? segs[0][2] + offsetMs : 0
    const t1 = segs.length ? segs[segs.length - 1][3] + offsetMs : fileDurationMs
    const words = segs.length || fileDurationMs > 0 ? spread(t0, t1, texts.map((text, i) => ({ word: i + 1, text }))) : []
    return { ...base, words, timing: words.length ? 'partly-estimated' : 'none' }
  }
  const timed: WordTime[] = []
  for (const [w0, w1, t0, t1] of segs) {
    if (w1 - w0 === 1) timed.push({ word: w0 + 1, startMs: t0 + offsetMs, endMs: t1 + offsetMs, estimated: false })
    else {
      const ws = []
      for (let k = w0 + 1; k <= w1; k++) ws.push({ word: k, text: texts[k - 1] })
      timed.push(...spread(t0 + offsetMs, t1 + offsetMs, ws))
    }
  }
  const words = fillMissing(timed, texts, 0, fileDurationMs || timed[timed.length - 1].endMs)
  return { ...base, words, timing: words.some((w) => w.estimated) ? 'partly-estimated' : 'word' }
}

export interface QdcVerseTiming {
  verse_key: string
  timestamp_from: number
  timestamp_to: number
  segments?: unknown[]
}

/** Class B: QDC chapter verse timing, segment `[wordPosition1, startMs, endMs]` in chapter time; null when the verse is not in the file. */
export function qdcAudio(v: QdcVerseTiming, url: string, bitrateKbps: number | null = 128, texts = wordTexts(v.verse_key)): AyahAudio | null {
  const n = texts.length
  const ayah = Number(v.verse_key.split(':')[1])
  const from = Math.round(Number(v.timestamp_from))
  const to = Math.round(Number(v.timestamp_to))
  if (!(to > from)) return null
  const split = SPLIT_IN_TIMING[v.verse_key]
  let segs = (v.segments ?? [])
    .filter((s): s is unknown[] => Array.isArray(s) && s.length === 3)
    .map((s) => s.map((x) => Math.round(Number(x))))
    .filter((s) => s.every(Number.isFinite) && s[2] >= s[1])
  if (split && segs.some((s) => s[0] === n + 1)) segs = segs.map(([w, t0, t1]) => [w > split ? w - 1 : w, t0, t1])
  let ok = segs.length > 0 && segs.every((s) => s[0] >= 1 && s[0] <= n)
  for (let i = 1; ok && i < segs.length; i++) if (segs[i][1] < segs[i - 1][1]) ok = false
  if (ok) {
    const seen = new Set<number>()
    let lastFirst = 0
    for (const [w] of segs) {
      if (seen.has(w)) continue
      if (w < lastFirst) {
        ok = false
        break
      }
      seen.add(w)
      lastFirst = w
    }
  }
  const base = { ayah, url, fileKind: 'chapter' as const, bitrateKbps, windowStartMs: from, windowEndMs: to, approximateWindow: false, wordCount: n, perAyahUrl: null }
  if (!ok) {
    return { ...base, words: spread(from, to, texts.map((text, i) => ({ word: i + 1, text }))), timing: 'partly-estimated' }
  }
  const timed: WordTime[] = []
  for (const [w, t0, t1] of segs) {
    const last = timed[timed.length - 1]
    if (last && last.word === w && split === w && Math.abs(t0 - last.endMs) < 60) {
      last.endMs = t1
      continue
    }
    timed.push({ word: w, startMs: t0, endMs: t1, estimated: false })
  }
  const words = fillMissing(timed, texts, from, to)
  return { ...base, words, timing: words.some((x) => x.estimated) ? 'partly-estimated' : 'word' }
}

/** Class D: mp3quran ayat_timing row (approximate ayah window in a chapter file), no word timings. */
export function mp3quranAudio(surah: number, row: { ayah: number; start_time: number; end_time: number }, url: string, bitrateKbps = 128): AyahAudio {
  return {
    ayah: row.ayah,
    url,
    fileKind: 'chapter',
    bitrateKbps,
    windowStartMs: row.start_time,
    windowEndMs: row.end_time,
    approximateWindow: true,
    words: [],
    wordCount: wordTexts(`${surah}:${row.ayah}`).length,
    timing: 'none',
    perAyahUrl: null,
  }
}

/** Class C: per-ayah file without word timings. */
export function perAyahAudio(key: string, url: string): AyahAudio {
  return {
    ayah: Number(key.split(':')[1]),
    url,
    fileKind: 'per_ayah',
    bitrateKbps: null,
    windowStartMs: 0,
    windowEndMs: null,
    approximateWindow: false,
    words: [],
    wordCount: wordTexts(key).length,
    timing: 'none',
    perAyahUrl: null,
  }
}

export const everyAyahUrl = (folder: string, surah: number, ayah: number) =>
  `https://everyayah.com/data/${folder}/${String(surah).padStart(3, '0')}${String(ayah).padStart(3, '0')}.mp3`

/** An isti'adha source as the contract describes it (AyahAudio ayah -1): the reciter's own audhubillah.mp3, no word timings. */
export function istiadhaAudio(folder: string): AyahAudio {
  return {
    ayah: -1,
    url: `https://everyayah.com/data/${folder}/audhubillah.mp3`,
    fileKind: 'per_ayah',
    bitrateKbps: null,
    windowStartMs: 0,
    windowEndMs: null,
    approximateWindow: false,
    words: [],
    wordCount: 5,
    timing: 'none',
    perAyahUrl: null,
  }
}

// ── catalogue stand-ins (metadata only) ──

export const RECITER_A: Reciter = {
  id: 'alafasy',
  nameAr: 'مشاري راشد العفاسي',
  nameEn: 'Mishary Rashid Alafasy',
  style: 'murattal',
  timingClass: 'A',
  wordTimings: true,
  sourceName: 'EveryAyah.com · Quran.com',
  istiadha: true, // own audhubillah.mp3 (00-gaps §6.3)
}
export const RECITER_B: Reciter = {
  id: 'yasser-dosari',
  nameAr: 'ياسر الدوسري',
  nameEn: 'Yasser Ad-Dosari',
  style: 'murattal',
  timingClass: 'B',
  wordTimings: true,
  sourceName: 'QuranicAudio · Quran.com',
  istiadha: false,
}
export const RECITER_C: Reciter = {
  id: 'maher-muaiqly',
  nameAr: 'ماهر المعيقلي',
  nameEn: 'Maher Al-Muaiqly',
  style: 'murattal',
  timingClass: 'C',
  wordTimings: false,
  sourceName: 'EveryAyah.com',
  istiadha: false,
}
export const RECITER_D: Reciter = {
  id: 'saad-ghamdi',
  nameAr: 'سعد الغامدي',
  nameEn: 'Saad Al-Ghamdi',
  style: 'murattal',
  timingClass: 'D',
  wordTimings: false,
  sourceName: 'mp3quran.net',
  istiadha: false, // EveryAyah's file is Alafasy's voice (00-gaps §2.8, D7)
}

export const SURAHS: Record<number, Surah> = {
  1: { number: 1, nameArabic: 'الفاتحة', nameSimple: 'Al-Fatihah', nameTranslated: 'The Opener', versesCount: 7, revelationPlace: 'makkah', bismillahPre: false },
  2: { number: 2, nameArabic: 'البقرة', nameSimple: 'Al-Baqarah', nameTranslated: 'The Cow', versesCount: 286, revelationPlace: 'madinah', bismillahPre: true },
  4: { number: 4, nameArabic: 'النساء', nameSimple: 'An-Nisa', nameTranslated: 'The Women', versesCount: 176, revelationPlace: 'madinah', bismillahPre: true },
  5: { number: 5, nameArabic: 'المائدة', nameSimple: 'Al-Ma\'idah', nameTranslated: 'The Table Spread', versesCount: 120, revelationPlace: 'madinah', bismillahPre: true },
  15: { number: 15, nameArabic: 'الحجر', nameSimple: 'Al-Hijr', nameTranslated: 'The Rocky Tract', versesCount: 99, revelationPlace: 'makkah', bismillahPre: true },
  103: { number: 103, nameArabic: 'العصر', nameSimple: 'Al-\'Asr', nameTranslated: 'The Declining Day', versesCount: 3, revelationPlace: 'makkah', bismillahPre: true },
  107: { number: 107, nameArabic: 'الماعون', nameSimple: 'Al-Ma\'un', nameTranslated: 'The Small kindnesses', versesCount: 7, revelationPlace: 'makkah', bismillahPre: true },
  112: { number: 112, nameArabic: 'الإخلاص', nameSimple: 'Al-Ikhlas', nameTranslated: 'The Sincerity', versesCount: 4, revelationPlace: 'makkah', bismillahPre: true },
}
