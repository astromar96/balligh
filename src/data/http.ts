// HTTP layer for every network call in data/: simple CORS GETs only (no custom headers → no preflight,
// research/tafsir-translation.md §7.1), credentials omitted, 15 s timeout per attempt, 2 retries with
// backoff on network errors / 5xx / 429, caller AbortSignal honoured, identical in-flight requests shared.
// Cache: in memory always; Cache Storage on the web (when `caches` exists). Every TTL is capped by the host's
// entry in cache-policy.json (Quran Foundation hosts ≤ 6 days, QF Developer Terms + research/00-gaps.md §2.9),
// and purgeExpiredCaches() deletes what is past it. Paged endpoints: per_page=50 + pagination (00-gaps §2.10).
// Works unchanged on React Native (fetch only, no DOM).
import { policyFor } from './cache-policy'

export const DAY_MS = 24 * 60 * 60 * 1000
/** QF Developer Terms allow one week; Balligh keeps Quran Foundation content ≤ 6 days and purges at start-up. */
export const QF_TTL_MS = 6 * DAY_MS

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
const CACHE_NAME = 'balligh-data-v2'
/** caches of earlier versions (v1 kept QF content 7 days and wrote no storage stamp): deleted by the purge */
const LEGACY_CACHE_NAMES: readonly string[] = ['balligh-data-v1']
/** expiry (ms since epoch) of a response stored by this layer */
export const EXPIRES_HEADER = 'x-balligh-expires'
/**
 * When the response was stored (ms since epoch). The purge dates every cached entry by this header: another
 * writer of a QF host's responses (the service worker's runtime caches) must stamp it too, or the entry is purged.
 */
export const STORED_HEADER = 'x-balligh-stored'

/** The TTL actually used for a URL: the requested one, capped by the host's cache policy. */
export function effectiveTtlMs(url: string, ttlMs: number): number {
  const p = policyFor(url)
  return p ? Math.min(ttlMs, p.maxAgeDays * DAY_MS) : ttlMs
}

export class HttpError extends Error {
  readonly status: number
  readonly url: string
  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

/** Thrown when every provider of a resource failed. `causes` holds each provider's error. */
export class ProvidersFailedError extends Error {
  readonly causes: unknown[]
  constructor(what: string, causes: unknown[]) {
    super(`${what}: all providers failed (${causes.map((c) => (c instanceof Error ? c.message : String(c))).join(' | ')})`)
    this.name = 'ProvidersFailedError'
    this.causes = causes
  }
}

// ───────────────────────── abort helpers ─────────────────────────

export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason
  if (reason instanceof Error) return reason
  if (typeof DOMException !== 'undefined') return new DOMException('Aborted', 'AbortError')
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

/** Resolves after ms, rejects early with an AbortError when the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Races a promise against a caller's signal (the underlying work is not cancelled by this). */
export function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

// ───────────────────────── shared in-flight work ─────────────────────────

interface Shared<T> {
  promise: Promise<T>
  controller: AbortController
  waiters: number
}

/**
 * Runs `work` once per key while it is in flight; every caller can abort its own wait. The underlying work is
 * aborted only when all of its callers have aborted.
 */
export class SharedFlights {
  private readonly flights = new Map<string, Shared<unknown>>()

  run<T>(key: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal)
    let f = this.flights.get(key) as Shared<T> | undefined
    if (!f) {
      const controller = new AbortController()
      const entry: Shared<T> = { controller, waiters: 0, promise: Promise.resolve() as Promise<T> }
      entry.promise = (async () => {
        try {
          return await work(controller.signal)
        } finally {
          if (this.flights.get(key) === entry) this.flights.delete(key)
        }
      })()
      entry.promise.catch(() => {}) // a rejection with no waiter left must not be unhandled
      this.flights.set(key, entry as Shared<unknown>)
      f = entry
    }
    const flight = f
    flight.waiters++
    let released = false
    const release = () => {
      if (released) return
      released = true
      flight.waiters--
      if (flight.waiters <= 0 && this.flights.get(key) === flight) {
        flight.controller.abort()
        this.flights.delete(key)
      }
    }
    if (!signal) return flight.promise // a caller that cannot abort keeps the work alive
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        release()
        reject(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      flight.promise.then(
        (v) => {
          signal.removeEventListener('abort', onAbort)
          released = true
          resolve(v)
        },
        (e) => {
          signal.removeEventListener('abort', onAbort)
          released = true
          reject(e)
        },
      )
    })
  }
}

