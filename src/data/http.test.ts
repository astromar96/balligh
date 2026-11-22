// HTTP layer: retries/backoff, 404 gaps, timeouts, abort, shared in-flight requests, memory + Cache Storage TTL,
// the per-host cache policy (QF ≤ 6 days) with its start-up purge, and per_page=50 paging.
import { mockNet, resetDataCaches, type MockNet } from './__fixtures__/net'
import { CACHE_POLICY, hostMatches, hostOf, policyFor } from './cache-policy'
import {
  AsyncMemo,
  DAY_MS,
  EXPIRES_HEADER,
  HttpError,
  PER_PAGE,
  ProvidersFailedError,
  STORED_HEADER,
  SharedFlights,
  clearMemoryCaches,
  effectiveTtlMs,
  fetchJson,
  fetchPages,
  firstAvailable,
  mapLimit,
  purgeExpiredCaches,
  setCacheStorage,
  setPersistentCacheEnabled,
  staleReason,
  type CacheStorageLike,
} from './http'
import { RECITER_CATALOG } from './reciters.catalog'

const U = 'https://api.example.test/x'
let net: MockNet
beforeEach(() => resetDataCaches())
afterEach(() => net?.restore())

describe('fetchJson', () => {
  it('retries network errors, 5xx and 429 (2 retries), then succeeds', async () => {
    net = mockNet({ [U]: (_url, attempt) => (attempt === 0 ? { status: 503 } : attempt === 1 ? { status: 429 } : { json: { ok: 1 } }) })
    expect(await fetchJson(U, { ttlMs: 0 })).toEqual({ ok: 1 })
    expect(net.count(U)).toBe(3)
  })

  it('gives up after the retries with the last error, and never retries a 4xx', async () => {
    net = mockNet({ [U]: { status: 502 }, [`${U}/400`]: { status: 400 } })
    await expect(fetchJson(U, { ttlMs: 0 })).rejects.toMatchObject({ name: 'HttpError', status: 502 })
    expect(net.count(U)).toBe(3)
    await expect(fetchJson(`${U}/400`, { ttlMs: 0 })).rejects.toBeInstanceOf(HttpError)
    expect(net.count(`${U}/400`)).toBe(1)
    await expect(fetchJson(`${U}/unrouted`, { ttlMs: 0, retries: 1 })).rejects.toBeInstanceOf(TypeError)
    expect(net.count(`${U}/unrouted`)).toBe(2)
  })

  it('resolves null for a 404 when allowed (a gap), otherwise throws', async () => {
    net = mockNet({ [U]: { status: 404 } })
    expect(await fetchJson(U, { ttlMs: 60_000, allow404: true })).toBeNull()
    expect(await fetchJson(U, { ttlMs: 60_000, allow404: true })).toBeNull()
    expect(net.count(U)).toBe(1)
    clearMemoryCaches()
    await expect(fetchJson(U, { ttlMs: 0 })).rejects.toMatchObject({ status: 404 })
  })

  it('rejects invalid JSON', async () => {
    net = mockNet({ [U]: { body: '<html>oops</html>' } })
    await expect(fetchJson(U, { ttlMs: 0 })).rejects.toThrow(/invalid JSON/)
  })

  it('times out a hanging request', async () => {
    net = mockNet({ [U]: { json: 1, delayMs: 300 } })
    await expect(fetchJson(U, { ttlMs: 0, timeoutMs: 20, retries: 0 })).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('aborts with AbortError and does not retry after the abort', async () => {
    net = mockNet({ [U]: { json: 1, delayMs: 300 } })
    const ac = new AbortController()
    const p = fetchJson(U, { ttlMs: 0, signal: ac.signal })
    setTimeout(() => ac.abort(), 10)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(net.count(U)).toBe(1)
    await expect(fetchJson(U, { ttlMs: 0, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('shares one request between concurrent callers; one caller aborting does not cancel the others', async () => {
    net = mockNet({ [U]: { json: { v: 1 }, delayMs: 60 } })
    const ac = new AbortController()
    const a = fetchJson(U, { ttlMs: 60_000, signal: ac.signal })
    const b = fetchJson(U, { ttlMs: 60_000 })
    ac.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(await b).toEqual({ v: 1 })
    expect(net.count(U)).toBe(1)
    expect(await fetchJson(U, { ttlMs: 60_000 })).toEqual({ v: 1 }) // memory hit
    expect(net.count(U)).toBe(1)
  })

  it('persists in Cache Storage with an expiry and serves it after the memory cache is gone', async () => {
    const store = new Map<string, Response>()
    const keyOf = (r: RequestInfo | URL) => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url)
    const cache = {
      match: async (r: RequestInfo | URL) => store.get(keyOf(r))?.clone(),
      put: async (r: RequestInfo | URL, res: Response) => void store.set(keyOf(r), res),
      delete: async (r: RequestInfo | URL) => store.delete(keyOf(r)),
      keys: async () => [...store.keys()].map((u) => new Request(u)),
    }
    const g = globalThis as { caches?: unknown }
    g.caches = { open: async () => cache }
    try {
      net = mockNet({ [U]: (_u, attempt) => (attempt === 0 ? { json: { fresh: true } } : { status: 500 }) })
      setPersistentCacheEnabled(true)
      expect(await fetchJson(U, { ttlMs: 7 * 86_400_000 })).toEqual({ fresh: true })
      await new Promise((r) => setTimeout(r, 10))
      const expires = Number(store.get(U)?.headers.get('x-balligh-expires'))
      expect(expires).toBeGreaterThan(Date.now() + 6.9 * 86_400_000)
      expect(expires).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000)
      clearMemoryCaches()
      expect(await fetchJson(U, { ttlMs: 7 * 86_400_000 })).toEqual({ fresh: true })
      expect(net.count(U)).toBe(1)
      // an expired entry is deleted and not served
      store.set(U, new Response(JSON.stringify({ stale: true }), { headers: { 'x-balligh-expires': String(Date.now() - 1) } }))
      clearMemoryCaches()
      await expect(fetchJson(U, { ttlMs: 7 * 86_400_000, retries: 0 })).rejects.toMatchObject({ status: 500 })
      expect(store.has(U)).toBe(false)
    } finally {
      delete g.caches
    }
  })
})

describe('helpers', () => {
  it('firstAvailable returns the first provider that answers, else all causes', async () => {
    const ok = await firstAvailable('x', [
      { id: 'a', run: async () => Promise.reject(new Error('down')) },
      { id: 'b', run: async () => 42 },
    ])
    expect(ok).toEqual({ value: 42, providerId: 'b' })
    const err = await firstAvailable('thing', [{ id: 'a', run: async () => Promise.reject(new Error('e1')) }]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProvidersFailedError)
    expect((err as ProvidersFailedError).message).toContain('e1')
    const abort = new DOMException('Aborted', 'AbortError')
    const second = vi.fn(async () => 1)
    await expect(firstAvailable('y', [{ id: 'a', run: async () => Promise.reject(abort) }, { id: 'b', run: second }])).rejects.toBe(abort)
    expect(second).not.toHaveBeenCalled()
  })

  it('mapLimit keeps order and bounds concurrency', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (x) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, x))
      active--
      return x * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })

  it('AsyncMemo computes once per key and SharedFlights aborts work only when every caller left', async () => {
    const memo = new AsyncMemo()
    const compute = vi.fn(async () => 'v')
    expect(await Promise.all([memo.get('k', 1000, compute), memo.get('k', 1000, compute)])).toEqual(['v', 'v'])
    expect(await memo.get('k', 1000, compute)).toBe('v')
    expect(compute).toHaveBeenCalledTimes(1)

    const flights = new SharedFlights()
    let workSignal: AbortSignal | null = null
    const work = (s: AbortSignal) => {
      workSignal = s
      return new Promise<number>((resolve) => setTimeout(() => resolve(1), 50))
    }
    const a = new AbortController()
    const b = new AbortController()
    const pa = flights.run('k', work, a.signal)
    const pb = flights.run('k', work, b.signal)
    a.abort()
    await expect(pa).rejects.toMatchObject({ name: 'AbortError' })
    expect(workSignal!.aborted).toBe(false)
    b.abort()
    await expect(pb).rejects.toMatchObject({ name: 'AbortError' })
    expect(workSignal!.aborted).toBe(true)
  })
})

// ───────────────────────── cache policy + purge ─────────────────────────

type Stamp = { stored?: number; expires?: number }

/** A fake Cache Storage: named caches of url → response stamps (the purge reads only the headers). */
function fakeCaches(init: Record<string, Record<string, Stamp>>) {
  const caches = new Map<string, Map<string, Response>>()
  const deleted: string[] = []
  const keyOf = (r: RequestInfo | URL) => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url)
  const respond = (s: Stamp) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (s.stored !== undefined) headers[STORED_HEADER] = String(s.stored)
    if (s.expires !== undefined) headers[EXPIRES_HEADER] = String(s.expires)
    return new Response('{"cached":true}', { headers })
  }
  for (const [name, entries] of Object.entries(init)) caches.set(name, new Map(Object.entries(entries).map(([u, st]) => [u, respond(st)])))
  const cacheOf = (store: Map<string, Response>) =>
    ({
      match: async (r: RequestInfo | URL) => store.get(keyOf(r))?.clone(),
      put: async (r: RequestInfo | URL, res: Response) => void store.set(keyOf(r), res),
      delete: async (r: RequestInfo | URL) => {
        deleted.push(keyOf(r))
        return store.delete(keyOf(r))
      },
      keys: async () => [...store.keys()].map((u) => new Request(u)),
    }) as unknown as Cache
  const cs: CacheStorageLike = {
    open: async (name) => {
      let store = caches.get(name)
      if (!store) caches.set(name, (store = new Map()))
      return cacheOf(store)
    },
    keys: async () => [...caches.keys()],
    delete: async (name) => {
      deleted.push(`cache:${name}`)
      return caches.delete(name)
    },
  }
  const contents = () => Object.fromEntries([...caches].map(([n, m]) => [n, [...m.keys()].sort()]))
  const headersOf = (name: string, url: string) => caches.get(name)?.get(url)?.headers ?? null
  return { cs, deleted, contents, headersOf }
}

