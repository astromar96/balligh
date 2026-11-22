// Client-side Quran search (research/quran-text-api.md §4.2–§4.3): the server /search is OR-ish for phrases and
// 204s for language=ar, so the whole text is downloaded once (~246 KB gzip per corpus, cached ≤ 6 days) and
// matched locally. Corpora: Quran.com text_imlaei_simple (modern spelling) + text_uthmani_simple (Uthmani
// spelling); fallback alquran.cloud quran-simple-clean (Tanzil, identical after normalisation) + quran-uthmani.
import { AsyncMemo, QF_TTL_MS, firstAvailable, fetchJson, type Provider } from './http'
import { skeleton } from './text'

export interface SearchHit {
  surah: number
  ayah: number
  /** the verse in simple modern spelling without diacritics (for result lists; draw Quran text from fetchAyahs) */
  text: string
}

// ───────────────────────── normaliser (§4.3, in this order) ─────────────────────────

const DROP = new RegExp(
  '[' +
    '\\u{0610}-\\u{061A}\\u{064B}-\\u{065F}\\u{0670}\\u{06D6}-\\u{06DC}\\u{06DF}-\\u{06E4}\\u{06E7}\\u{06E8}\\u{06EA}-\\u{06ED}\\u{08D3}-\\u{08FF}' + // marks
    '\\u{FEFF}\\u{200C}-\\u{200F}\\u{0640}\\u{06E5}\\u{06E6}\\u{06DE}\\u{06E9}\\u{06DD}\\u{0621}' + // format chars, tatweel, small waw/yeh, signs, hamza
    '\\u{0660}-\\u{0669}\\u{06F0}-\\u{06F9}' + // Arabic-Indic digits
    ']',
  'gu',
)
const FOLD: Readonly<Record<string, string>> = {
  '\u{0623}': '\u{0627}',
  '\u{0625}': '\u{0627}',
  '\u{0622}': '\u{0627}',
  '\u{0671}': '\u{0627}',
  '\u{0672}': '\u{0627}',
  '\u{0673}': '\u{0627}',
  '\u{0675}': '\u{0627}',
  '\u{0649}': '\u{064A}',
  '\u{06CC}': '\u{064A}',
  '\u{066E}': '\u{064A}',
  '\u{06D2}': '\u{064A}',
  '\u{0629}': '\u{0647}',
  '\u{06C1}': '\u{0647}',
  '\u{06C2}': '\u{0647}',
  '\u{06C3}': '\u{0647}',
  '\u{0624}': '\u{0648}',
  '\u{0626}': '\u{064A}',
  '\u{06A9}': '\u{0643}',
  '\u{00A0}': ' ',
}
const FOLD_RE = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'gu')

/** Search normaliser: deletes marks/format characters/digits/hamza, folds letter variants, collapses spaces. Never NFC. */
export function normalizeSearchText(s: string): string {
  return s
    .replace(DROP, '')
    .replace(FOLD_RE, (c) => FOLD[c] ?? c)
    .replace(/\s+/gu, ' ')
    .trim()
}

// ───────────────────────── corpus ─────────────────────────

export interface CorpusVerse {
  surah: number
  ayah: number
  display: string
  modern: string
  uthmani: string
}

const QURAN_COM = 'https://api.quran.com/api/v4'
const ALQURAN_CLOUD = 'https://api.alquran.cloud/v1'
const BASMALA = skeleton('بسم الله الرحمن الرحيم')

/** `{verses:[{verse_key, <field>}]}` (Quran.com bulk) → key → text. */
export function bulkFromQuranCom(json: unknown, field: string): Map<string, string> {
  const verses = (json as { verses?: Record<string, unknown>[] })?.verses
  const out = new Map<string, string>()
  if (!Array.isArray(verses)) return out
  for (const v of verses) {
    if (typeof v.verse_key === 'string' && typeof v[field] === 'string') out.set(v.verse_key, (v[field] as string).trim())
  }
  return out
}

/** alquran.cloud `/quran/{edition}` → key → text, basmala prefix (verse 1 of surahs ≠ 1, 9) and BOM removed. */
export function bulkFromAlquranCloud(json: unknown): Map<string, string> {
  const surahs = (json as { data?: { surahs?: { number: number; ayahs: { numberInSurah: number; text: string }[] }[] } })?.data?.surahs
  const out = new Map<string, string>()
  if (!Array.isArray(surahs)) return out
  for (const s of surahs) {
    for (const a of s.ayahs ?? []) {
      let text = String(a.text).replace(/\u{FEFF}/gu, '').trim()
      if (a.numberInSurah === 1 && s.number !== 1 && s.number !== 9) {
        const toks = text.split(/\s+/u)
        if (toks.length > 4 && skeleton(toks.slice(0, 4).join('')) === BASMALA) text = toks.slice(4).join(' ')
      }
      out.set(`${s.number}:${a.numberInSurah}`, text)
    }
  }
  return out
}

