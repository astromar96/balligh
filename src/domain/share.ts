// Share links: all state in the URL query (no backend). Versioned, compact, stable key order:
//   v=1&s=2&a=255-257&r=alafasy&i=1&tf=mukhtasar&tr=20&ar=1x1&tj=1    (whole ayahs; i=1 = with the isti'adha)
//   v=1&s=2&f=255.3&t=257.5&r=alafasy                                  (words; f=255 = from word 1, t=257 = to the ayah end)
// Only design fields that differ from DEFAULT_DESIGN are written; an uploaded background is never shared.
import type { Aspect, Ayah, DesignOptions, Selection, WordRef } from '../core/types'
import type { ShareState } from './index'
import { ayahCountOf, MAX_WORDS_PER_AYAH } from './quran-meta'
import { AYAH_END_WORD, firstPosition, indexAyahs, lastPosition, normalizeSelection } from './selection'

export const SHARE_VERSION = 1

/** Background preset of DEFAULT_DESIGN (a dark preset drawn by render/BACKGROUND_PRESETS). */
const DEFAULT_BACKGROUND_ID = 'lapis-night'

export const DEFAULT_DESIGN: DesignOptions = Object.freeze({
  aspect: '9:16',
  background: Object.freeze({ kind: 'preset', id: DEFAULT_BACKGROUND_ID }),
  overlay: 0.35,
  blur: 0,
  textTone: 'light',
  fontScale: 1,
  showTajweed: false,
  showRulesLegend: false,
  showTranslation: false,
  showTafsir: false,
  showSurahHeader: true,
  showAyahNumbers: true,
  showWaqfMarks: true,
  showReciterName: true,
  highlightWords: true,
  showWatermark: true,
}) as DesignOptions

// ── value codecs ──

const ASPECT_CODE: Record<Aspect, string> = { '9:16': '9x16', '4:5': '4x5', '1:1': '1x1', '16:9': '16x9' }
const ASPECT_BY_CODE: Record<string, Aspect> = {
  '9x16': '9:16', '4x5': '4:5', '1x1': '1:1', '16x9': '16:9',
  '9:16': '9:16', '4:5': '4:5', '1:1': '1:1', '16:9': '16:9',
}

type NumberField = 'overlay' | 'blur' | 'fontScale'
const NUMBER_FIELDS: readonly { field: NumberField; key: string; min: number; max: number }[] = [
  { field: 'overlay', key: 'ov', min: 0, max: 0.85 },
  { field: 'blur', key: 'bl', min: 0, max: 24 },
  { field: 'fontScale', key: 'fs', min: 0.75, max: 1.4 },
]

type BooleanField = {
  [K in keyof DesignOptions]: DesignOptions[K] extends boolean ? K : never
}[keyof DesignOptions]
const BOOLEAN_FIELDS: readonly { field: BooleanField; key: string }[] = [
  { field: 'showTajweed', key: 'tj' },
  { field: 'showRulesLegend', key: 'lg' },
  { field: 'showTranslation', key: 'st' },
  { field: 'showTafsir', key: 'sf' },
  { field: 'showSurahHeader', key: 'sh' },
  { field: 'showAyahNumbers', key: 'an' },
  { field: 'showWaqfMarks', key: 'wq' },
  { field: 'showReciterName', key: 'rn' },
  { field: 'highlightWords', key: 'hw' },
  { field: 'showWatermark', key: 'wm' },
]

/** Ids of reciters, tafsirs and background presets: short ASCII slugs. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
/** Shortest exact text for a number (String() round-trips every double); never "-0". */
const num = (n: number) => String(n === 0 ? 0 : n)

