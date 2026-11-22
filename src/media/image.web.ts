// Web still export: PNG pages of a Scene drawn through render's Canvas 2D Painter, one canvas reused for every
// page. Licensed tafsir and the Quran text are paged, never truncated (00-gaps C13/D6): a still scene has
// scene.pageCount pages and exportImages writes one PNG per page, at most 10 (D3, one share sheet).
import type { ExportedFile, Painter, Scene } from '../core/types'
import { createCanvasPainter } from '../render/platform.web'
import { MAX_IMAGE_PAGES, fileNameFor } from './budget'
import { canvasToPng, context2d, domCanvas, newCanvas, paintFrame, yieldToEventLoop, type AnyCanvas, type Ctx2D } from './canvas.web'

interface Target {
  canvas: AnyCanvas
  ctx: Ctx2D
  painter: Painter
}

function target(canvas: AnyCanvas, width: number, height: number): Target {
  const ctx = context2d(canvas)
  return { canvas, ctx, painter: createCanvasPainter(ctx, width, height) }
}

/**
 * PNG renderer for one size: an OffscreenCanvas first; when that cannot paint or encode (Safari < 16.4 has no
 * convertToBlob — media-pipeline gotcha 14) it moves to a DOM canvas for this and every later page.
 */
function pngRenderer(width: number, height: number): (paint: (p: Painter) => void) => Promise<Blob> {
  let t: Target | null = null
  return async (paint) => {
    t ??= target(newCanvas(width, height), width, height)
    try {
      paintFrame(t.ctx, t.painter, width, height, paint)
      return await canvasToPng(t.canvas)
    } catch (e) {
      if (typeof document === 'undefined' || typeof OffscreenCanvas === 'undefined' || !(t.canvas instanceof OffscreenCanvas)) throw e
      t = target(domCanvas(width, height), width, height)
      paintFrame(t.ctx, t.painter, width, height, paint)
      return canvasToPng(t.canvas)
    }
  }
}

const sizeOf = (scene: Scene) => ({ width: Math.max(1, Math.round(scene.width)), height: Math.max(1, Math.round(scene.height)) })

/** scene.pageCount, or 1 when a scene does not say (≥ 1 by contract). */
function pagesOf(scene: Scene): number {
  return Number.isInteger(scene.pageCount) && scene.pageCount >= 1 ? scene.pageCount : 1
}

function png(blob: Blob, fileName: string): ExportedFile {
  return { blob, mimeType: 'image/png', extension: 'png', fileName }
}

/** One PNG: still page `page` (scene.drawPage) when given, else the frame at tMs (scene.draw, default 0). */
export async function exportImageWeb(opts: { scene: Scene; fileBase: string; tMs?: number; page?: number }): Promise<ExportedFile> {
  const { scene, page } = opts
  if (page !== undefined && (!Number.isInteger(page) || page < 0 || page >= pagesOf(scene))) {
    throw new RangeError(`media: page ${page} does not exist (the scene has ${pagesOf(scene)})`)
  }
  const { width, height } = sizeOf(scene)
  const blob = await pngRenderer(width, height)((p) => (page !== undefined ? scene.drawPage(p, page) : scene.draw(p, opts.tMs ?? 0)))
  return png(blob, fileNameFor(opts.fileBase, 'png'))
}

const abortError = () => new DOMException('Export cancelled', 'AbortError')

/**
 * One PNG per still page (scene.drawPage), named "<base>-1.png", "<base>-2.png" …, at most `maxPages` (default 10).
 * A scene with more pages than that gets its first `maxPages` only (logged): the UI asks for a shorter selection
 * instead (Scene.pageCount, 00-gaps D3). onProgress(ratio) after each page. An aborted `signal` stops before the
 * next page with an AbortError.
 */
export async function exportImagesWeb(opts: {
  scene: Scene
  fileBase: string
  maxPages?: number
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}): Promise<ExportedFile[]> {
  const { scene, onProgress, signal } = opts
  if (signal?.aborted) throw abortError()
  const limit = opts.maxPages === undefined ? MAX_IMAGE_PAGES : Math.floor(opts.maxPages)
  if (!(limit >= 1)) throw new RangeError(`media: maxPages must be at least 1 (got ${opts.maxPages})`)
  const pages = pagesOf(scene)
  const count = Math.min(pages, limit)
  if (pages > count) console.warn(`[media] the scene has ${pages} pages; exporting the first ${count} (maxPages ${limit})`)
  const { width, height } = sizeOf(scene)
  const render = pngRenderer(width, height)
  const files: ExportedFile[] = []
  onProgress?.(0)
  for (let k = 0; k < count; k++) {
    if (k > 0) await yieldToEventLoop() // drawing a page is synchronous: let the progress bar paint
    if (signal?.aborted) throw abortError()
    const blob = await render((p) => scene.drawPage(p, k))
    files.push(png(blob, fileNameFor(opts.fileBase, 'png', k + 1)))
    if (signal?.aborted) throw abortError()
    onProgress?.((k + 1) / count)
  }
  return files
}
