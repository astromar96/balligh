// Web sharing: Web Share Level 2 for one or several files, <a download> fallback, deep links via share sheet
// or clipboard. research/media-pipeline.md §8 + gotchas 26–32.
import type { ExportedFile } from '../core/types'
import { withinShareLimits } from './budget'

const files = new WeakMap<ExportedFile, File>()

/** The File for an export, built once (cheap) so share() can run synchronously in the tap handler. */
function fileOf(file: ExportedFile): File {
  let f = files.get(file)
  if (!f) {
    f = new File([file.blob], file.fileName, { type: file.mimeType })
    files.set(file, f)
  }
  return f
}

/**
 * canShare() checks neither type nor size (both engines said yes to an .exe), so the limits of one Chromium share
 * (1–10 files, 50 MiB in total) and the extension/MIME allowlist are checked here first.
 */
export function canShareFilesWeb(list: readonly ExportedFile[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  if (!Array.isArray(list) || !withinShareLimits(list)) return false
  try {
    return navigator.canShare({ files: list.map(fileOf) })
  } catch {
    return false
  }
}

export function canShareFileWeb(file: ExportedFile): boolean {
  return canShareFilesWeb([file])
}

/**
 * Must be called synchronously from a FRESH tap (activation lasts ~5 s and share() consumes it), so
 * nothing is awaited before navigator.share. Chromium on Android may never settle the promise: the UI
 * must not hold state on it.
 */
export function shareFileWeb(file: ExportedFile, meta: { title: string; text: string }): Promise<'shared' | 'cancelled' | 'unsupported'> {
  return shareFilesWeb([file], meta)
}

/** shareFileWeb for several files in ONE share sheet (e.g. the pages of a still): same rules, same results. */
export function shareFilesWeb(list: readonly ExportedFile[], meta: { title: string; text: string }): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFilesWeb(list)) return Promise.resolve('unsupported')
  let pending: Promise<void>
  try {
    pending = navigator.share({ files: list.map(fileOf), title: meta.title, text: meta.text })
  } catch {
    return Promise.resolve('unsupported')
  }
  return pending.then(
    () => 'shared' as const,
    (e: unknown) => {
      const name = e instanceof DOMException || e instanceof Error ? e.name : ''
      // AbortError = dismissed (Chromium also reports internal failures this way: keep Download visible).
      // InvalidStateError = a share is already open (double tap): nothing to do.
      if (name === 'AbortError' || name === 'InvalidStateError') return 'cancelled' as const
      return 'unsupported' as const // NotAllowedError (no/expired activation, too large, type), TypeError
    },
  )
}

export function downloadFileWeb(file: ExportedFile): void {
  const url = URL.createObjectURL(file.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.fileName // iOS: Files › Downloads, not Photos
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // denied (no focus / no activation): try the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/** Share sheet when there is one (call from a tap); otherwise, or when it is refused, copy the link. */
export async function shareLinkWeb(url: string, title: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const data: ShareData = { url, title }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (navigator.canShare?.(data) ?? true)
  if (canShare) {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (e) {
      const name = e instanceof DOMException || e instanceof Error ? e.name : ''
      if (name === 'AbortError' || name === 'InvalidStateError') return 'cancelled'
      // NotAllowedError / TypeError: fall through to the clipboard
    }
  }
  if (await copyText(url)) return 'copied'
  throw new Error('media: the link could not be shared or copied')
}
