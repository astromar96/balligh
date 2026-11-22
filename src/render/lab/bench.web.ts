// Web test bench for render/ (route /lab/render). RenderModels come through the app's data module (lab/model.ts);
// it draws a preview grid into DOM canvases and exposes window.__renderLab for the headless-Chrome scripts: a PNG
// per case (any still page), contact sheets, every page of a still, frame-time measurements, and a glyph audit of
// the passages (missing glyphs, stray small meem, open tanween, printed pause marks). Lab only — not the app.
import type { DesignOptions, ImageHandle, RenderModel, Scene } from '../../core/types'
import { ASPECT_SIZES, createScene, ensureTextFonts, getGraphics, loadQuranFont, translationFontFamily, type QuranFont } from '../index'
import { buildUnits, splitPauseMarks } from '../layout'
import { createCanvasPainter } from '../platform.web'
import { ASPECTS, VARIANTS, type LabCase, type RenderedCase } from './cases'
import { DEFAULT_TRANSLATION, PASSAGES, SCRIPT_TRANSLATIONS, fakeTimeline, modelFromData } from './model'

export { ASPECTS, VARIANTS }
export type { LabCase, RenderedCase, Variant } from './cases'

const IMAGE_URL = 'https://picsum.photos/id/1018/1600/1200'

interface LabState {
  font: QuranFont
  /** key `${passage}|${translation id}` */
  models: Map<string, Promise<RenderModel>>
  image: ImageHandle | null
}

let state: Promise<LabState> | null = null

function designFor(c: LabCase): DesignOptions {
  const base: DesignOptions = {
    aspect: c.aspect,
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
    highlightWords: true,
    showWatermark: true,
  }
  const v: Partial<DesignOptions> =
    c.variant === 'tajweed'
      ? { background: { kind: 'preset', id: 'mushaf-paper' }, textTone: 'dark', showTajweed: true, showRulesLegend: true }
      : c.variant === 'translation'
        ? { background: { kind: 'preset', id: 'malachite-gilded' }, showTranslation: true }
        : c.variant === 'tafsir'
          ? { background: { kind: 'preset', id: 'ink-gold' }, showTafsir: true }
          : c.variant === 'image'
            ? { background: { kind: 'image', src: IMAGE_URL, focusX: 0.5, focusY: 0.55 }, overlay: 0.38, blur: 6 }
            : c.variant === 'all'
              ? { showTajweed: true, showRulesLegend: true, showTranslation: true, showTafsir: true }
              : {}
  const preset: Partial<DesignOptions> = c.preset ? { background: { kind: 'preset', id: c.preset } } : {}
  return { ...base, ...v, ...preset, ...(c.design ?? {}) }
}

function baseModel(s: LabState, passage: string, translation: number): Promise<RenderModel> {
  const key = `${passage}|${translation}`
  let m = s.models.get(key)
  if (!m) {
    const spec = PASSAGES.find((x) => x.id === passage)
    if (!spec) return Promise.reject(new Error(`unknown passage ${passage}`))
    m = modelFromData(spec, translation)
    s.models.set(key, m)
    m.catch(() => s.models.delete(key))
  }
  return m
}

async function init(onStatus: (s: string) => void): Promise<LabState> {
  onStatus('loading fonts…')
  const [font] = await Promise.all([loadQuranFont(), ensureTextFonts()])
  const s: LabState = { font, models: new Map(), image: null }
  for (const spec of PASSAGES) {
    onStatus(`fetching ${spec.id} through src/data…`)
    await baseModel(s, spec.id, DEFAULT_TRANSLATION)
  }
  try {
    s.image = await getGraphics().loadImage(IMAGE_URL)
  } catch (e) {
    console.warn('lab: background image failed', e)
  }
  return s
}

async function modelFor(s: LabState, c: LabCase): Promise<RenderModel> {
  const model: RenderModel = { ...(await baseModel(s, c.passage, c.translation ?? DEFAULT_TRANSLATION)) }
  model.timeline = c.t === 'still' ? null : fakeTimeline(model, { words: c.words !== false })
  return model
}