// ───────────────────────── caches ─────────────────────────

interface MemEntry<T> {
  value: T
  expires: number
}

/** Small LRU with TTL for parsed results (process lifetime; the only cache on native). */
export class MemoryCache {
  private readonly map = new Map<string, MemEntry<unknown>>()
  private readonly maxEntries: number
  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries
  }
  get<T>(key: string): T | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    if (e.expires <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    this.map.delete(key) // LRU bump
    this.map.set(key, e)
    return e.value as T
  }
  set<T>(key: string, value: T, ttlMs: number): void {
    this.map.delete(key)
    this.map.set(key, { value, expires: Date.now() + ttlMs })
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }
  clear(): void {
    this.map.clear()
  }
}

export interface CacheStorageLike {
  open(name: string): Promise<Cache>
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
}

let cacheStorageOverride: CacheStorageLike | null | undefined

/** Test hook: a fake Cache Storage (null = none, undefined = the platform's). Returns the previous override. */
export function setCacheStorage(cs: CacheStorageLike | null | undefined): CacheStorageLike | null | undefined {
  const prev = cacheStorageOverride
  cacheStorageOverride = cs
  return prev
}

function cacheStorage(): CacheStorageLike | null {
  if (cacheStorageOverride !== undefined) return cacheStorageOverride
  const g = globalThis as { caches?: CacheStorageLike }
  return typeof g.caches === 'object' && g.caches !== null && typeof g.caches.open === 'function' ? g.caches : null
}

let persistentEnabled = true
let startedPurge = false

/** Turns the Cache Storage layer off/on (tests, privacy settings). */
export function setPersistentCacheEnabled(on: boolean): void {
  persistentEnabled = on
}

async function openCache(): Promise<Cache | null> {
  const cs = persistentEnabled ? cacheStorage() : null
  if (!cs) return null
  try {
    const cache = await cs.open(CACHE_NAME)
    if (!startedPurge) {
      startedPurge = true
      void purgeExpiredCaches() // in case the app did not call it at start-up
    }
    return cache
  } catch {
    return null // e.g. opaque origin / storage disabled
  }
}

/** Why a cached response must go (or null to keep it): past its expiry stamp, or older than its host's policy. */
export function staleReason(url: string, headers: { get(name: string): string | null } | null, now: number): string | null {
  const policy = policyFor(url)
  const stored = Number(headers?.get(STORED_HEADER) ?? NaN)
  const expires = Number(headers?.get(EXPIRES_HEADER) ?? NaN)
  if (Number.isFinite(expires) && expires <= now) return 'expired'
  if (!policy) return null
  if (!(stored > 0)) return policy.qf ? 'undated QF content' : null
  return now - stored >= policy.maxAgeDays * DAY_MS ? 'older than the host policy' : null
}

let purging: Promise<void> | null = null

/**
 * Deletes cached responses that must not be kept any longer, from every Cache Storage cache of this origin:
 * entries past their expiry stamp, entries of a policy host stored longer ago than its maxAgeDays (QF hosts:
 * 6 days), QF entries whose storage time cannot be told (no x-balligh-stored stamp — never keep QF data we
 * cannot date), and the legacy data caches. Entries of hosts outside the policy (the app's own files) are left
 * alone. Idempotent, never throws, one purge at a time (concurrent calls share it); resolves at once where Cache
 * Storage does not exist (native — the in-memory caches have the same capped TTLs).
 */
export function purgeExpiredCaches(): Promise<void> {
  purging ??= runPurge().finally(() => {
    purging = null
  })
  return purging
}

async function runPurge(): Promise<void> {
  const cs = cacheStorage()
  if (!cs) return
  let names: string[]
  try {
    names = await cs.keys()
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    try {
      if (LEGACY_CACHE_NAMES.includes(name)) {
        await cs.delete(name)
        continue
      }
      const cache = await cs.open(name)
      for (const req of await cache.keys()) {
        const res = await cache.match(req)
        if (staleReason(req.url, res ? res.headers : null, now)) await cache.delete(req)
      }
    } catch {
      // best effort: the next start-up tries again
    }
  }
}