/** Corpus in Mushaf order; `modern` gives the result text, both spellings are searched. */
export function buildCorpus(modern: Map<string, string>, uthmani: Map<string, string>): CorpusVerse[] {
  const out: CorpusVerse[] = []
  for (const [key, text] of modern) {
    const [surah, ayah] = key.split(':').map(Number)
    out.push({ surah, ayah, display: text, modern: ` ${normalizeSearchText(text)} `, uthmani: ` ${normalizeSearchText(uthmani.get(key) ?? '')} ` })
  }
  return out.sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)
}

const memo = new AsyncMemo(2)

function loadCorpus(signal?: AbortSignal): Promise<CorpusVerse[]> {
  return memo.get(
    'corpus',
    QF_TTL_MS,
    async (s) => {
      const providers: Provider<CorpusVerse[]>[] = [
        {
          id: 'quran.com',
          run: async () => {
            const [m, u] = await Promise.all([
              fetchJson(`${QURAN_COM}/quran/verses/imlaei_simple`, { signal: s, ttlMs: QF_TTL_MS }),
              fetchJson(`${QURAN_COM}/quran/verses/uthmani_simple`, { signal: s, ttlMs: QF_TTL_MS }),
            ])
            const modern = bulkFromQuranCom(m, 'text_imlaei_simple')
            if (modern.size !== 6236) throw new Error(`imlaei_simple: ${modern.size} verses`)
            return buildCorpus(modern, bulkFromQuranCom(u, 'text_uthmani_simple'))
          },
        },
        {
          id: 'alquran.cloud',
          run: async () => {
            const [m, u] = await Promise.all([
              fetchJson(`${ALQURAN_CLOUD}/quran/quran-simple-clean`, { signal: s, ttlMs: QF_TTL_MS }),
              fetchJson(`${ALQURAN_CLOUD}/quran/quran-uthmani`, { signal: s, ttlMs: QF_TTL_MS }),
            ])
            const modern = bulkFromAlquranCloud(m)
            if (modern.size !== 6236) throw new Error(`quran-simple-clean: ${modern.size} verses`)
            return buildCorpus(modern, bulkFromAlquranCloud(u))
          },
        },
      ]
      return (await firstAvailable('search corpus', providers, s)).value
    },
    signal,
  )
}

// ───────────────────────── search ─────────────────────────

const toLatinDigits = (s: string) =>
  s.replace(/[\u{0660}-\u{0669}]/gu, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u{06F0}-\u{06F9}]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))

/**
 * Matches the normalised query against both corpora: whole-token phrase matches first (union, Mushaf order),
 * then — when fewer than `limit` — substring matches (prefixes such as «رحم»). A query like "2:255" / "٢:٢٥٥"
 * returns that verse.
 */
export function searchCorpus(corpus: CorpusVerse[], query: string, limit: number): SearchHit[] {
  const ref = /^\s*(\d{1,3})\s*[:：.\-/]\s*(\d{1,3})\s*$/u.exec(toLatinDigits(query))
  if (ref) {
    const hit = corpus.find((v) => v.surah === Number(ref[1]) && v.ayah === Number(ref[2]))
    return hit ? [{ surah: hit.surah, ayah: hit.ayah, text: hit.display }] : []
  }
  const q = normalizeSearchText(query)
  if (!q || limit <= 0) return []
  const needle = ` ${q} `
  const hits: SearchHit[] = []
  const seen = new Set<CorpusVerse>()
  for (const v of corpus) {
    if (v.modern.includes(needle) || v.uthmani.includes(needle)) {
      hits.push({ surah: v.surah, ayah: v.ayah, text: v.display })
      seen.add(v)
      if (hits.length >= limit) return hits
    }
  }
  for (const v of corpus) {
    if (seen.has(v)) continue
    if (v.modern.includes(q) || v.uthmani.includes(q)) {
      hits.push({ surah: v.surah, ayah: v.ayah, text: v.display })
      if (hits.length >= limit) break
    }
  }
  return hits
}

export async function searchQuranImpl(query: string, limit = 50, signal?: AbortSignal): Promise<SearchHit[]> {
  if (!normalizeSearchText(query) && !/\d/u.test(toLatinDigits(query))) return []
  const corpus = await loadCorpus(signal)
  return searchCorpus(corpus, query, limit)
}

/** Test hook. */
export function clearSearchMemo(): void {
  memo.clear()
}