function parseNumber(s: string): number | null {
  if (!NUMBER_RE.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseBoolean(s: string): boolean | null {
  if (s === '1' || s === 'true') return true
  if (s === '0' || s === 'false') return false
  return null
}

// ── selection codec ──

/** "255" or "255.3" (":" also accepted on input). */
const REF_RE = /^(\d{1,3})(?:[.:](\d{1,4}))?$/

function parseRef(s: string | undefined): { ayah: number; word: number | null } | null {
  const m = s ? REF_RE.exec(s) : null
  if (!m) return null
  return { ayah: Number(m[1]), word: m[2] === undefined ? null : Number(m[2]) }
}

function decodeSelection(p: Map<string, string>, surah: number): Selection | null {
  const count = ayahCountOf(surah)
  let from: { ayah: number; word: number | null } | null = null
  let to: { ayah: number; word: number | null } | null = null
  const f = parseRef(p.get('f'))
  const t = parseRef(p.get('t'))
  if (f || t) {
    from = f ?? (t ? { ayah: t.ayah, word: null } : null)
    to = t ?? (f ? { ayah: f.ayah, word: null } : null)
  } else {
    const m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(p.get('a') ?? '')
    if (m) {
      from = { ayah: Number(m[1]), word: null }
      to = { ayah: Number(m[2] ?? m[1]), word: null }
    }
  }
  if (!from || !to) return null
  if (from.ayah > to.ayah) [from, to] = [to, from]
  if (from.ayah < 1 || from.ayah > count) return null
  let endWord = to.word
  if (to.ayah > count) {
    to = { ayah: count, word: null }
    endWord = null
  }
  const startWord = from.word ?? 1
  if (startWord < 1 || startWord > MAX_WORDS_PER_AYAH) return null
  const end: WordRef = {
    ayah: to.ayah,
    word: endWord === null || endWord > MAX_WORDS_PER_AYAH ? AYAH_END_WORD : Math.max(1, endWord),
  }
  return normalizeSelection({ surah, start: { ayah: from.ayah, word: startWord }, end })
}

// ── query string ──

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return null
  }
}

/** First value of each key; tolerates a leading "?", a full URL and a trailing "#fragment". */
function parseQuery(query: string): Map<string, string> {
  let q = typeof query === 'string' ? query : ''
  const qm = q.indexOf('?')
  if (qm >= 0) q = q.slice(qm + 1)
  const hash = q.indexOf('#')
  if (hash >= 0) q = q.slice(0, hash)
  const out = new Map<string, string>()
  for (const part of q.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const k = safeDecode(eq >= 0 ? part.slice(0, eq) : part)
    const v = safeDecode(eq >= 0 ? part.slice(eq + 1) : '')
    if (k === null || v === null || out.has(k)) continue
    out.set(k, v.trim())
  }
  return out
}

/**
 * `ayahs` (the surah's ayahs) is optional: with it a selection of whole ayahs is written compactly as
 * `a=255-257` even when its end word is a real position; decoding then returns AYAH_END_WORD as the end
 * word, which clampSelection(selection, ayahs) turns back into that position.
 */