const QF_JSON = 'https://api.quran.com/api/v4/verses/by_chapter/1?words=true&per_page=50&page=1'
const QF_AUDIO = 'https://download.quranicaudio.com/qdc/khalifah_taniji/murattal/1.mp3'

describe('cache policy (00-gaps §2.9, §6.1: QF content ≤ 6 days)', () => {
  it('keeps every Quran Foundation host — the audio hosts included — at most 6 days', () => {
    const qf = CACHE_POLICY.filter((e) => e.qf)
    expect(qf.length).toBeGreaterThan(5)
    for (const e of qf) expect(e.maxAgeDays, e.match).toBeLessThanOrEqual(6)
    for (const e of CACHE_POLICY) expect(['json', 'audio', 'font', 'other'], e.match).toContain(e.kind)
    expect(policyFor(QF_JSON)).toMatchObject({ qf: true, kind: 'json', maxAgeDays: 6 })
    expect(policyFor(QF_AUDIO)).toMatchObject({ qf: true, kind: 'audio', maxAgeDays: 6 })
    expect(policyFor('https://verses.quran.com/Alafasy/mp3/001001.mp3')).toMatchObject({ qf: true, kind: 'audio' })
    expect(policyFor('https://mirrors.quranicaudio.com/everyayah/Husary_64kbps/001001.mp3')).toMatchObject({ qf: true, kind: 'audio' })
    expect(policyFor('https://static.qurancdn.com/x.json')).toMatchObject({ qf: true })
    expect(policyFor('https://everyayah.com/data/Alafasy_128kbps/001001.mp3')).toMatchObject({ qf: false, kind: 'audio' })
    expect(policyFor('https://example.com/app.js')).toBeNull()
    expect(policyFor('/assets/fonts/AmiriQuran-Regular.ttf')).toBeNull()
  })

  it('names every host data/ requests', () => {
    const urls = [
      QF_JSON,
      QF_AUDIO,
      'https://api.alquran.cloud/v1/surah/1/editions/quran-uthmani,quran-tajweed',
      'https://quranenc.com/api/v1/translation/sura/arabic_moyassar/1',
      'https://api.quranpedia.net/v1/tafsir/1/1/1',
      'https://www.mp3quran.net/api/v3/ayat_timing?surah=1&read=123',
      'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/x/1/1.json',
      ...RECITER_CATALOG.flatMap((e) => [e.everyayah?.urlTemplate, e.mp3quran?.urlTemplate]).filter((u): u is string => !!u),
    ]
    expect(urls.filter((u) => !policyFor(u))).toEqual([])
  })

  it('matches exact hosts, and "*.suffix" subdomains only', () => {
    expect(hostOf('https://user@API.Quran.com:443/x?y=1')).toBe('api.quran.com')
    expect(hostOf('blob:https://x/1')).toBeNull()
    expect(hostMatches('*.quran.com', 'api.quran.com')).toBe(true)
    expect(hostMatches('*.quran.com', 'quran.com')).toBe(false)
    expect(hostMatches('*.quran.com', 'notquran.com')).toBe(false)
    expect(hostMatches('quran.com', 'api.quran.com')).toBe(false)
  })

  it('caps a longer TTL by the host policy, never lengthens a shorter one', () => {
    expect(effectiveTtlMs(QF_JSON, 7 * DAY_MS)).toBe(6 * DAY_MS)
    expect(effectiveTtlMs(QF_JSON, 60_000)).toBe(60_000)
    expect(effectiveTtlMs('https://www.mp3quran.net/api/v3/ayat_timing?surah=1&read=1', 7 * DAY_MS)).toBe(DAY_MS)
    expect(effectiveTtlMs(U, 30 * DAY_MS)).toBe(30 * DAY_MS)
  })

  it('tells why a cached entry must go', () => {
    const now = 1_000 * DAY_MS
    const h = (s: Stamp) => new Headers({ ...(s.stored !== undefined && { [STORED_HEADER]: String(s.stored) }), ...(s.expires !== undefined && { [EXPIRES_HEADER]: String(s.expires) }) })
    expect(staleReason(QF_JSON, h({ stored: now - DAY_MS, expires: now + DAY_MS }), now)).toBeNull()
    expect(staleReason(QF_JSON, h({ stored: now - 6 * DAY_MS, expires: now + DAY_MS }), now)).toBe('older than the host policy')
    expect(staleReason(QF_JSON, h({ expires: now + DAY_MS }), now)).toBe('undated QF content')
    expect(staleReason(QF_AUDIO, null, now)).toBe('undated QF content')
    expect(staleReason(QF_JSON, h({ stored: now, expires: now }), now)).toBe('expired')
    expect(staleReason('https://everyayah.com/data/x/001001.mp3', h({}), now)).toBeNull() // non-QF, undated: kept
    expect(staleReason('https://everyayah.com/data/x/001001.mp3', h({ stored: now - 30 * DAY_MS }), now)).toBe('older than the host policy')
    expect(staleReason('https://example.com/app.js', h({ stored: 1 }), now)).toBeNull()
  })
})