async function readPersistent(url: string): Promise<unknown | undefined> {
  const cache = await openCache()
  if (!cache) return undefined
  try {
    const res = await cache.match(url)
    if (!res) return undefined
    if (staleReason(url, res.headers, Date.now()) || !res.headers.get(EXPIRES_HEADER)) {
      await cache.delete(url)
      return undefined
    }
    return JSON.parse(await res.text()) as unknown
  } catch {
    return undefined
  }
}

async function writePersistent(url: string, body: string, ttlMs: number): Promise<void> {
  const cache = await openCache()
  if (!cache) return
  try {
    const now = Date.now()
    await cache.put(
      url,
      new Response(body, {
        headers: { 'content-type': 'application/json', [EXPIRES_HEADER]: String(now + ttlMs), [STORED_HEADER]: String(now) },
      }),
    )
  } catch {
    // quota exceeded etc. — the memory layer still has it
  }
}

// ───────────────────────── fetchJson ─────────────────────────

export interface FetchJsonOptions {
  signal?: AbortSignal
  /** how long the response may be reused (memory + Cache Storage); capped by the host's cache policy */
  ttlMs: number
  /** resolve null instead of throwing on HTTP 404 (a gap, e.g. tafsir with no entry for an ayah) */
  allow404?: boolean
  timeoutMs?: number
  retries?: number
  /** persist in Cache Storage (default true when ttlMs > 0) */
  persist?: boolean
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

let fetcher: Fetcher = (url, init) => fetch(url, init)

/** Test hook: replaces the global fetch used by data/ (returns the previous one). */
export function setFetcher(f: Fetcher | null): Fetcher {
  const prev = fetcher
  fetcher = f ?? ((url, init) => fetch(url, init))
  return prev
}

const flights = new SharedFlights()
const jsonMemory = new MemoryCache(400)
const NOT_FOUND = Symbol('404')

/** Drops every cached response held in memory (Cache Storage is left alone). */
export function clearMemoryCaches(): void {
  jsonMemory.clear()
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500
}

let backoffBaseMs = 400

/** Test hook: base of the retry backoff (default 400 ms → waits of 400 and 800 ms plus jitter). Returns the previous value. */
export function setBackoffBaseMs(ms: number): number {
  const prev = backoffBaseMs
  backoffBaseMs = ms
  return prev
}

function backoffMs(attempt: number): number {
  return backoffBaseMs * 2 ** attempt + Math.floor(Math.random() * Math.min(200, backoffBaseMs / 2))
}

async function attemptFetch(url: string, timeoutMs: number, signal: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const t = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetcher(url, { method: 'GET', credentials: 'omit', signal: controller.signal })
  } catch (e) {
    if (signal.aborted) throw abortError(signal)
    if (timedOut) {
      const te = new Error(`timeout after ${timeoutMs} ms: ${url}`)
      te.name = 'TimeoutError'
      throw te
    }
    throw e
  } finally {
    clearTimeout(t)
    signal.removeEventListener('abort', onAbort)
  }
}

async function fetchJsonNetwork(url: string, opts: FetchJsonOptions, signal: AbortSignal): Promise<unknown> {
  const retries = opts.retries ?? DEFAULT_RETRIES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt - 1), signal)
    let res: Response
    try {
      res = await attemptFetch(url, timeoutMs, signal)
    } catch (e) {
      if (signal.aborted) throw abortError(signal)
      lastError = e // network error (TypeError, also CORS-less 5xx) or timeout → retry
      continue
    }
    if (res.status === 404 && opts.allow404) return NOT_FOUND
    if (!res.ok) {
      lastError = new HttpError(res.status, url)
      if (isRetryableStatus(res.status)) continue
      throw lastError
    }
    const text = await res.text()
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new HttpError(res.status, url, `invalid JSON from ${url}`)
    }
    const ttlMs = effectiveTtlMs(url, opts.ttlMs)
    if (ttlMs > 0 && opts.persist !== false) void writePersistent(url, text, ttlMs)
    return value
  }
  throw lastError instanceof Error ? lastError : new Error(`request failed: ${url}`)
}

