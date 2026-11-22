// Tafsir sources and providers (research/tafsir-translation.md §0, §1.1, §2.5, §3, §4, §5, §6, §10).
// Every source has ordered provider fallbacks; all are simple CORS GETs. Text is never modified beyond
// HTML → plain text, except two things that are not part of the work: the QUL surah intro block spa5k
// prepends to Muyassar (§4.4) and QUL `[[editor notes]]` (§10).
import type { TafsirEntry, TafsirResult, TafsirSource } from '../core/types'
import { DAY_MS, QF_TTL_MS, ProvidersFailedError, fetchJson, HttpError, isAbortError, mapLimit, throwIfAborted } from './http'
import { checkRange, versesIn } from './meta'

// ───────────────────────── HTML → text ─────────────────────────

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    const name = e.toLowerCase()
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : m
  })
}

/**
 * HTML fragment (Quran.com / Quranpedia) or plain text (QuranEnc, spa5k, alquran.cloud) → plain text with
 * paragraphs separated by "\n\n". <br>, <p>, headings and newlines start a paragraph; other tags are dropped
 * (their text kept); entities decoded; runs of spaces collapsed.
 */
export function htmlToText(html: string): string {
  const s = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(s)
    .split(/\n/)
    .map((p) => p.replace(/[ \t\u{00A0}]+/gu, ' ').trim())
    .filter((p) => p.length > 0)
    .join('\n\n')
}

/** QUL editions: drop `[[editor notes]]` (editorial apparatus, possibly the editor's copyright). */
export function stripEditorNotes(text: string): string {
  return text.replace(/\s*\[\[[\s\S]*?\]\]/g, '')
}

/** spa5k Muyassar: drop the QUL surah intro ("تسمية السورة … [التفسير]"), which is not part of the Muyassar. */
export function stripSurahIntro(text: string): string {
  const marker = text.indexOf('[التفسير]')
  if (marker < 0) return text
  const head = text.slice(0, marker)
  if (!head.includes('تسمية السورة') && !head.includes('مقاصد السورة')) return text
  return text.slice(marker + '[التفسير]'.length).replace(/^\s+/, '')
}

