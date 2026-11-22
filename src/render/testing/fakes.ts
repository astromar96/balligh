// Test doubles for render/: a recording Painter, Graphics whose surfaces record too, and a synthetic
// QuranFont with predictable shaping (one glyph per UTF-16 unit, marks zero-advance). Node-only (tests).
import type { Ayah, DesignOptions, Graphics, ImageHandle, Paint, Painter, PathHandle, Reciter, RenderModel, Surface, TafsirSource, TextStyle, Timeline, TranslationSource, Word } from '../../core/types'
import type { QuranFont, ShapedRun } from '../index'

export type Call = [string, ...unknown[]]

export interface FakePath extends PathHandle {
  d: string
}

export interface FakeImage extends ImageHandle {
  id: string
  /** the calls that produced the pixels (surface snapshots) */
  log: Call[] | null
}

const paintKey = (p: Paint): unknown => (typeof p === 'string' ? p : JSON.stringify(p))

export class RecordingPainter implements Painter {
  readonly width: number
  readonly height: number
  readonly log: Call[] = []
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  save() {
    this.log.push(['save'])
  }
  restore() {
    this.log.push(['restore'])
  }
  translate(x: number, y: number) {
    this.log.push(['translate', round(x), round(y)])
  }
  scale(sx: number, sy: number) {
    this.log.push(['scale', round(sx), round(sy)])
  }
  alpha(a: number) {
    this.log.push(['alpha', round(a)])
  }
  clipRect(x: number, y: number, w: number, h: number) {
    this.log.push(['clipRect', round(x), round(y), round(w), round(h)])
  }
  fillRect(x: number, y: number, w: number, h: number, paint: Paint) {
    this.log.push(['fillRect', round(x), round(y), round(w), round(h), paintKey(paint)])
  }
  fillRoundRect(x: number, y: number, w: number, h: number, r: number, paint: Paint) {
    this.log.push(['fillRoundRect', round(x), round(y), round(w), round(h), round(r), paintKey(paint)])
  }
  strokeRoundRect(x: number, y: number, w: number, h: number, r: number, color: string, lw: number) {
    this.log.push(['strokeRoundRect', round(x), round(y), round(w), round(h), round(r), color, round(lw)])
  }
  fillPath(path: PathHandle, paint: Paint) {
    this.log.push(['fillPath', (path as FakePath).d, paintKey(paint)])
  }
  strokePath(path: PathHandle, color: string, lw: number) {
    this.log.push(['strokePath', (path as FakePath).d, color, round(lw)])
  }
  drawImage(img: ImageHandle, dx: number, dy: number, dw: number, dh: number, src?: { x: number; y: number; w: number; h: number }) {
    this.log.push(['drawImage', (img as FakeImage).id, round(dx), round(dy), round(dw), round(dh), src ? [round(src.x), round(src.y), round(src.w), round(src.h)] : null])
  }
  fillText(text: string, x: number, y: number, style: TextStyle) {
    this.log.push(['fillText', text, round(x), round(y), style.family, round(style.sizePx), style.color, style.align, style.direction])
  }
  measureText(text: string, style: TextStyle): number {
    return fakeTextWidth(text, style)
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000

export const fakeTextWidth = (text: string, style: TextStyle) => text.length * style.sizePx * 0.5

export interface FakeGraphics extends Graphics {
  surfaces: { id: string; width: number; height: number; painter: RecordingPainter }[]
  images: Map<string, FakeImage>
}

export function fakeGraphics(): FakeGraphics {
  const surfaces: FakeGraphics['surfaces'] = []
  const images = new Map<string, FakeImage>()
  let n = 0
  return {
    surfaces,
    images,
    makePath: (d: string): FakePath => ({ kind: 'path', d }),
    createSurface(width: number, height: number): Surface {
      const id = `s${n++}`
      const painter = new RecordingPainter(width, height)
      surfaces.push({ id, width, height, painter })
      return {
        painter,
        snapshot: () => {
          const img: FakeImage = { kind: 'image', width, height, id, log: painter.log }
          images.set(id, img)
          return img
        },
      }
    },
    loadImage: async (uri: string): Promise<ImageHandle> => {
      const img: FakeImage = { kind: 'image', width: 1600, height: 1200, id: `img:${uri}`, log: null }
      images.set(img.id, img)
      return img
    },
  }
}

const isMark = (ch: string) => /\p{Mn}/u.test(ch)

/** One glyph per UTF-16 unit: gid = char code, letters 500 units, space 300, marks 0 (own cluster). */
export function fakeFont(): QuranFont & { shapeCalls: number } {
  const cache = new Map<string, ShapedRun>()
  const font = {
    upem: 1000,
    ascender: 1800,
    descender: -600,
    shapeCalls: 0,
    shape(text: string, direction: 'rtl' | 'ltr' = 'rtl'): ShapedRun {
      const key = direction + text
      const hit = cache.get(key)
      if (hit) return hit
      font.shapeCalls++
      const logical = Array.from({ length: text.length }, (_, i) => {
        const ch = text[i]
        return { gid: ch.charCodeAt(0), cluster: i, xAdvance: isMark(ch) ? 0 : ch === ' ' ? 300 : 500, xOffset: 0, yOffset: 0 }
      })
      const glyphs = direction === 'rtl' ? logical.reverse() : logical
      const run = { glyphs, advance: glyphs.reduce((s, g) => s + g.xAdvance, 0) }
      cache.set(key, run)
      return run
    },
    glyphSvg(gid: number): string {
      const ch = String.fromCharCode(gid)
      if (ch === ' ') return ''
      if (isMark(ch)) return `M0 900L160 900L160 1100L0 1100Z`
      return `M0 -200L450 -200L450 750L0 750Z`
    },
  }
  return font
}

// ── models ──

export function word(position: number, text: string, extra: Partial<Word> = {}): Word {
  return { position, text, waqf: null, waqfChar: null, tajweed: [], ...extra }
}

export function ayah(number: number, words: Word[], surah = 2): Ayah {
  return { key: `${surah}:${number}`, surah, number, words, juz: 1, page: 1, sajdah: false }
}

/** Ayah with n synthetic words of `len` letters each. */
export function syntheticAyah(number: number, n: number, len = 4): Ayah {
  const letters = 'بتثجحخدذرزسشصضطظعغفقكلمنهوي'
  const words: Word[] = []
  for (let i = 1; i <= n; i++) {
    let t = ''
    for (let j = 0; j < len; j++) t += letters[(i * 7 + j * 3 + number) % letters.length]
    words.push(word(i, t))
  }
  return ayah(number, words)
}

export function makeModel(ayahs: Ayah[], extra: Partial<RenderModel> = {}): RenderModel {
  return {
    surah: {
      number: 2,
      nameArabic: 'البقرة',
      nameSimple: 'Al-Baqarah',
      nameTranslated: 'The Cow',
      versesCount: 286,
      revelationPlace: 'madinah',
      bismillahPre: true,
    },
    ayahs,
    partialStart: false,
    partialEnd: false,
    translation: null,
    translationSource: null,
    tafsir: null,
    tafsirSource: null,
    rules: [],
    reciter: null,
    timeline: null,
    basmala: false,
    istiadha: false,
    tafsirCreditAr: null,
    ...extra,
  }
}

export function reciter(extra: Partial<Reciter> = {}): Reciter {
  return {
    id: 'r',
    nameAr: 'القارئ التجريبي',
    nameEn: 'Test',
    style: null,
    timingClass: 'A',
    wordTimings: true,
    sourceName: 'EveryAyah.com · Quran.com',
    istiadha: true,
    ...extra,
  }
}

export function translationSource(extra: Partial<TranslationSource> = {}): TranslationSource {
  return { id: 20, lang: 'en', langName: 'English', name: 'Saheeh International', dir: 'ltr', script: 'Latn', ...extra }
}

export function tafsirSource(extra: Partial<TafsirSource> = {}): TafsirSource {
  return {
    id: 'mukhtasar',
    nameAr: 'المختصر في التفسير',
    nameEn: 'Al-Mukhtasar',
    length: 'short',
    kind: 'tafsir',
    noteAr: '',
    creditAr: 'مركز تفسير · QuranEnc.com',
    ...extra,
  }
}

export function makeDesign(extra: Partial<DesignOptions> = {}): DesignOptions {
  return {
    aspect: '9:16',
    background: { kind: 'preset', id: 'lapis-night' },
    overlay: 0,
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
    highlightWords: false,
    showWatermark: false,
    ...extra,
  }
}

/**
 * A timeline that gives every word `wordMs` and leaves `gapMs` between ayahs; optional leading isti'adha (ayah -1)
 * and basmala (ayah 0) windows, in that order.
 */
export function fakeTimeline(
  model: RenderModel,
  opts: { wordMs?: number; gapMs?: number; words?: boolean; basmalaMs?: number; istiadhaMs?: number } = {},
): Timeline {
  const wordMs = opts.wordMs ?? 500
  const gapMs = opts.gapMs ?? 400
  let t = 0
  const ayahs: Timeline['ayahs'] = []
  const words: Timeline['words'] = []
  if (opts.istiadhaMs) {
    ayahs.push({ ayah: -1, startMs: 0, endMs: opts.istiadhaMs })
    t = opts.istiadhaMs + gapMs
  }
  if (opts.basmalaMs) {
    ayahs.push({ ayah: 0, startMs: t, endMs: t + opts.basmalaMs })
    t += opts.basmalaMs + gapMs
  }
  for (const a of model.ayahs) {
    const start = t
    for (const w of a.words) {
      words.push({ ayah: a.number, word: w.position, startMs: t, endMs: t + wordMs - 40 })
      t += wordMs
    }
    ayahs.push({ ayah: a.number, startMs: start, endMs: t })
    t += gapMs
  }
  return { durationMs: t, ayahs, words: opts.words === false ? [] : words }
}

/** Every call of a scene draw, with surface snapshots expanded (for determinism checks). */
export function expandLog(log: Call[], images: Map<string, FakeImage>, depth = 0): unknown[] {
  if (depth > 6) return log
  return log.map((c) => {
    if (c[0] === 'drawImage') {
      const img = images.get(String(c[1]))
      return [...c, img?.log ? expandLog(img.log, images, depth + 1) : null]
    }
    return c
  })
}
