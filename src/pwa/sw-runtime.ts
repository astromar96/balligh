// Service-worker runtime: the Balligh-specific half of the Workbox service worker that scripts/build-sw.mjs
// generates over the Expo web export. build-sw.mjs transpiles this file to a classic script
// (sw-runtime.<hash>.js) that sw.js loads with importScripts() BEFORE Workbox registers its listeners, then calls
// install(self, config) with the policy derived from src/data/cache-policy.json. Self-contained on purpose: no
// runtime imports (type-only imports are erased), nothing from the app bundle.
//
// What it adds to Workbox:
// - Range requests never reach Workbox. They are chapter-file windows (media/audio.web.ts fetchRange); a cache may
//   only hold whole 200 responses (Cache.put rejects 206 — research/media-pipeline.md §10), so they go straight to
//   the network.
// - Every response the audio routes store is stamped (x-balligh-stored / x-balligh-expires, the headers
//   src/data/http.ts dates entries by) and is never served once it is older than its host's limit. Workbox's own
//   ExpirationPlugin cannot enforce that: it re-dates an entry on every use, and a cross-origin response hides its
//   Date header, so an audio file played every day would never expire. QF Developer Terms: Quran Foundation audio
//   is kept at most a week; Balligh keeps every QF host ≤ 6 days and purges at start-up (research/00-gaps.md §2.9, D9).
// - A purge of its runtime caches on activate and whenever the page asks (once per app start, src/pwa/register.web.ts),
//   plus the deletion of runtime caches an earlier version of this worker created.

/** Headers shared with src/data/http.ts (STORED_HEADER / EXPIRES_HEADER): data's purge dates SW entries by them. */
export const STORED_HEADER = 'x-balligh-stored'
export const EXPIRES_HEADER = 'x-balligh-expires'
/** The message the page posts once per app start to run the purge. */
export const PURGE_MESSAGE = 'BALLIGH_PURGE'
/** A stamp this far in the future means the clock went back: the entry's age cannot be told, so it goes. */
const CLOCK_SLACK_MS = 5 * 60 * 1000

/** One cache-policy entry as this worker applies it (src/data/cache-policy.json; first match wins). */
export interface SwRule {
  /** exact hostname, or "*." + suffix = any subdomain of suffix (not the bare suffix) */
  match: string
  kind: 'json' | 'audio' | 'font' | 'other'
  /** Quran Foundation content */
  qf: boolean
  /** a stored copy older than this is never served and is deleted */
  maxAgeMs: number
}

export interface SwRuntimeConfig {
  /** every cache-policy entry, in file order */
  rules: SwRule[]
  /** prefix of every runtime cache this worker owns */
  prefix: string
  /** this version's runtime caches; any other cache named `prefix…` is a leftover of an earlier version */
  caches: string[]
  /** runtime caches of undated, non-QF files that Workbox's expiration alone manages (fonts, same-origin files) */
  undatedCaches: string[]
  /** the policy kinds the stamping routes may store (a host whose first policy match is another kind is not kept) */
  storeKinds: SwRule['kind'][]
}

interface HeaderReader {
  get(name: string): string | null
}

/** The parts of a Workbox plugin callback's argument this runtime reads. */
export interface CacheWillUpdateParam {
  request: Request
  response: Response
}
export interface CachedResponseWillBeUsedParam {
  cacheName: string
  request: Request
  cachedResponse?: Response
  event?: { waitUntil(p: Promise<unknown>): void }
}

export interface SwRuntime {
  ruleFor(url: string): SwRule | null
  /** why a stored copy must go, or null to keep it */
  staleReason(url: string, headers: HeaderReader | null, now: number): string | null
  /** Workbox plugin hook: stamps what a policy route stores; refuses anything without a policy or not a whole 200 */
  cacheWillUpdate(param: CacheWillUpdateParam): Promise<Response | null>
  /** Workbox plugin hook: drops (and deletes) a stored copy past its limit, so the strategy goes to the network */
  cachedResponseWillBeUsed(param: CachedResponseWillBeUsedParam): Promise<Response | null>
  /** deletes stale entries of this worker's runtime caches and the caches of earlier versions; never rejects */
  purge(): Promise<void>
}

/** Hostname of an absolute http(s) URL, lower-cased (the same reading as src/data/cache-policy.ts hostOf). */
export function hostOf(url: string): string | null {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url)
  return m ? m[1].toLowerCase() : null
}

export function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1)
    return host.length > suffix.length && host.endsWith(suffix)
  }
  return host === pattern
}

/** A Range request: an HTTP window of a (chapter) file. Never cached, never answered from a cache. */
export function bypassesCaches(request: { headers: HeaderReader }): boolean {
  return request.headers.get('range') !== null
}

