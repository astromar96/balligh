// Canvas plumbing shared by the web video and image exports: an offscreen 2D canvas (DOM canvas fallback), one
// frame painted from a clean state through render's Canvas 2D Painter, PNG encoding and a background-safe yield.
import type { Painter } from '../core/types'

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** A DOM canvas (Safari < 16.4 cannot encode an OffscreenCanvas to PNG: gotcha 14). */
export function domCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

export function newCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  return domCanvas(width, height)
}

export function context2d(canvas: AnyCanvas): Ctx2D {
  const ctx = canvas.getContext('2d', { alpha: false }) as Ctx2D | null
  if (!ctx) throw new Error('media: 2D canvas context unavailable')
  return ctx
}

/**
 * Paints one frame from a clean state (identity transform, opaque black), so every frame depends only on what
 * `paint` draws: preview == export.
 */
export function paintFrame(ctx: Ctx2D, painter: Painter, width: number, height: number, paint: (p: Painter) => void): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  painter.save()
  paint(painter)
  painter.restore()
}

export async function canvasToPng(canvas: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('media: the canvas could not be encoded as PNG'))), 'image/png'),
  )
}

/** A macrotask yield that background tabs do not throttle (unlike setTimeout). */
export function yieldToEventLoop(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (sched?.yield) return sched.yield()
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(0)
  })
}