function timeOf(model: RenderModel, t: LabCase['t']): number {
  const d = model.timeline?.durationMs ?? 0
  if (typeof t === 'number') return t
  if (t === 'mid') return d / 2
  if (t === 'end') return Math.max(0, d - 400)
  return 0
}

function canvasFor(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  return { canvas, ctx }
}

type LabLayout = { size: number; pages: unknown[]; plan: string }
const layoutOf = (scene: Scene) => (scene as Scene & { layout?: LabLayout }).layout

/** Builds the scene of a case after the fonts it draws with are ready (what the app must do too). */
async function sceneFor(c: LabCase) {
  const s = await state!
  const model = await modelFor(s, c)
  const design = designFor(c)
  if (design.showTranslation && model.translationSource && model.translation) {
    await ensureTextFonts([model.translationSource.script], model.translation.map((e) => e.text).join(' ').slice(0, 4000))
  }
  const size = c.width && c.height ? { width: c.width, height: c.height } : ASPECT_SIZES[c.aspect]
  const t0 = performance.now()
  const scene = createScene(model, design, { font: s.font, graphics: getGraphics(), backgroundImage: s.image }, size)
  return { model, design, scene, size, buildMs: performance.now() - t0 }
}

/** The Noto family a shown translation is drawn with and how many of its faces are loaded (0 = system fallback). */
function translationFontOf(model: RenderModel, design: DesignOptions): RenderedCase['translationFont'] {
  const family = design.showTranslation && model.translationSource ? translationFontFamily(model.translationSource.script) : null
  if (!family) return null
  let loadedFaces = 0
  document.fonts.forEach((f) => {
    if (f.family.replace(/^["']|["']$/g, '') === family && f.status === 'loaded') loadedFaces++
  })
  return { family, loadedFaces }
}

export async function renderCaseToCanvas(c: LabCase): Promise<RenderedCase> {
  const { model, design, scene, size, buildMs } = await sceneFor(c)
  const t1 = performance.now()
  const { canvas, ctx } = canvasFor(size.width, size.height)
  const painter = createCanvasPainter(ctx, size.width, size.height)
  const tMs = timeOf(model, c.t)
  if (model.timeline) scene.draw(painter, tMs)
  else scene.drawPage(painter, c.page ?? 0)
  ctx.getImageData(0, 0, 1, 1)
  const layout = layoutOf(scene)
  return {
    canvas,
    buildMs,
    drawMs: performance.now() - t1,
    tMs,
    durationMs: scene.durationMs,
    quranPx: layout?.size,
    pages: layout?.pages.length,
    pageCount: scene.pageCount,
    plan: layout?.plan,
    translationFont: translationFontOf(model, design),
  }
}

async function renderCase(c: LabCase) {
  const r = await renderCaseToCanvas(c)
  return { ...r, canvas: undefined, png: r.canvas.toDataURL('image/png') }
}

const caption = (c: LabCase, r: RenderedCase) => {
  const t = typeof c.t === 'number' ? `${Math.round(c.t)}ms` : c.t
  const page = c.t === 'still' && r.pageCount > 1 ? ` p${(c.page ?? 0) + 1}/${r.pageCount}` : ''
  const tags = `${c.words === false ? ' ayah-timing' : ''}${c.translation ? ` tr${c.translation}` : ''}${c.preset ? ` ${c.preset}` : ''}`
  return `${c.passage} ${c.variant} ${c.aspect} ${t}${page}${tags} · ${r.quranPx?.toFixed(1)}px · ${r.plan ?? ''}`
}

/** Lays canvases out in rows (scaled to `cellH` px tall) with a caption above each; returns a PNG data URL. */
function compose(cells: { canvas: HTMLCanvasElement; text: string }[], cellH: number, cols: number): string {
  const sized = cells.map((x) => ({ ...x, w: Math.round((x.canvas.width / x.canvas.height) * cellH) }))
  const rows: (typeof sized)[] = []
  for (let i = 0; i < sized.length; i += cols) rows.push(sized.slice(i, i + cols))
  const gap = 16
  const cap = 34
  const W = Math.max(...rows.map((r) => r.reduce((s, x) => s + x.w + gap, gap)))
  const H = rows.length * (cellH + cap + gap) + gap
  const { canvas, ctx } = canvasFor(W, H)
  ctx.fillStyle = '#2b2f33'
  ctx.fillRect(0, 0, W, H)
  rows.forEach((row, ri) => {
    let x = gap
    const y = gap + ri * (cellH + cap + gap)
    for (const cell of row) {
      ctx.drawImage(cell.canvas, x, y + cap, cell.w, cellH)
      ctx.fillStyle = '#e8e8e8'
      ctx.font = '15px system-ui, sans-serif'
      ctx.direction = 'ltr'
      ctx.textAlign = 'left'
      ctx.fillText(cell.text, x, y + 22)
      x += cell.w + gap
    }
  })
  return canvas.toDataURL('image/png')
}

/** Renders cases side by side; returns a PNG data URL. */
async function sheet(cases: LabCase[], cellH = 640, cols = 4) {
  const cells: { canvas: HTMLCanvasElement; text: string }[] = []
  for (const c of cases) {
    const r = await renderCaseToCanvas(c)
    cells.push({ canvas: r.canvas, text: caption(c, r) })
  }
  return compose(cells, cellH, cols)
}

/** Every page of a still case (one scene, drawPage per page), side by side. */
async function stillPages(c: LabCase, cellH = 640, cols = 4) {
  const still = { ...c, t: 'still' as const }
  const { scene, size } = await sceneFor(still)
  const layout = layoutOf(scene)
  const cells: { canvas: HTMLCanvasElement; text: string }[] = []
  for (let k = 0; k < scene.pageCount; k++) {
    const { canvas, ctx } = canvasFor(size.width, size.height)
    scene.drawPage(createCanvasPainter(ctx, size.width, size.height), k)
    cells.push({ canvas, text: `${c.passage} ${c.variant} ${c.aspect} page ${k + 1}/${scene.pageCount} · ${layout?.size.toFixed(1)}px · ${layout?.plan}` })
  }
  return { png: compose(cells, cellH, cols), pageCount: scene.pageCount, plan: layout?.plan }
}

/** Frame-time measurement at a given size: JS time of draw(), and draw + a 1-px readback (GPU flush). */
async function perf(c: LabCase & { frames?: number }) {
  const { scene, size, buildMs } = await sceneFor(c.t === 'still' ? { ...c, t: 'mid' } : c)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')!
  const painter = createCanvasPainter(ctx, size.width, size.height)
  const frames = c.frames ?? 240
  const d = scene.durationMs
  const js: number[] = []
  const flushed: number[] = []
  // warm-up
  scene.draw(painter, 0)
  ctx.getImageData(0, 0, 1, 1)
  for (let i = 0; i < frames; i++) {
    const t = (d * i) / frames
    const a = performance.now()
    scene.draw(painter, t)
    const b = performance.now()
    ctx.getImageData(0, 0, 1, 1)
    const e = performance.now()
    js.push(b - a)
    flushed.push(e - a)
  }
  const stats = (xs: number[]) => {
    const sorted = [...xs].sort((p, q) => p - q)
    return {
      mean: xs.reduce((p, q) => p + q, 0) / xs.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
    }
  }
  return { size, frames, buildMs, durationMs: d, js: stats(js), withFlush: stats(flushed) }
}

/**
 * Glyph audit of passages as src/data delivers them, shaped with the real font: .notdef glyphs, small-meem glyphs
 * where the text has none (Tanzil's open tanween, 00-gaps §2.2), open tanween drawn with the plain glyph, Tanzil
 * tanween+meem left in the display text, and printed pause marks (waqfChar) that did not become a glyph.
 */
async function audit(ids: string[] = PASSAGES.map((p) => p.id)) {
  const s = await state!
  const font = s.font
  const gidOf = (ch: string) => font.shape(ch).glyphs.find((x) => font.glyphSvg(x.gid))?.gid ?? -1
  const meems = new Set([gidOf('ۢ'), gidOf('ۭ')])
  const PLAIN: Record<string, string> = { 'ࣰ': 'ً', 'ࣱ': 'ٌ', 'ࣲ': 'ٍ' }
  /** glyphs drawn for character i (Amiri swaps tanween glyphs by context, so open is compared with plain in place) */
  const glyphsAt = (text: string, i: number) => font.shape(text).glyphs.filter((x) => x.cluster === i).map((x) => x.gid)
  const out = []
  for (const id of ids) {
    const model = await baseModel(s, id, DEFAULT_TRANSLATION)
    const r = { passage: id, words: 0, notdef: [] as string[], strayMeem: [] as string[], openTanween: 0, openWrong: [] as string[], tanzilEncoded: [] as string[], waqfMarks: 0, waqfMismatch: [] as string[] }
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: true })
    const wordUnits = units.filter((u) => u.kind === 'word')
    let wi = 0
    for (const a of model.ayahs) {
      for (const w of a.words) {
        if (!w.text) continue
        const key = `${a.key}:${w.position} ${w.text}`
        r.words++
        const gids = font.shape(w.text).glyphs.map((x) => x.gid)
        if (gids.includes(0)) r.notdef.push(key)
        if (gids.filter((x) => meems.has(x)).length !== (w.text.match(/[ۭۢ]/g) ?? []).length) r.strayMeem.push(key)
        for (let i = 0; i < w.text.length; i++) {
          const plainCh = PLAIN[w.text[i]]
          if (!plainCh) continue
          r.openTanween++
          const open = glyphsAt(w.text, i)
          const plain = glyphsAt(w.text.slice(0, i) + plainCh + w.text.slice(i + 1), i)
          if (!open.length || open.some((x) => plain.includes(x))) r.openWrong.push(key)
        }
        if (/[ً-ٍ][ۭۢ]/.test(w.text)) r.tanzilEncoded.push(key)
        const { sakt, gap } = splitPauseMarks(w.waqfChar)
        const want = sakt.length + (gap ? 1 : 0)
        const u = wordUnits[wi++]
        const got = u ? u.glyphs.filter((x) => x.role === 'waqf').length : -1
        r.waqfMarks += want
        if (got !== want) r.waqfMismatch.push(`${key} waqfChar=${JSON.stringify(w.waqfChar)} glyphs=${got}`)
        if (u?.glyphs.some((x) => x.gid === 0)) r.notdef.push(`${key} (unit)`)
      }
    }
    out.push(r)
  }
  return out
}

/** Entry point from the route: loads everything, draws a preview grid into `host`, exposes the API. */
export async function startBench(host: HTMLElement | null, onStatus: (s: string) => void): Promise<void> {
  state ??= init(onStatus)
  const g = globalThis as unknown as { __renderLab?: unknown }
  try {
    await state
  } catch (e) {
    onStatus(`error: ${String(e)}`)
    g.__renderLab = { ready: false, error: String(e) }
    state = null
    return
  }
  g.__renderLab = {
    ready: true,
    passages: PASSAGES.map((p) => p.id),
    translations: SCRIPT_TRANSLATIONS,
    variants: VARIANTS,
    aspects: ASPECTS,
    renderCase,
    sheet,
    stillPages,
    perf,
    audit,
  }
  if (host) {
    host.innerHTML = ''
    host.style.display = 'flex'
    host.style.flexDirection = 'row'
    host.style.flexWrap = 'wrap'
    host.style.gap = '12px'
    host.style.direction = 'ltr'
    for (const variant of VARIANTS) {
      for (const aspect of ASPECTS) {
        const ref = ASPECT_SIZES[aspect]
        const k = 300 / Math.max(ref.width, ref.height)
        const r = await renderCaseToCanvas({ passage: '2:255', variant, aspect, t: 'mid', width: Math.round(ref.width * k), height: Math.round(ref.height * k) })
        const fig = document.createElement('figure')
        fig.style.margin = '0'
        const cap = document.createElement('figcaption')
        cap.textContent = `${variant} ${aspect}`
        cap.style.font = '12px system-ui'
        fig.append(r.canvas, cap)
        host.append(fig)
      }
    }
  }
  onStatus('ready')
}