/**
 * GET JSON with cache → network. Resolves null for a 404 when allow404 is set.
 * Errors: AbortError (caller aborted), HttpError (non-retryable status or retries exhausted), TypeError /
 * TimeoutError (network). Never sends custom headers.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T | null> {
  throwIfAborted(opts.signal)
  const memo = jsonMemory.get<unknown>(url)
  if (memo !== undefined) return (memo === NOT_FOUND ? null : memo) as T | null
  const ttlMs = effectiveTtlMs(url, opts.ttlMs)
  const value = await flights.run(
    url,
    async (signal) => {
      if (ttlMs > 0 && opts.persist !== false) {
        const cached = await readPersistent(url)
        if (cached !== undefined) return cached
      }
      return fetchJsonNetwork(url, opts, signal)
    },
    opts.signal,
  )
  if (ttlMs > 0) jsonMemory.set(url, value, ttlMs)
  return (value === NOT_FOUND ? null : value) as T | null
}

// ───────────────────────── paged endpoints (00-gaps §2.10) ─────────────────────────

/** The QF API documents per_page 1..50 (default 10) on every paged endpoint Balligh uses. */
export const PER_PAGE = 50
/** safety stop for a next_page walk (the longest surah is 6 pages of 50) */
const MAX_PAGES = 12

/** What a paged QF response carries besides its records. */
export interface PagedBody {
  pagination?: { per_page?: unknown; current_page?: unknown; next_page?: unknown; total_pages?: unknown } | null
}

/**
 * The pages of a `per_page=50` endpoint that hold records first..last (1-based; page p holds 50(p−1)+1 … 50p),
 * fetched in parallel. When the server does not page as asked (per_page or current_page differ, or no
 * pagination object), every page is read instead by walking pagination.next_page from page 1 — callers then
 * pick their records by key. Returns the page bodies in page order.
 */
export async function fetchPages<T extends PagedBody>(urlForPage: (page: number) => string, first: number, last: number, opts: FetchJsonOptions): Promise<T[]> {
  const p0 = Math.max(1, Math.ceil(first / PER_PAGE))
  const p1 = Math.max(p0, Math.ceil(last / PER_PAGE))
  const pages = Array.from({ length: p1 - p0 + 1 }, (_, i) => p0 + i)
  const bodies = await mapLimit(pages, 3, (p) => fetchJson<T>(urlForPage(p), opts))
  const asAsked = bodies.every((b, i) => !!b?.pagination && Number(b.pagination.per_page) === PER_PAGE && Number(b.pagination.current_page) === pages[i])
  if (asAsked) return bodies as T[]
  const out: T[] = []
  let page: number | null = 1
  for (let n = 0; page !== null && n < MAX_PAGES; n++) {
    const body: T | null = await fetchJson<T>(urlForPage(page), opts)
    if (!body) break
    out.push(body)
    const next: number = Number(body.pagination?.next_page)
    page = Number.isInteger(next) && next > page ? next : null
  }
  return out
}

// ───────────────────────── providers & concurrency ─────────────────────────

export interface Provider<T> {
  /** short id, e.g. "quran.com", "quranenc" */
  id: string
  run(signal?: AbortSignal): Promise<T>
}

/**
 * Tries providers in order and returns the first success with the id of the provider that answered.
 * An AbortError stops immediately; any other error moves on to the next provider.
 */
export async function firstAvailable<T>(what: string, providers: Provider<T>[], signal?: AbortSignal): Promise<{ value: T; providerId: string }> {
  const causes: unknown[] = []
  for (const p of providers) {
    throwIfAborted(signal)
    try {
      return { value: await p.run(signal), providerId: p.id }
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) throw e
      causes.push(e)
    }
  }
  throw new ProvidersFailedError(what, causes)
}

/** Maps with at most `limit` concurrent calls, preserving order; rejects on the first error. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch (e) {
        failed = true
        throw e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Memoised async computation (parsed results) with shared in-flight work and per-caller abort. */
export class AsyncMemo {
  private readonly cache: MemoryCache
  private readonly flights = new SharedFlights()
  constructor(maxEntries = 100) {
    this.cache = new MemoryCache(maxEntries)
  }
  async get<T>(key: string, ttlMs: number, compute: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const hit = this.cache.get<T>(key)
    if (hit !== undefined) return hit
    const value = await this.flights.run(key, compute, signal)
    this.cache.set(key, value, ttlMs)
    return value
  }
  clear(): void {
    this.cache.clear()
  }
}
