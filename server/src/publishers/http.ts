// What every platform client shares: JSON requests with platform errors turned into PublishError, waiting with
// backoff, and the injectable fetch/sleep the tests replace.
import { PublishError, type PublishErrorKind } from './types'

export type FetchFn = typeof fetch

export interface ClientDeps {
  fetch?: FetchFn
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new PublishError('failed', 'aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new PublishError('failed', 'aborted'))
      },
      { once: true },
    )
  })
}

/** An error response from a platform API, with whatever codes it gave. */
export class ApiError extends Error {
  readonly status: number
  readonly code: number | null
  readonly subcode: number | null
  readonly body: unknown
  constructor(status: number, message: string, code: number | null, subcode: number | null, body: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.subcode = subcode
    this.body = body
  }
}

/** Fetches and parses JSON; a non-2xx answer becomes an ApiError (Graph-style `error` objects are read). */
export async function requestJson<T = Record<string, unknown>>(f: FetchFn, url: string, init: RequestInit = {}): Promise<T> {
  const res = await f(url, init)
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error
    const message = err?.message ?? (typeof body === 'string' ? body.slice(0, 300) : `HTTP ${res.status}`)
    throw new ApiError(res.status, message, err?.code ?? null, err?.error_subcode ?? null, body)
  }
  return body as T
}

/**
 * Meta Graph errors → PublishError: an invalid/expired token or a missing permission is 'auth' (needs Omar);
 * `fullCodes`/`fullSubcodes` name the platform's "daily limit reached" answers.
 */
export function metaError(error: unknown, full: { codes?: number[]; subcodes?: number[] } = {}): PublishError {
  if (error instanceof PublishError) return error
  if (error instanceof ApiError) {
    if ((error.subcode !== null && full.subcodes?.includes(error.subcode)) || (error.code !== null && full.codes?.includes(error.code))) {
      return new PublishError('full', error.message)
    }
    if (error.code === 190 || error.code === 10 || error.code === 200 || error.status === 401) return new PublishError('auth', error.message)
    return new PublishError('failed', `${error.code ?? error.status}/${error.subcode ?? '-'}: ${error.message}`)
  }
  return new PublishError('failed', error instanceof Error ? error.message : String(error))
}

/**
 * Polls `check` until it returns a value (not undefined): first after `firstMs`, then with the wait doubling up to
 * `maxStepMs`, giving up after `timeoutMs`.
 */
export async function pollUntil<T>(
  check: () => Promise<T | undefined>,
  opts: { sleep: NonNullable<ClientDeps['sleep']>; signal?: AbortSignal; firstMs: number; maxStepMs: number; timeoutMs: number; what: string },
): Promise<T> {
  let waited = 0
  let step = opts.firstMs
  for (;;) {
    await opts.sleep(step, opts.signal)
    waited += step
    const v = await check()
    if (v !== undefined) return v
    if (waited >= opts.timeoutMs) throw new PublishError('failed', `${opts.what}: still processing after ${Math.round(waited / 1000)} s`)
    step = Math.min(step * 2, opts.maxStepMs)
  }
}

export function failWith(kind: PublishErrorKind, message: string): never {
  throw new PublishError(kind, message)
}