describe('purgeExpiredCaches', () => {
  let prev: CacheStorageLike | null | undefined
  beforeEach(() => {
    prev = setCacheStorage(undefined)
  })
  afterEach(() => {
    setCacheStorage(prev)
  })

  it('deletes expired, over-age and undated QF entries and the legacy cache, from every cache — and nothing else', async () => {
    const now = Date.now()
    const f = fakeCaches({
      'balligh-data-v2': {
        [`${QF_JSON}&fresh`]: { stored: now - 5 * DAY_MS, expires: now + DAY_MS },
        [`${QF_JSON}&old`]: { stored: now - 6 * DAY_MS - 1000, expires: now + DAY_MS },
        [`${QF_JSON}&expired`]: { stored: now - DAY_MS, expires: now - 1 },
        'https://quranenc.com/api/v1/translation/sura/x/1': { stored: now - 6.5 * DAY_MS, expires: now + DAY_MS / 2 },
      },
      'qf-audio': {
        [QF_AUDIO]: { stored: now - DAY_MS },
        'https://verses.quran.com/Alafasy/mp3/001001.mp3': {},
        'https://everyayah.com/data/x/001001.mp3': {},
        'https://everyayah.com/data/x/001002.mp3': { stored: now - 31 * DAY_MS },
      },
      'app-shell': { 'https://balligh.example/index.html': {}, 'https://balligh.example/app.js': { stored: 1 } },
      'balligh-data-v1': { [QF_JSON]: { expires: now + 7 * DAY_MS } },
    })
    setCacheStorage(f.cs)
    await purgeExpiredCaches()
    expect(f.contents()).toEqual({
      'balligh-data-v2': [`${QF_JSON}&fresh`, 'https://quranenc.com/api/v1/translation/sura/x/1'],
      'qf-audio': [QF_AUDIO, 'https://everyayah.com/data/x/001001.mp3'],
      'app-shell': ['https://balligh.example/app.js', 'https://balligh.example/index.html'],
    })
    // idempotent: a second run finds nothing to delete
    const deletions = f.deleted.length
    await purgeExpiredCaches()
    expect(f.deleted.length).toBe(deletions)
  })

  it('shares one purge between concurrent calls and never throws', async () => {
    const f = fakeCaches({})
    setCacheStorage(f.cs)
    const a = purgeExpiredCaches()
    expect(purgeExpiredCaches()).toBe(a)
    await a
    const broken: CacheStorageLike = {
      open: () => Promise.reject(new Error('denied')),
      keys: async () => ['x', 'balligh-data-v1'],
      delete: () => Promise.reject(new Error('denied')),
    }
    setCacheStorage(broken)
    await expect(purgeExpiredCaches()).resolves.toBeUndefined()
    setCacheStorage({ ...broken, keys: () => Promise.reject(new Error('SecurityError')) })
    await expect(purgeExpiredCaches()).resolves.toBeUndefined()
    setCacheStorage(null) // native: no Cache Storage
    await expect(purgeExpiredCaches()).resolves.toBeUndefined()
  })

  it('stores QF responses with both stamps and at most 6 days, even when asked for longer', async () => {
    const f = fakeCaches({})
    setCacheStorage(f.cs)
    net = mockNet({ [QF_JSON]: { json: { verses: [] } } })
    setPersistentCacheEnabled(true)
    const t0 = Date.now()
    expect(await fetchJson(QF_JSON, { ttlMs: 7 * DAY_MS })).toEqual({ verses: [] })
    await new Promise((r) => setTimeout(r, 10))
    const h = f.headersOf('balligh-data-v2', QF_JSON)
    expect(Number(h?.get(STORED_HEADER))).toBeGreaterThanOrEqual(t0)
    expect(Number(h?.get(EXPIRES_HEADER)) - Number(h?.get(STORED_HEADER))).toBe(6 * DAY_MS)
  })

  it('starts a purge the first time the cache is opened (in case the app did not)', async () => {
    vi.resetModules()
    const fresh = await import('./http')
    const now = Date.now()
    const f = fakeCaches({ 'balligh-data-v1': { [QF_JSON]: {} }, other: { [QF_AUDIO]: { stored: now - 7 * DAY_MS } } })
    fresh.setCacheStorage(f.cs)
    fresh.setFetcher(async () => new Response('{"a":1}'))
    expect(await fresh.fetchJson(U, { ttlMs: DAY_MS })).toEqual({ a: 1 })
    await new Promise((r) => setTimeout(r, 20))
    expect(f.contents()).toEqual({ other: [], 'balligh-data-v2': [U] })
  })
})