export function createRuntime(cacheStorage: CacheStorage, config: SwRuntimeConfig, clock: () => number = Date.now): SwRuntime {
  const ruleFor = (url: string): SwRule | null => {
    const host = hostOf(url)
    return host ? (config.rules.find((r) => hostMatches(r.match, host)) ?? null) : null
  }

  const staleReason = (url: string, headers: HeaderReader | null, now: number): string | null => {
    const stored = Number(headers?.get(STORED_HEADER) ?? NaN)
    const expires = Number(headers?.get(EXPIRES_HEADER) ?? NaN)
    if (Number.isFinite(expires) && expires <= now) return 'expired'
    const rule = ruleFor(url)
    if (!rule) return 'no cache policy for this host'
    if (!(stored > 0)) return 'undated'
    if (stored > now + CLOCK_SLACK_MS) return 'stored in the future (clock change)'
    return now - stored >= rule.maxAgeMs ? 'older than the host policy' : null
  }

  const cacheWillUpdate = async ({ request, response }: CacheWillUpdateParam): Promise<Response | null> => {
    if (!response || response.status !== 200 || response.type === 'opaque') return null
    const rule = ruleFor(request.url)
    if (!rule || !config.storeKinds.includes(rule.kind)) return null
    const now = clock()
    const headers = new Headers(response.headers)
    headers.set(STORED_HEADER, String(now))
    headers.set(EXPIRES_HEADER, String(now + rule.maxAgeMs))
    // a readable Date also lets Workbox's ExpirationPlugin judge freshness by storage time
    headers.set('date', new Date(now).toUTCString())
    return new Response(response.body, { status: 200, statusText: response.statusText, headers })
  }

  const cachedResponseWillBeUsed = async ({ cacheName, request, cachedResponse, event }: CachedResponseWillBeUsedParam): Promise<Response | null> => {
    if (!cachedResponse) return null
    if (!staleReason(request.url, cachedResponse.headers, clock())) return cachedResponse
    // past its limit: delete it now (stopping its use is not enough — QF Terms), and fetch anew
    const deleted = cacheStorage
      .open(cacheName)
      .then((cache) => cache.delete(request))
      .catch(() => false)
    try {
      event?.waitUntil(deleted)
    } catch {
      // the event is no longer active; the deletion still runs
    }
    return null
  }

  let running: Promise<void> | null = null
  const runPurge = async (): Promise<void> => {
    let names: string[]
    try {
      names = await cacheStorage.keys()
    } catch {
      return
    }
    const now = clock()
    for (const name of names) {
      if (!name.startsWith(config.prefix)) continue
      try {
        if (!config.caches.includes(name)) {
          await cacheStorage.delete(name)
          continue
        }
        if (config.undatedCaches.includes(name)) continue
        const cache = await cacheStorage.open(name)
        for (const request of await cache.keys()) {
          const res = await cache.match(request)
          if (!res || staleReason(request.url, res.headers, now)) await cache.delete(request)
        }
      } catch {
        // best effort: the next start-up purges again
      }
    }
  }
  const purge = (): Promise<void> => {
    running ??= runPurge().finally(() => {
      running = null
    })
    return running
  }

  return { ruleFor, staleReason, cacheWillUpdate, cachedResponseWillBeUsed, purge }
}

// ── service-worker wiring ──

interface ExtendableEventLike {
  waitUntil(p: Promise<unknown>): void
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request
  stopImmediatePropagation(): void
}
interface MessageEventLike extends ExtendableEventLike {
  readonly data: unknown
}

/** The parts of ServiceWorkerGlobalScope this runtime uses (the app's TypeScript lib is DOM, not WebWorker). */
export interface SwScope {
  readonly caches: CacheStorage
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void
  addEventListener(type: 'activate', listener: (event: ExtendableEventLike) => void): void
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void
  /** read by the plugin objects build-sw.mjs serialises into sw.js */
  __balligh?: SwRuntime
}

const isPurgeMessage = (data: unknown): boolean => typeof data === 'object' && data !== null && (data as { type?: unknown }).type === PURGE_MESSAGE

/**
 * Wires the runtime into the worker. Must run before Workbox adds its fetch listener (sw.js imports this script
 * first): a Range request stops here and goes to the network untouched.
 */
export function install(scope: SwScope, config: SwRuntimeConfig): SwRuntime {
  const runtime = createRuntime(scope.caches, config)
  scope.__balligh = runtime
  scope.addEventListener('fetch', (event) => {
    if (bypassesCaches(event.request)) event.stopImmediatePropagation()
  })
  scope.addEventListener('activate', (event) => event.waitUntil(runtime.purge()))
  scope.addEventListener('message', (event) => {
    if (isPurgeMessage(event.data)) event.waitUntil(runtime.purge())
  })
  return runtime
}
