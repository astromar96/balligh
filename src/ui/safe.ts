// Error helpers: every failure the UI shows says what happened and what to do (PLAN.md copy rules).
// Modules still being built throw "not implemented: <name>" (core/stub.ts) — shown inline, never blank.
import type { AudioSourceErrorCode } from '../media'
import { toIndic } from './format'
import { translate, type Language, type MessageKey } from './i18n'

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** Runs fn and captures a synchronous throw. */
export function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    return { ok: false, error }
  }
}

/** fn(), or `fallback` when it throws (e.g. a contract stub that is not implemented yet). */
export function orElse<T>(fn: () => T, fallback: T | (() => T)): T {
  try {
    return fn()
  } catch {
    return typeof fallback === 'function' ? (fallback as () => T)() : fallback
  }
}

export function isAbortError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    ((e as { name?: unknown }).name === 'AbortError' || (e as { name?: unknown }).name === 'TimeoutError')
  )
}

export function isNotImplemented(e: unknown): boolean {
  return e instanceof Error && /not implemented/i.test(e.message)
}

function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return (
    (e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message)) ||
    /failed to fetch|networkerror|network request failed|err_internet/i.test(e.message)
  )
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

/**
 * One Arabic (or English) sentence for an error: what failed + what to do.
 * `what` names the thing in the UI's words (e.g. whatAudio → «التلاوة»).
 */
export function describeError(lang: Language, what: MessageKey, e: unknown): string {
  const thing = translate(lang, what)
  const audio = describeAudioSourceError(lang, e)
  if (audio) return audio
  if (isNotImplemented(e)) return translate(lang, 'errNotBuilt', { what: thing })
  if (isNetworkError(e)) return translate(lang, 'errNetwork', { what: thing })
  return translate(lang, 'errGeneric', { what: thing, message: shorten(errorMessage(e)) })
}

/**
 * media's AudioSourceError (code = why a recitation file could not be used) in the UI's words; null for any other
 * error. Matched by name and code, not instanceof, so an error that crossed a module or realm boundary still reads well.
 */
export function describeAudioSourceError(lang: Language, e: unknown): string | null {
  if (typeof e !== 'object' || e === null || (e as { name?: unknown }).name !== 'AudioSourceError') return null
  const code = (e as { code?: unknown }).code as AudioSourceErrorCode | undefined
  switch (code) {
    case 'network':
      return translate(lang, 'errNetwork', { what: translate(lang, 'whatAudio') })
    case 'timeout':
      return translate(lang, 'audioTimeout')
    case 'http': {
      const status = (e as { status?: unknown }).status
      const shown = typeof status === 'number' ? ` (${lang === 'ar' ? toIndic(String(status)) : status})` : ''
      return translate(lang, 'audioHttp', { status: shown })
    }
    case 'vbr':
      return translate(lang, 'audioVbr')
    case 'no-sync':
    case 'decode':
    case 'empty':
      return translate(lang, 'audioDecode')
    case 'range-ignored':
      return translate(lang, 'audioRange')
    case 'too-long':
      return translate(lang, 'audioTooLong')
    default:
      return null
  }
}

function shorten(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > 160 ? one.slice(0, 157) + '…' : one
}

/** Wraps a promise so a stale (aborted) result is dropped instead of resolving. */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('aborted')
    err.name = 'AbortError'
    throw err
  }
}
