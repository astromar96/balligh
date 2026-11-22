// Test-only fake network for data/ (never imported by app code): routes exact URLs to canned replies, records
// every request, and turns anything unrouted into a network error — unit tests never touch the real network.
import { clearMemoryCaches, setBackoffBaseMs, setFetcher, setPersistentCacheEnabled } from '../http'
import { clearQuranMemo } from '../quran'
import { clearSearchMemo } from '../search'

export interface ReplySpec {
  status?: number
  /** serialised as the body */
  json?: unknown
  /** raw body (wins over json) */
  body?: string
  delayMs?: number
}
export type Reply = ReplySpec | ((url: string, attempt: number) => ReplySpec | Promise<ReplySpec>)

export interface MockNet {
  /** every requested URL, in order (retries included) */
  calls: string[]
  count(match: string | RegExp): number
  restore(): void
}

const isSpec = (r: Reply): r is ReplySpec => typeof r !== 'function'

/** Installs the fake network; `routes` maps a full URL to a reply, `fallback` answers the rest (default: network error). */
export function mockNet(routes: Record<string, Reply>, fallback?: (url: string) => ReplySpec | null): MockNet {
  const calls: string[] = []
  const attempts = new Map<string, number>()
  setPersistentCacheEnabled(false)
  const prevBackoff = setBackoffBaseMs(1)
  const prev = setFetcher(async (url, init) => {
    calls.push(url)
    const attempt = attempts.get(url) ?? 0
    attempts.set(url, attempt + 1)
    const route = routes[url]
    const spec: ReplySpec | null = route === undefined ? (fallback?.(url) ?? null) : isSpec(route) ? route : await route(url, attempt)
    if (!spec) throw new TypeError(`Failed to fetch (unrouted in test): ${url}`)
    const make = () =>
      new Response(spec.body ?? JSON.stringify(spec.json ?? null), { status: spec.status ?? 200, headers: { 'content-type': 'application/json' } })
    if (!spec.delayMs) return make()
    return new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(make()), spec.delayMs)
      init.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    })
  })
  return {
    calls,
    count: (m) => calls.filter((u) => (typeof m === 'string' ? u === m : m.test(u))).length,
    restore: () => {
      setFetcher(prev)
      setBackoffBaseMs(prevBackoff)
      setPersistentCacheEnabled(true)
    },
  }
}

/** Forgets every cached response and parsed result between tests. */
export function resetDataCaches(): void {
  clearMemoryCaches()
  clearQuranMemo()
  clearSearchMemo()
}
