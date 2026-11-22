// Web render platform: Canvas 2D Painter + HarfBuzz (vendored harfbuzzjs; the wasm is public/harfbuzz.wasm,
// fetched relative to the app's base so a sub-path deployment works) + the translation fonts (Noto per script
// from fontsource on jsDelivr/unpkg through the FontFace API). Exports the same `renderPlatform` shape as
// platform.ts, plus createCanvasPainter for the web-only callers (preview canvas, media export). Nothing here
// touches the DOM at import time (Expo Router renders routes on the server too); harfbuzzjs is imported lazily.
import type { Graphics, ImageHandle, Paint, Painter, PathHandle, Surface, TextStyle } from '../core/types'
import { FONTS } from '../core/fonts'
import { fontsourceCssUrl, parseFontFaces, scriptFont, type ScriptFont } from './fonts'
import type { QuranFont, RenderPlatform } from './index'
import { createHarfBuzzQuranFont } from './hbFont'
import { resolvePublicUrl } from './util'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

class WebPath implements PathHandle {
  readonly kind = 'path' as const
  readonly path: Path2D
  constructor(path: Path2D) {
    this.path = path
  }
}

class WebImage implements ImageHandle {
  readonly kind = 'image' as const
  readonly width: number
  readonly height: number
  /** mutable so a Surface snapshot can detach (copy-on-write) when its surface is drawn on again */
  source: CanvasImageSource
  constructor(source: CanvasImageSource, width: number, height: number) {
    this.source = source
    this.width = width
    this.height = height
  }
}

function asPath(p: PathHandle): Path2D {
  if (p instanceof WebPath) return p.path
  throw new Error('render: PathHandle was not created by the web Graphics')
}

function asImage(img: ImageHandle): CanvasImageSource {
  if (img instanceof WebImage) return img.source
  throw new Error('render: ImageHandle was not created by the web Graphics')
}

const fontString = (s: TextStyle): string =>
  `${s.weight ?? 400} ${Math.round(s.sizePx * 100) / 100}px "${s.family}", "${FONTS.ui}", system-ui, sans-serif`

function makePainter(ctx: Ctx2D, width: number, height: number, beforeWrite: () => void): Painter {
  const gradients = new WeakMap<object, CanvasGradient>()
  const widths = new Map<string, number>()
  ctx.imageSmoothingEnabled = true
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const style = (paint: Paint): string | CanvasGradient => {
    if (typeof paint === 'string') return paint
    let g = gradients.get(paint)
    if (!g) {
      g =
        paint.type === 'linear'
          ? ctx.createLinearGradient(paint.x0, paint.y0, paint.x1, paint.y1)
          : ctx.createRadialGradient(paint.cx, paint.cy, 0, paint.cx, paint.cy, Math.max(1e-3, paint.r))
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color)
      gradients.set(paint, g)
    }
    return g
  }

  const roundRectPath = (x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2))
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.lineTo(x + w - rr, y)
    ctx.arcTo(x + w, y, x + w, y + rr, rr)
    ctx.lineTo(x + w, y + h - rr)
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
    ctx.lineTo(x + rr, y + h)
    ctx.arcTo(x, y + h, x, y + h - rr, rr)
    ctx.lineTo(x, y + rr)
    ctx.arcTo(x, y, x + rr, y, rr)
    ctx.closePath()
  }

  const setText = (s: TextStyle) => {
    ctx.font = fontString(s)
    ctx.textAlign = s.align
    ctx.direction = s.direction
    ctx.textBaseline = 'alphabetic'
  }

  return {
    width,
    height,
    save: () => ctx.save(),
    restore: () => ctx.restore(),
    translate: (x, y) => ctx.translate(x, y),
    scale: (sx, sy) => ctx.scale(sx, sy),
    alpha: (a) => {
      ctx.globalAlpha = ctx.globalAlpha * a
    },
    clipRect: (x, y, w, h) => {
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
    },
    fillRect: (x, y, w, h, paint) => {
      beforeWrite()
      ctx.fillStyle = style(paint)
      ctx.fillRect(x, y, w, h)
    },
    fillRoundRect: (x, y, w, h, radius, paint) => {
      beforeWrite()
      ctx.fillStyle = style(paint)
      roundRectPath(x, y, w, h, radius)
      ctx.fill()
    },
    strokeRoundRect: (x, y, w, h, radius, color, lineWidth) => {
      beforeWrite()
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      roundRectPath(x, y, w, h, radius)
      ctx.stroke()
    },
    fillPath: (path, paint) => {
      beforeWrite()
      ctx.fillStyle = style(paint)
      ctx.fill(asPath(path))
    },
    strokePath: (path, color, lineWidth) => {
      beforeWrite()
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.stroke(asPath(path))
    },
    drawImage: (img, dx, dy, dw, dh, src) => {
      beforeWrite()
      const source = asImage(img)
      if (src) ctx.drawImage(source, src.x, src.y, src.w, src.h, dx, dy, dw, dh)
      else ctx.drawImage(source, dx, dy, dw, dh)
    },
    fillText: (text, x, y, s) => {
      beforeWrite()
      setText(s)
      ctx.fillStyle = s.color
      ctx.fillText(text, x, y)
    },
    measureText: (text, s) => {
      const font = fontString(s)
      const key = font + '\u0001' + text
      let w = widths.get(key)
      if (w === undefined) {
        setText(s)
        w = ctx.measureText(text).width
        if (widths.size > 20000) widths.clear()
        widths.set(key, w)
      }
      return w
    },
  }
}

