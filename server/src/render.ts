// Renders one clip: Google Chrome headless opens the app's /render route (src/ui/RenderJob.tsx) with the canonical
// query, the page encodes the MP4 exactly as the app's own export does, and the bytes are read out in base64 slices.
// A fresh browser per job (no state carried over) with service workers blocked (no stale cached app).
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { chromium, type Browser } from 'playwright-core'
import type { CaptionParts } from './captions'
import type { Config } from './config'

/** what the render route reports (window.__ballighRender, without the chunk function) */
interface RenderReport {
  status: 'loading' | 'encoding' | 'done' | 'error'
  phase: string | null
  progress: number
  errorCode: string | null
  error: string | null
  warnings: string[]
  durationMs: number | null
  width: number | null
  height: number | null
  canonicalQuery: string | null
  link: string | null
  caption: string | null
  captionParts: CaptionParts | null
  reciterName: string | null
  fileName: string | null
  mimeType: string | null
  size: number | null
}

export interface RenderOutput {
  file: string
  bytes: number
  durationMs: number
  width: number
  height: number
  link: string
  captionParts: CaptionParts
  reciterName: string | null
}

/** The render route's error codes (RenderErrorCode), plus 'browser' when Chrome itself failed. */
export class RenderError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const CHUNK = 4 * 1024 * 1024
const POLL_MS = 1000

export interface RenderOptions {
  cfg: Pick<Config, 'appUrl' | 'chromeChannel' | 'chromePath'>
  query: string
  /** where the MP4 goes */
  out: string
  onProgress?: (phase: string, ratio: number) => void
  signal?: AbortSignal
  timeoutMs?: number
}

export type RenderFn = (opts: RenderOptions) => Promise<RenderOutput>

export const renderClip: RenderFn = async ({ cfg, query, out, onProgress, signal, timeoutMs = 10 * 60_000 }) => {
  let browser: Browser | null = null
  const deadline = Date.now() + timeoutMs
  const onAbort = () => void browser?.close().catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    browser = await chromium.launch({
      headless: true,
      ...(cfg.chromePath ? { executablePath: cfg.chromePath } : { channel: cfg.chromeChannel }),
      args: ['--autoplay-policy=no-user-gesture-required'],
    })
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    await page.goto(`${cfg.appUrl}/render?${query}&q=fullhd`, { waitUntil: 'domcontentloaded', timeout: 90_000 })

    let report: RenderReport | null = null
    for (;;) {
      if (signal?.aborted) throw new RenderError('aborted', 'aborted')
      if (Date.now() > deadline) throw new RenderError('timeout', 'render took too long')
      report = await page.evaluate(() => {
        const r = (globalThis as { __ballighRender?: Record<string, unknown> }).__ballighRender
        if (!r) return null
        const { chunk: _chunk, ...rest } = r
        return rest as unknown as RenderReport
      })
      if (report?.status === 'done' || report?.status === 'error') break
      if (report?.status === 'encoding') onProgress?.(report.phase ?? 'frames', report.progress)
      else onProgress?.('loading', 0)
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    if (report.status === 'error') throw new RenderError(report.errorCode ?? 'export', report.error ?? 'render failed')
    if (!report.size || !report.durationMs || !report.captionParts || !report.link) throw new RenderError('export', 'incomplete render report')

    const stream = createWriteStream(out)
    for (let offset = 0; offset < report.size; offset += CHUNK) {
      const b64 = await page.evaluate(
        ([o, l]) => (globalThis as unknown as { __ballighRender: { chunk(o: number, l: number): Promise<string> } }).__ballighRender.chunk(o, l),
        [offset, CHUNK] as const,
      )
      if (!stream.write(Buffer.from(b64, 'base64'))) await once(stream, 'drain')
    }
    stream.end()
    await once(stream, 'finish')
    return {
      file: out,
      bytes: report.size,
      durationMs: report.durationMs,
      width: report.width ?? 0,
      height: report.height ?? 0,
      link: report.link,
      captionParts: report.captionParts,
      reciterName: report.reciterName,
    }
  } catch (error) {
    if (error instanceof RenderError) throw error
    throw new RenderError(signal?.aborted ? 'aborted' : 'browser', error instanceof Error ? error.message : String(error))
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await browser?.close().catch(() => {})
  }
}