/** Canonical form for comparing passages (duplicated-text groups): no harakat, tatweel, spaces; alef forms unified. */
export function canonText(t: string): string {
  return t
    .replace(/[\u{064B}-\u{065F}\u{0670}\u{0640}\s\u{200C}-\u{200F}]/gu, '')
    .replace(/[\u{0622}\u{0623}\u{0625}\u{0671}]/gu, '\u{0627}')
    .replace(/[،,.؛;:!؟?"'«»()\-–—]/gu, '')
}

// ───────────────────────── providers ─────────────────────────

/** One ayah's passage; covers = other ayahs of the surah the source says this passage covers (shape A). */
export interface TafsirRow {
  text: string
  covers: number[]
}

export interface TafsirProvider {
  id: string
  /** host part of the credit line */
  creditAr: string
  /** null = the source has no entry for this ayah (404 / empty) */
  fetchAyah(surah: number, ayah: number, signal?: AbortSignal): Promise<TafsirRow | null>
}

const QURANENC = 'https://quranenc.com/api/v1'
const QURAN_COM = 'https://api.quran.com/api/v4'
const ALQURAN_CLOUD = 'https://api.alquran.cloud/v1'
const QURANPEDIA = 'https://api.quranpedia.net/v1'
export const SPA5K_HOSTS = [
  'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@v1.2.3/tafsir',
  'https://rawcdn.githack.com/spa5k/tafsir_api/v1.2.3/tafsir',
  'https://raw.githubusercontent.com/spa5k/tafsir_api/v1.2.3/tafsir',
]
/** spa5k serves QUL (Tarteel) editions of the same works as Quran.com: keep them no longer than QF content. */
const SPA5K_TTL_MS = QF_TTL_MS
/** QuranEnc answers no-store; cache in the app for a week and credit the live version. */
const QURANENC_TTL_MS = 7 * DAY_MS
/** Quranpedia sends max-age=86400. */
const QURANPEDIA_TTL_MS = DAY_MS

const nonEmpty = (t: string | null | undefined): t is string => typeof t === 'string' && t.trim().length > 0

export function quranEncProvider(key: string, creditAr = 'QuranEnc.com'): TafsirProvider {
  return {
    id: `quranenc:${key}`,
    creditAr,
    async fetchAyah(surah, ayah, signal) {
      const j = await fetchJson<{ result?: { translation?: string } }>(`${QURANENC}/translation/aya/${key}/${surah}/${ayah}`, { signal, ttlMs: QURANENC_TTL_MS, allow404: true })
      const t = j?.result?.translation
      return nonEmpty(t) ? { text: htmlToText(t), covers: [] } : null
    },
  }
}

/** Parses a Quran.com /tafsirs/{id}/by_ayah response (shape A: covered ayahs are the keys of tafsir.verses). */
export function quranComTafsirRow(json: unknown, surah: number): TafsirRow | null {
  const t = (json as { tafsir?: { text?: string; verses?: Record<string, unknown> } })?.tafsir
  if (!t || !nonEmpty(t.text)) return null
  const covers = Object.keys(t.verses ?? {})
    .map((k) => k.split(':').map(Number))
    .filter(([s, a]) => s === surah && Number.isInteger(a) && a > 0)
    .map(([, a]) => a)
  return { text: htmlToText(t.text), covers }
}

export function quranComProvider(resourceId: number, creditAr = 'Quran.com / Quran Foundation'): TafsirProvider {
  return {
    id: `quran.com:${resourceId}`,
    creditAr,
    async fetchAyah(surah, ayah, signal) {
      const j = await fetchJson(`${QURAN_COM}/tafsirs/${resourceId}/by_ayah/${surah}:${ayah}`, { signal, ttlMs: QF_TTL_MS, allow404: true })
      return j ? quranComTafsirRow(j, surah) : null
    },
  }
}

export function alquranCloudProvider(edition: string, creditAr = 'AlQuran.cloud'): TafsirProvider {
  return {
    id: `alquran.cloud:${edition}`,
    creditAr,
    async fetchAyah(surah, ayah, signal) {
      const j = await fetchJson<{ data?: { text?: string } }>(`${ALQURAN_CLOUD}/ayah/${surah}:${ayah}/${edition}`, { signal, ttlMs: QF_TTL_MS, allow404: true })
      const t = j?.data?.text
      return nonEmpty(t) ? { text: htmlToText(t), covers: [] } : null
    },
  }
}

/** spa5k/tafsir_api static files; jsDelivr sometimes answers 403 "Package size exceeded" → next host. */
export function spa5kProvider(slug: string, creditAr = 'QUL (qul.tarteel.ai) عبر spa5k/tafsir_api'): TafsirProvider {
  return {
    id: `spa5k:${slug}`,
    creditAr,
    async fetchAyah(surah, ayah, signal) {
      const causes: unknown[] = []
      for (const base of SPA5K_HOSTS) {
        try {
          const j = await fetchJson<{ text?: string }>(`${base}/${slug}/${surah}/${ayah}.json`, { signal, ttlMs: SPA5K_TTL_MS, allow404: true, retries: 1 })
          if (!j) return null
          const t = j.text
          if (!nonEmpty(t)) return null
          const text = htmlToText(stripEditorNotes(stripSurahIntro(t)))
          return text ? { text, covers: [] } : null
        } catch (e) {
          if (isAbortError(e)) throw e
          causes.push(e)
        }
      }
      throw new ProvidersFailedError(`spa5k ${slug} ${surah}:${ayah}`, causes)
    },
  }
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
const QP_HEADING = /^\s*\{\s*([٠-٩0-9]+)\s*(?:-\s*([٠-٩0-9]+))?\s*\}/u
/** Page-based books map the last ayahs to their whole front matter (Ibn Kathir 114:6 → 173 pages): distrust more. */
const QP_MAX_PAGES = 40

interface QpItem {
  text: string
  page: number | null
  /** "{a - b}" group heading at the start of the item (Sa'di), in the requested surah's numbering */
  range: [number, number] | null
}

function qpHeading(text: string): [number, number] | null {
  const m = QP_HEADING.exec(text.replace(/^(\s*<[^>]+>)+/, ''))
  if (!m) return null
  const a = Number(toLatinDigits(m[1]))
  const b = m[2] ? Number(toLatinDigits(m[2])) : a
  return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a ? [a, b] : null
}

const consecutive = (prev: QpItem, next: QpItem) => prev.page === null || next.page === null || (next.page >= prev.page && next.page - prev.page <= 2)
/** a surah title page ("تفسير سورة البقرة وهي مدنية") that the next surah's group starts with */
const isSurahTitle = (it: QpItem) => it.range === null && it.text.length < 80 && /^\s*(<[^>]+>\s*)*تفسير سورة/u.test(it.text)

/**
 * Quranpedia /ayah/{s}/{a}/book/{id}: content[] holds one item per printed page. Books with "{a - b}" group
 * headings (Sa'di) can put several groups — even the next surah's — on the same page, and attach unrelated pages
 * (front matter, appendices) to some ayahs: take the first group whose heading contains the ayah plus its
 * continuation pages, and report the heading's range as covers. Books without headings: concatenate the pages
 * when they are one run of consecutive pages, otherwise (front matter attached to the last ayahs) treat it as no
 * entry. Empty content = no entry (the Ahkam books only cover ayahs of rulings).
 */
export function quranpediaRow(json: unknown, ayah: number): TafsirRow | null {
  const raw = (json as { content?: { text?: unknown; page?: unknown }[] })?.content
  if (!Array.isArray(raw)) return null
  const items: QpItem[] = []
  for (const it of raw) {
    if (typeof it?.text !== 'string' || !nonEmpty(it.text)) continue
    items.push({ text: it.text, page: typeof it.page === 'number' ? it.page : null, range: qpHeading(it.text) })
  }
  if (items.length === 0) return null
  const toRow = (picked: QpItem[], covers: number[]): TafsirRow | null => {
    const text = picked
      .filter((it) => !isSurahTitle(it))
      .map((it) => htmlToText(it.text))
      .filter(Boolean)
      .join('\n\n')
    return text ? { text, covers } : null
  }
  if (items.some((it) => it.range)) {
    const i = items.findIndex((it) => it.range !== null && it.range[0] <= ayah && ayah <= it.range[1])
    if (i < 0) return null
    const picked = [items[i]]
    for (let k = i + 1; k < items.length && items[k].range === null && consecutive(items[k - 1], items[k]); k++) picked.push(items[k])
    const [a, b] = items[i].range as [number, number]
    const covers: number[] = []
    for (let x = a; x <= b; x++) if (x !== ayah) covers.push(x)
    return toRow(picked, covers)
  }
  if (items.length > QP_MAX_PAGES) return null
  for (let k = 1; k < items.length; k++) if (!consecutive(items[k - 1], items[k])) return null
  return toRow(items, [])
}

export function quranpediaProvider(bookId: number, creditAr = 'quranpedia.net'): TafsirProvider {
  return {
    id: `quranpedia:${bookId}`,
    creditAr,
    async fetchAyah(surah, ayah, signal) {
      const j = await fetchJson(`${QURANPEDIA}/ayah/${surah}/${ayah}/book/${bookId}`, { signal, ttlMs: QURANPEDIA_TTL_MS, allow404: true })
      return j ? quranpediaRow(j, ayah) : null
    },
  }
}

// ───────────────────────── sources ─────────────────────────

interface TafsirDef {
  source: TafsirSource
  /** the work's attribution (author/publisher); the provider's host credit is appended */
  workAr: string
  providers: TafsirProvider[]
  /** true when ayahs without an entry are normal (Sa'di's 59 gaps, Ahkam books) — a 404 is then a gap, not a failure */
  gaps: boolean
}

const def = (source: Omit<TafsirSource, 'creditAr'>, workAr: string, providers: TafsirProvider[], gaps = false): TafsirDef => ({
  source: { ...source, creditAr: `${workAr} · ${providers[0].creditAr}` },
  workAr,
  providers,
  gaps,
})

const QENC_MUKHTASAR_CREDIT = 'QuranEnc.com (الإصدار 1.0.0)'

export const TAFSIR_DEFS: TafsirDef[] = [
  def(
    {
      id: 'mukhtasar',
      nameAr: 'المختصر في تفسير القرآن الكريم',
      nameEn: 'Al-Mukhtasar fi Tafsir al-Quran',
      length: 'short',
      kind: 'tafsir',
      noteAr: 'تفسير معاصر مختصر، فقرة قصيرة لكل آية — الأنسب للمشاركة',
    },
    'المختصر في تفسير القرآن الكريم — مركز تفسير للدراسات القرآنية',
    [quranEncProvider('arabic_mokhtasar', QENC_MUKHTASAR_CREDIT), spa5kProvider('ar-tafsir-al-mukhtasar'), quranpediaProvider(2003)],
  ),
  def(
    {
      id: 'muyassar',
      nameAr: 'التفسير الميسر',
      nameEn: 'Tafsir al-Muyassar',
      length: 'short',
      kind: 'tafsir',
      noteAr: 'تفسير ميسّر قصير، قد يجمع عدة آيات في فقرة واحدة',
    },
    'التفسير الميسر — مجمع الملك فهد لطباعة المصحف الشريف',
    [
      quranComProvider(16),
      quranEncProvider('arabic_moyassar', 'QuranEnc.com (الإصدار 1.0.1)'),
      alquranCloudProvider('ar.muyassar'),
      spa5kProvider('ar-tafsir-muyassar'),
      quranpediaProvider(2012),
    ],
  ),
  def(
    {
      id: 'jalalayn',
      nameAr: 'تفسير الجلالين',
      nameEn: 'Tafsir al-Jalalayn',
      length: 'short',
      kind: 'tafsir',
      noteAr: 'تفسير موجز يمزج كلمات الآية بشرحها',
    },
    'تفسير الجلالين — جلال الدين المحلي وجلال الدين السيوطي',
    [spa5kProvider('ar-tafsir-al-jalalayn'), alquranCloudProvider('ar.jalalayn'), quranpediaProvider(272)],
  ),
  def(
    {
      id: 'saadi',
      nameAr: 'تفسير السعدي',
      nameEn: "Tafsir al-Sa'di",
      length: 'medium',
      kind: 'tafsir',
      noteAr: 'تيسير الكريم الرحمن: تفسير متوسط الطول بعبارة سهلة',
    },
    'تيسير الكريم الرحمن في تفسير كلام المنان — عبد الرحمن بن ناصر السعدي',
    [quranComProvider(91), spa5kProvider('ar-tafseer-al-saddi'), quranpediaProvider(3)],
    true,
  ),
  def(
    {
      id: 'ibnkathir',
      nameAr: 'تفسير ابن كثير',
      nameEn: 'Tafsir Ibn Kathir',
      length: 'long',
      kind: 'tafsir',
      noteAr: 'تفسير القرآن العظيم: تفسير بالمأثور مطوّل — للقراءة داخل التطبيق',
    },
    'تفسير القرآن العظيم — أبو الفداء إسماعيل بن كثير',
    [quranComProvider(14), spa5kProvider('ar-tafsir-ibn-kathir'), quranpediaProvider(136)],
  ),
  def(
    {
      id: 'tabari',
      nameAr: 'تفسير الطبري',
      nameEn: 'Tafsir al-Tabari',
      length: 'long',
      kind: 'tafsir',
      noteAr: 'جامع البيان: أوسع تفاسير المأثور — للقراءة داخل التطبيق',
    },
    'جامع البيان عن تأويل آي القرآن — محمد بن جرير الطبري',
    // Quran.com 15 cuts long entries at 64 KB: last resort
    [spa5kProvider('ar-tafsir-al-tabari'), quranpediaProvider(4), quranComProvider(15)],
  ),
  def(
    {
      id: 'baghawi',
      nameAr: 'تفسير البغوي',
      nameEn: 'Tafsir al-Baghawi',
      length: 'long',
      kind: 'tafsir',
      noteAr: 'معالم التنزيل: تفسير بالمأثور — للقراءة داخل التطبيق',
    },
    'معالم التنزيل — الحسين بن مسعود البغوي',
    [quranComProvider(94), alquranCloudProvider('ar.baghawi'), spa5kProvider('ar-tafsir-al-baghawi'), quranpediaProvider(2)],
  ),
  def(
    {
      id: 'wasit',
      nameAr: 'التفسير الوسيط',
      nameEn: 'Al-Tafsir al-Wasit (Tantawi)',
      length: 'long',
      kind: 'tafsir',
      noteAr: 'تفسير معاصر مطوّل لمحمد سيد طنطاوي — للقراءة داخل التطبيق',
    },
    'التفسير الوسيط للقرآن الكريم — محمد سيد طنطاوي',
    [quranComProvider(93), alquranCloudProvider('ar.waseet'), spa5kProvider('ar-tafsir-al-wasit'), quranpediaProvider(321)],
  ),
  def(
    {
      id: 'qurtubi',
      nameAr: 'تفسير القرطبي',
      nameEn: "Al-Qurtubi, al-Jami' li-Ahkam al-Quran",
      length: 'long',
      kind: 'ahkam',
      noteAr: 'الجامع لأحكام القرآن: الأحكام الفقهية مفصّلة في مسائل — طويل',
    },
    'الجامع لأحكام القرآن — أبو عبد الله القرطبي',
    // complete text first; Quran.com 90 and alquran.cloud cut long entries at 64 KB
    [spa5kProvider('ar-tafseer-al-qurtubi'), quranComProvider(90), alquranCloudProvider('ar.qurtubi')],
  ),
  def(
    {
      id: 'ahkam-ibn-alarabi',
      nameAr: 'أحكام القرآن لابن العربي',
      nameEn: "Ahkam al-Quran (Ibn al-'Arabi)",
      length: 'long',
      kind: 'ahkam',
      noteAr: 'آيات الأحكام فقط؛ الآيات التي ليس فيها حكم لا نص لها',
    },
    'أحكام القرآن — أبو بكر ابن العربي',
    [quranpediaProvider(27780)],
    true,
  ),
  def(
    {
      id: 'ahkam-jassas',
      nameAr: 'أحكام القرآن للجصاص',
      nameEn: 'Ahkam al-Quran (al-Jassas)',
      length: 'long',
      kind: 'ahkam',
      noteAr: 'آيات الأحكام فقط على مذهب الحنفية؛ الآيات التي ليس فيها حكم لا نص لها',
    },
    'أحكام القرآن — أبو بكر الجصاص',
    [quranpediaProvider(27773)],
    true,
  ),
  def(
    {
      id: 'ahkam-kiya-harrasi',
      nameAr: 'أحكام القرآن للكيا الهراسي',
      nameEn: 'Ahkam al-Quran (Kiya al-Harrasi)',
      length: 'long',
      kind: 'ahkam',
      noteAr: 'آيات الأحكام فقط على مذهب الشافعية؛ الآيات التي ليس فيها حكم لا نص لها',
    },
    'أحكام القرآن — إلكيا الهراسي',
    [quranpediaProvider(27778)],
    true,
  ),
  def(
    {
      id: 'ahkam-ibn-alfaras',
      nameAr: 'أحكام القرآن لابن الفرس',
      nameEn: 'Ahkam al-Quran (Ibn al-Faras)',
      length: 'long',
      kind: 'ahkam',
      noteAr: 'آيات الأحكام فقط؛ الآيات التي ليس فيها حكم لا نص لها',
    },
    'أحكام القرآن — ابن الفرس الأندلسي',
    [quranpediaProvider(27781)],
    true,
  ),
]

export const TAFSIR_LIST: TafsirSource[] = TAFSIR_DEFS.map((d) => d.source)

// ───────────────────────── merging (3 group shapes + gaps) ─────────────────────────

export interface AyahRow {
  ayah: number
  row: TafsirRow | null
}

/**
 * Rows (any order) → passages. Shape A: covers widen the range; shape B: consecutive ayahs with the same text
 * (canonical compare) are one passage; shape C: null rows are gaps. Returns each passage once with its full
 * ayah range, keeping only passages that touch [from, to].
 */
export function mergeTafsirRows(rows: AyahRow[], from: number, to: number): TafsirEntry[] {
  const sorted = [...rows].sort((a, b) => a.ayah - b.ayah)
  const blocks: { from: number; to: number; text: string; canon: string }[] = []
  for (const r of sorted) {
    if (!r.row) continue
    const lo = Math.min(r.ayah, ...r.row.covers)
    const hi = Math.max(r.ayah, ...r.row.covers)
    const canon = canonText(r.row.text)
    const last = blocks[blocks.length - 1]
    if (last && last.canon === canon && lo <= last.to + 1) {
      last.from = Math.min(last.from, lo)
      last.to = Math.max(last.to, hi)
      continue
    }
    blocks.push({ from: lo, to: hi, text: r.row.text, canon })
  }
  return blocks.filter((b) => b.to >= from && b.from <= to).map((b) => ({ ayahFrom: b.from, ayahTo: b.to, text: b.text }))
}

// ───────────────────────── fetching ─────────────────────────

/** Stops extending a duplicated-text group after this many neighbours on each side. */
const MAX_GROUP_EXTENSION = 12

async function rowsFromProvider(p: TafsirProvider, gaps: boolean, surah: number, from: number, to: number, signal?: AbortSignal): Promise<AyahRow[]> {
  const n = versesIn(surah)
  const requested: number[] = []
  for (let a = from; a <= to; a++) requested.push(a)
  const edges = [from - 1, to + 1].filter((a) => a >= 1 && a <= n)
  const safe = async (a: number): Promise<TafsirRow | null> => {
    try {
      return await p.fetchAyah(surah, a, signal)
    } catch (e) {
      if (isAbortError(e)) throw e
      return null // neighbours only refine a group's range
    }
  }
  const [main, edgeRows] = await Promise.all([
    mapLimit(requested, 6, (a) => p.fetchAyah(surah, a, signal)),
    mapLimit(edges, 2, safe),
  ])
  if (!gaps && main.some((r) => r === null)) throw new HttpError(404, `${p.id} ${surah}:${from}-${to}`, `${p.id}: no entry for some ayahs of ${surah}:${from}-${to}`)
  const rows: AyahRow[] = requested.map((a, i) => ({ ayah: a, row: main[i] }))
  edges.forEach((a, i) => rows.push({ ayah: a, row: edgeRows[i] }))
  // shape B groups (duplicated text, no covers) can continue past the edges: walk outwards while the text repeats
  const same = (x: TafsirRow | null, y: TafsirRow | null) => !!x && !!y && canonText(x.text) === canonText(y.text)
  const byAyah = new Map(rows.map((r) => [r.ayah, r.row]))
  for (const dir of [-1, 1] as const) {
    let inner = dir < 0 ? from : to
    for (let k = 0; k < MAX_GROUP_EXTENSION; k++) {
      const innerRow = byAyah.get(inner) ?? null
      if (!innerRow) break
      // shape A: the source states the group's range in covers — nothing to discover
      if ((dir < 0 ? Math.min(inner, ...innerRow.covers) : Math.max(inner, ...innerRow.covers)) !== inner) break
      const edge = inner + dir
      if (edge < 1 || edge > n) break
      if (!byAyah.has(edge)) {
        const row = await safe(edge)
        byAyah.set(edge, row)
        rows.push({ ayah: edge, row })
      }
      if (!same(byAyah.get(edge) ?? null, innerRow)) break
      inner = edge
    }
  }
  return rows
}

async function quranEncVersion(key: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const j = await fetchJson<{ version?: string }>(`${QURANENC}/translations/updates?key=${key}`, { signal, ttlMs: QURANENC_TTL_MS, retries: 0 })
    return typeof j?.version === 'string' && /^[0-9.]+$/.test(j.version) ? j.version : null
  } catch (e) {
    if (isAbortError(e)) throw e
    return null
  }
}

export function getTafsirDef(id: string): TafsirDef | undefined {
  return TAFSIR_DEFS.find((d) => d.source.id === id)
}

export async function fetchTafsirResultImpl(tafsirId: string, surah: number, fromAyah: number, toAyah: number, signal?: AbortSignal): Promise<TafsirResult> {
  throwIfAborted(signal)
  const d = getTafsirDef(tafsirId)
  if (!d) throw new RangeError(`unknown tafsir: ${tafsirId}`)
  checkRange(surah, fromAyah, toAyah)
  const causes: unknown[] = []
  for (const p of d.providers) {
    throwIfAborted(signal)
    try {
      const rows = await rowsFromProvider(p, d.gaps, surah, fromAyah, toAyah, signal)
      let creditAr = `${d.workAr} · ${p.creditAr}`
      // QuranEnc terms: credit the edition's live version, whichever QuranEnc edition answered
      if (p.id.startsWith('quranenc:')) {
        const v = await quranEncVersion(p.id.slice('quranenc:'.length), signal)
        if (v) creditAr = `${d.workAr} · QuranEnc.com (الإصدار ${v})`
      }
      return { entries: mergeTafsirRows(rows, fromAyah, toAyah), providerId: p.id, creditAr }
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) throw e
      causes.push(e)
    }
  }
  throw new ProvidersFailedError(`tafsir ${tafsirId} ${surah}:${fromAyah}-${toAyah}`, causes)
}

export async function fetchTafsirImpl(tafsirId: string, surah: number, fromAyah: number, toAyah: number, signal?: AbortSignal): Promise<TafsirEntry[]> {
  return (await fetchTafsirResultImpl(tafsirId, surah, fromAyah, toAyah, signal)).entries
}