/** Wraps a 2D canvas context (HTMLCanvasElement or OffscreenCanvas) as a Painter. Web only. */
export function createCanvasPainter(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): Painter {
  return makePainter(ctx, width, height, () => {})
}

function newCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function context2d(canvas: AnyCanvas): Ctx2D {
  const ctx = canvas.getContext('2d') as Ctx2D | null
  if (!ctx) throw new Error('render: 2D canvas context unavailable')
  return ctx
}

function createSurface(width: number, height: number): Surface {
  const w = Math.max(1, Math.ceil(width))
  const h = Math.max(1, Math.ceil(height))
  const canvas = newCanvas(w, h)
  const ctx = context2d(canvas)
  let live: WebImage | null = null
  // Copy-on-write: snapshot() hands out the canvas itself (no copy); the first write after that moves
  // the handle onto a private copy, so a snapshot never changes once taken.
  const beforeWrite = () => {
    if (!live) return
    const copy = newCanvas(w, h)
    context2d(copy).drawImage(canvas, 0, 0)
    live.source = copy
    live = null
  }
  const painter = makePainter(ctx, w, h, beforeWrite)
  return {
    painter,
    snapshot: () => (live ??= new WebImage(canvas, w, h)),
  }
}

async function loadImage(uri: string): Promise<ImageHandle> {
  const res = await fetch(uri)
  if (!res.ok) throw new Error(`render: image ${res.status} ${uri}`)
  const bitmap = await createImageBitmap(await res.blob())
  return new WebImage(bitmap, bitmap.width, bitmap.height)
}

const graphics: Graphics = {
  makePath: (svgPathData) => new WebPath(new Path2D(svgPathData)),
  createSurface,
  loadImage,
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`render: ${res.status} fetching ${url}`)
  return res.arrayBuffer()
}

async function quranFontUrl(): Promise<string> {
  // SDK 58 expo-asset: Asset.fromModule(require(...)) → downloadAsync() → localUri (web: the served URL).
  const { Asset } = await import('expo-asset')
  const asset = Asset.fromModule(require('../../assets/fonts/AmiriQuran-Regular.ttf'))
  await asset.downloadAsync()
  return asset.localUri ?? asset.uri
}

/** The app's sub-path (app.json experiments.baseUrl, inlined by babel-preset-expo; "" at the root). */
function appBaseUrl(): string {
  try {
    return (process.env.EXPO_BASE_URL ?? '').replace(/\/+$/, '')
  } catch {
    return ''
  }
}

const publicFileUrl = (file: string): string => resolvePublicUrl(file, appBaseUrl(), document.baseURI)

let quranFont: Promise<QuranFont> | null = null

function loadQuranFont(): Promise<QuranFont> {
  if (!quranFont) {
    quranFont = (async () => {
      const [hb, wasmBinary, ttf] = await Promise.all([
        import('../vendor/harfbuzzjs/index.mjs'),
        fetchBytes(publicFileUrl('harfbuzz.wasm')),
        quranFontUrl().then(fetchBytes),
      ])
      await hb.loadHarfBuzz({ wasmBinary })
      return createHarfBuzzQuranFont(hb, ttf)
    })()
    // a failed download must not poison every later attempt
    quranFont.catch(() => {
      quranFont = null
    })
  }
  return quranFont
}

const unquote = (s: string) => s.replace(/^["']|["']$/g, '')

async function waitForFamily(family: string, timeoutMs: number): Promise<boolean> {
  const t0 = performance.now()
  for (;;) {
    const faces: FontFace[] = []
    document.fonts.forEach((f) => {
      if (unquote(f.family) === family) faces.push(f)
    })
    if (faces.length) {
      await Promise.all(faces.map((f) => (f.status === 'loaded' ? f : f.load().catch(() => f))))
      return faces.some((f) => f.status === 'loaded')
    }
    if (performance.now() - t0 > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 50))
  }
}

let uiFonts: Promise<void> | null = null

/** Waits for the UI fonts the scene draws with (registered by the UI through expo-font), max ~4 s. */
function ensureUiFonts(): Promise<void> {
  if (!uiFonts) {
    uiFonts = Promise.all([FONTS.ui, FONTS.uiMedium, FONTS.uiSemiBold, FONTS.display].map((f) => waitForFamily(f, 4000))).then(
      (ok) => {
        // retry next time if a family never showed up (the UI may register it later)
        if (ok.includes(false)) uiFonts = null
      },
      () => {
        uiFonts = null
      },
    )
  }
  return uiFonts
}

// ── translation fonts: Noto per script (render/fonts.ts) ──

const FONT_HOSTS = ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com']
/** one wait never holds the caller longer than this; downloads go on in the background */
const NOTO_TIMEOUT_MS = 8000

interface Registered {
  faces: FontFace[]
  /** index into FONT_HOSTS */
  host: number
}

/** per family: its weight-400 faces, added to document.fonts (not loaded yet) */
const registered = new Map<string, Promise<Registered>>()
/** per family + sample: true once the faces the sample needs are loaded */
const sampleLoads = new Map<string, Promise<boolean>>()

const timeout = (ms: number): Promise<'timeout'> => new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))