// ───────────────────────── paging ─────────────────────────

describe('fetchPages (per_page=50 + pagination, 00-gaps §2.10)', () => {
  const page = (p: number) => `${U}/pages?per_page=${PER_PAGE}&page=${p}`
  const body = (p: number, perPage: number, total: number) => ({
    items: [p],
    pagination: { per_page: perPage, current_page: p, next_page: p < total ? p + 1 : null, total_pages: total },
  })

  it('fetches only the pages that hold the wanted records when the server pages as asked', async () => {
    net = mockNet({}, (url) => {
      const p = Number(/page=(\d+)$/.exec(url)?.[1])
      return { json: body(p, 50, 6) }
    })
    const out = await fetchPages<ReturnType<typeof body>>(page, 51, 120, { ttlMs: 60_000 })
    expect(out.map((b) => b.items[0])).toEqual([2, 3])
    expect(net.calls).toEqual([page(2), page(3)])
    expect((await fetchPages<ReturnType<typeof body>>(page, 1, 50, { ttlMs: 60_000 })).map((b) => b.items[0])).toEqual([1])
  })

  it('walks next_page from page 1 when the server pages differently (callers then pick records by key)', async () => {
    net = mockNet({}, (url) => {
      const p = Number(/page=(\d+)$/.exec(url)?.[1])
      return p <= 4 ? { json: body(p, 10, 4) } : null // a server capped at 10 per page
    })
    const out = await fetchPages<ReturnType<typeof body>>(page, 51, 60, { ttlMs: 60_000 })
    expect(out.map((b) => b.items[0])).toEqual([1, 2, 3, 4])
    expect(net.calls).toEqual([page(2), page(1), page(3), page(4)]) // page 2 is re-read from memory
  })

  it('stops a walk without pagination, on a non-advancing next_page, and after 12 pages', async () => {
    net = mockNet({ [page(1)]: { json: { items: [1] } } })
    expect(await fetchPages(page, 1, 10, { ttlMs: 0 })).toEqual([{ items: [1] }])
    net.restore()
    net = mockNet({}, () => ({ json: { items: [], pagination: { per_page: 10, current_page: 1, next_page: 1 } } }))
    expect(await fetchPages(page, 1, 10, { ttlMs: 0 })).toHaveLength(1)
    net.restore()
    net = mockNet({}, (url) => {
      const p = Number(/page=(\d+)$/.exec(url)?.[1])
      return { json: { items: [p], pagination: { per_page: 10, current_page: p, next_page: p + 1 } } }
    })
    expect(await fetchPages(page, 1, 10, { ttlMs: 0 })).toHaveLength(12)
  })
})