export function encodeShareState(state: ShareState, ayahs?: Ayah[]): string {
  const pairs: [string, string][] = [['v', String(SHARE_VERSION)]]
  const sel = normalizeSelection(state.selection)
  pairs.push(['s', String(sel.surah)])
  const byNo = indexAyahs(ayahs, sel.surah)
  const a = byNo.get(sel.start.ayah)
  const b = byNo.get(sel.end.ayah)
  const startWord = clamp(sel.start.word, 1, MAX_WORDS_PER_AYAH)
  const startWhole = startWord <= (a && a.words.length ? firstPosition(a) : 1)
  const endWhole = sel.end.word > MAX_WORDS_PER_AYAH || (!!b && b.words.length > 0 && sel.end.word >= lastPosition(b))
  if (startWhole && endWhole) {
    pairs.push(['a', sel.start.ayah === sel.end.ayah ? `${sel.start.ayah}` : `${sel.start.ayah}-${sel.end.ayah}`])
  } else {
    pairs.push(['f', startWhole ? `${sel.start.ayah}` : `${sel.start.ayah}.${startWord}`])
    pairs.push(['t', endWhole ? `${sel.end.ayah}` : `${sel.end.ayah}.${Math.max(1, sel.end.word)}`])
  }
  if (typeof state.reciterId === 'string' && ID_RE.test(state.reciterId)) pairs.push(['r', state.reciterId])
  if (state.istiadha === true) pairs.push(['i', '1'])
  if (typeof state.tafsirId === 'string' && ID_RE.test(state.tafsirId)) pairs.push(['tf', state.tafsirId])
  const tr = state.translationId
  if (typeof tr === 'number' && Number.isInteger(tr) && tr > 0) pairs.push(['tr', String(tr)])

  const d = state.design ?? {}
  if (d.aspect && d.aspect !== DEFAULT_DESIGN.aspect && ASPECT_CODE[d.aspect]) pairs.push(['ar', ASPECT_CODE[d.aspect]])
  const bg = d.background
  if (bg && bg.kind === 'preset' && ID_RE.test(bg.id) && bg.id !== DEFAULT_BACKGROUND_ID) pairs.push(['bg', bg.id])
  for (const { field, key, min, max } of NUMBER_FIELDS) {
    const v = d[field]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const c = clamp(v, min, max)
    if (c !== DEFAULT_DESIGN[field]) pairs.push([key, num(c)])
  }
  if ((d.textTone === 'light' || d.textTone === 'dark') && d.textTone !== DEFAULT_DESIGN.textTone) {
    pairs.push(['tt', d.textTone === 'dark' ? 'd' : 'l'])
  }
  for (const { field, key } of BOOLEAN_FIELDS) {
    const v = d[field]
    if (typeof v === 'boolean' && v !== DEFAULT_DESIGN[field]) pairs.push([key, v ? '1' : '0'])
  }
  return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

export function decodeShareState(query: string): ShareState | null {
  const p = parseQuery(query)
  const v = p.get('v')
  if (v !== undefined && v !== String(SHARE_VERSION)) return null
  const surahText = p.get('s') ?? ''
  const surah = /^\d{1,3}$/.test(surahText) ? Number(surahText) : 0
  if (ayahCountOf(surah) === 0) return null
  const selection = decodeSelection(p, surah)
  if (!selection) return null

  const r = p.get('r') ?? ''
  const tf = p.get('tf') ?? ''
  const tr = p.get('tr') ?? ''
  const design: Partial<DesignOptions> = {}
  const aspect = ASPECT_BY_CODE[p.get('ar') ?? '']
  if (aspect && aspect !== DEFAULT_DESIGN.aspect) design.aspect = aspect
  const bg = p.get('bg') ?? ''
  if (ID_RE.test(bg) && bg !== DEFAULT_BACKGROUND_ID) design.background = { kind: 'preset', id: bg }
  for (const { field, key, min, max } of NUMBER_FIELDS) {
    const n = parseNumber(p.get(key) ?? '')
    if (n === null) continue
    const c = clamp(n, min, max)
    if (c !== DEFAULT_DESIGN[field]) design[field] = c
  }
  const tone = p.get('tt')
  const textTone = tone === 'd' || tone === 'dark' ? 'dark' : tone === 'l' || tone === 'light' ? 'light' : null
  if (textTone && textTone !== DEFAULT_DESIGN.textTone) design.textTone = textTone
  for (const { field, key } of BOOLEAN_FIELDS) {
    const b = parseBoolean(p.get(key) ?? '')
    if (b !== null && b !== DEFAULT_DESIGN[field]) design[field] = b
  }
  return {
    selection,
    reciterId: ID_RE.test(r) ? r : '',
    // present only when on, so a link without `i` decodes to exactly the state that produced it
    ...(parseBoolean(p.get('i') ?? '') === true ? { istiadha: true } : {}),
    tafsirId: ID_RE.test(tf) ? tf : null,
    translationId: /^\d{1,7}$/.test(tr) && Number(tr) > 0 ? Number(tr) : null,
    design: orderDesign(design),
  }
}

/** Same field order as DEFAULT_DESIGN, so decoded objects compare and print predictably. */
function orderDesign(d: Partial<DesignOptions>): Partial<DesignOptions> {
  const out: Partial<DesignOptions> = {}
  for (const k of Object.keys(DEFAULT_DESIGN) as (keyof DesignOptions)[]) {
    if (d[k] !== undefined) (out as Record<string, unknown>)[k] = d[k]
  }
  return out
}