async function fetchText(url: string, ms: number): Promise<string> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' })
    if (!res.ok) throw new Error(`render: ${res.status} fetching ${url}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

const cssFont = (f: ScriptFont) => `400 32px "${f.family}"`

/** Adds the package's weight-400 faces (each with its unicode-range) from the first host that serves the stylesheet. */
async function register(f: ScriptFont, fromHost: number): Promise<Registered> {
  let last: unknown = null
  for (let host = fromHost; host < FONT_HOSTS.length; host++) {
    try {
      const cssUrl = fontsourceCssUrl(FONT_HOSTS[host], f)
      const sources = parseFontFaces(await fetchText(cssUrl, NOTO_TIMEOUT_MS), cssUrl).filter((x) => x.weight === '400' && x.style === 'normal')
      if (!sources.length) throw new Error(`render: no @font-face in ${cssUrl}`)
      const faces = sources.map((x) => new FontFace(f.family, `url("${x.url}") format("woff2")`, { weight: '400', style: 'normal', unicodeRange: x.unicodeRange ?? 'U+0-10FFFF' }))
      for (const face of faces) document.fonts.add(face)
      return { faces, host }
    } catch (e) {
      last = e
    }
  }
  throw last ?? new Error(`render: ${f.family} unavailable`)
}

function registration(f: ScriptFont, fromHost = 0): Promise<Registered> {
  let job = registered.get(f.family)
  if (!job) {
    job = register(f, fromHost)
    registered.set(f.family, job)
    job.catch(() => registered.delete(f.family))
  }
  return job
}

/** Loads what `text` needs from the family; on a font-file failure moves the family to the next host once. */
async function loadText(f: ScriptFont, text: string): Promise<boolean> {
  for (let attempt = 0; attempt < FONT_HOSTS.length; attempt++) {
    const reg = await registration(f)
    await document.fonts.load(cssFont(f), text).catch(() => [])
    const touched = reg.faces.filter((x) => x.status !== 'unloaded')
    if (touched.length && touched.every((x) => x.status === 'loaded')) return true
    if (!touched.some((x) => x.status === 'error')) return touched.length > 0
    // a file failed (CDN 403/404): never let a broken face shadow the next host's or a local font of that name
    for (const x of reg.faces) document.fonts.delete(x)
    registered.delete(f.family)
    if (reg.host + 1 >= FONT_HOSTS.length) return false
    void registration(f, reg.host + 1).catch(() => undefined)
  }
  return false
}

function loadSample(f: ScriptFont, text: string, cache: boolean): Promise<boolean> {
  const key = `${f.family}\u0001${text}`
  let job = cache ? sampleLoads.get(key) : undefined
  if (!job) {
    job = loadText(f, text).catch((e: unknown) => {
      console.warn('render: translation font', f.family, e)
      return false
    })
    if (cache) {
      sampleLoads.set(key, job)
      // a failure is retried on the next call
      void job.then((ok) => {
        if (!ok) sampleLoads.delete(key)
      })
    }
  }
  return Promise.race([job, timeout(NOTO_TIMEOUT_MS).then(() => false)])
}

/**
 * UI fonts (expo-font) + the Noto family of every translation script asked for (render/index.ts ensureTextFonts).
 * Never rejects; every wait is capped so a slow CDN leaves the scene on its fallback stack instead of blocking it.
 */
function ensureTextFonts(scripts?: string[], sampleText?: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return Promise.resolve()
  const jobs: Promise<unknown>[] = [ensureUiFonts()]
  const seen = new Set<string>()
  for (const s of scripts ?? []) {
    const f = scriptFont(s)
    if (!f || seen.has(f.sample)) continue
    seen.add(f.sample)
    jobs.push(loadSample(f, f.sample, true))
    if (sampleText) jobs.push(loadSample(f, sampleText, false))
  }
  return Promise.all(jobs.map((j) => j.catch(() => undefined))).then(() => undefined)
}

export const renderPlatform: RenderPlatform = {
  loadQuranFont,
  graphics,
  ensureTextFonts,
}
