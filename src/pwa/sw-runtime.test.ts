import { PURGE_MESSAGE as PAGE_PURGE_MESSAGE } from './options'
import {
  EXPIRES_HEADER,
  PURGE_MESSAGE,
  STORED_HEADER,
  bypassesCaches,
  createRuntime,
  hostMatches,
  hostOf,
  install,
  type SwRuntimeConfig,
  type SwScope,
} from './sw-runtime'

interface Fs {
  readFileSync(path: URL, encoding: 'utf8'): string
}
const readText = async (rel: string) => ((await import('node:fs' as string)) as Fs).readFileSync(new URL(rel, import.meta.url), 'utf8')

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 21, 12)

// ── a Map-backed Cache Storage (enough of the API for the runtime) ──
const urlOf = (r: RequestInfo | URL): string => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url)
class FakeCache {
  readonly store = new Map<string, Response>()
  async match(r: RequestInfo | URL): Promise<Response | undefined> {
    return this.store.get(urlOf(r))?.clone()
  }
  async put(r: RequestInfo | URL, res: Response): Promise<void> {
    this.store.set(urlOf(r), res)
  }
  async delete(r: RequestInfo | URL): Promise<boolean> {
    return this.store.delete(urlOf(r))
  }
  async keys(): Promise<Request[]> {
    return [...this.store.keys()].map((u) => new Request(u))
  }
}
class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()
  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name)
    if (!c) this.caches.set(name, (c = new FakeCache()))
    return c
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()]
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }
}
const asStorage = (s: FakeCacheStorage) => s as unknown as CacheStorage

const CONFIG: SwRuntimeConfig = {
  rules: [
    { match: 'api.quran.com', kind: 'json', qf: true, maxAgeMs: 6 * DAY },
    { match: 'verses.quran.com', kind: 'audio', qf: true, maxAgeMs: 6 * DAY },
    { match: '*.quranicaudio.com', kind: 'audio', qf: true, maxAgeMs: 6 * DAY },
    { match: 'everyayah.com', kind: 'audio', qf: false, maxAgeMs: 2 * DAY },
    { match: 'cdn.jsdelivr.net', kind: 'other', qf: false, maxAgeMs: 6 * DAY },
  ],
  prefix: 'balligh-sw-',
  caches: ['balligh-sw-audio-qf-v1', 'balligh-sw-audio-v1', 'balligh-sw-fonts-v1'],
  undatedCaches: ['balligh-sw-fonts-v1'],
  storeKinds: ['audio'],
}
const QF_URL = 'https://verses.quran.com/Alafasy/mp3/112001.mp3'
const EA_URL = 'https://everyayah.com/data/Alafasy_128kbps/112001.mp3'

const stamped = (body: string, stored: number | null, extra: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'audio/mpeg', ...(stored === null ? {} : { [STORED_HEADER]: String(stored) }), ...extra } })

describe('host matching (src/data/cache-policy.ts semantics)', () => {
  it('reads the lower-cased host, ignoring user info and port', () => {
    expect(hostOf('https://user@Verses.Quran.COM:443/a.mp3')).toBe('verses.quran.com')
    expect(hostOf('http://localhost:8081/x')).toBe('localhost')
    expect(hostOf('/relative/path')).toBeNull()
    expect(hostOf('blob:https://x/1')).toBeNull()
  })
  it('"*.suffix" matches subdomains only, an exact pattern only itself', () => {
    expect(hostMatches('*.quranicaudio.com', 'mirrors.quranicaudio.com')).toBe(true)
    expect(hostMatches('*.quranicaudio.com', 'quranicaudio.com')).toBe(false)
    expect(hostMatches('*.quranicaudio.com', 'evilquranicaudio.com')).toBe(false)
    expect(hostMatches('everyayah.com', 'www.everyayah.com')).toBe(false)
  })
})

describe('contract with data/ and the page', () => {
  it('uses the stamp headers src/data/http.ts dates entries by', async () => {
    const http = await readText('../data/http.ts')
    expect(http).toContain(`export const STORED_HEADER = '${STORED_HEADER}'`)
    expect(http).toContain(`export const EXPIRES_HEADER = '${EXPIRES_HEADER}'`)
  })
  it('listens for the purge message the page posts', () => {
    expect(PURGE_MESSAGE).toBe(PAGE_PURGE_MESSAGE)
  })
})

describe('bypassesCaches', () => {
  it('lets every Range request through to the network', () => {
    expect(bypassesCaches(new Request(QF_URL, { headers: { Range: 'bytes=0-1023' } }))).toBe(true)
    expect(bypassesCaches(new Request(QF_URL))).toBe(false)
  })
})

describe('createRuntime', () => {
  const setup = () => {
    const storage = new FakeCacheStorage()
    const runtime = createRuntime(asStorage(storage), CONFIG, () => NOW)
    return { storage, runtime }
  }

  it('finds the first matching rule', () => {
    const { runtime } = setup()
    expect(runtime.ruleFor(QF_URL)?.match).toBe('verses.quran.com')
    expect(runtime.ruleFor('https://download.quranicaudio.com/q/1.mp3')?.match).toBe('*.quranicaudio.com')
    expect(runtime.ruleFor('https://example.com/a.mp3')).toBeNull()
  })

  describe('cacheWillUpdate', () => {
    it('stamps a whole 200 response of an audio host and keeps its body and type', async () => {
      const { runtime } = setup()
      const res = await runtime.cacheWillUpdate({ request: new Request(QF_URL), response: new Response('mp3-bytes', { headers: { 'content-type': 'audio/mpeg' } }) })
      expect(res?.status).toBe(200)
      expect(res?.headers.get(STORED_HEADER)).toBe(String(NOW))
      expect(res?.headers.get(EXPIRES_HEADER)).toBe(String(NOW + 6 * DAY))
      expect(res?.headers.get('date')).toBe(new Date(NOW).toUTCString())
      expect(res?.headers.get('content-type')).toBe('audio/mpeg')
      expect(await res?.text()).toBe('mp3-bytes')
    })
    it('dates by the host: EveryAyah here keeps 2 days', async () => {
      const { runtime } = setup()
      const res = await runtime.cacheWillUpdate({ request: new Request(EA_URL), response: new Response('x') })
      expect(res?.headers.get(EXPIRES_HEADER)).toBe(String(NOW + 2 * DAY))
    })
    it('refuses partial, opaque/error and failed responses', async () => {
      const { runtime } = setup()
      expect(await runtime.cacheWillUpdate({ request: new Request(QF_URL), response: new Response('x', { status: 206 }) })).toBeNull()
      expect(await runtime.cacheWillUpdate({ request: new Request(QF_URL), response: Response.error() })).toBeNull()
      expect(await runtime.cacheWillUpdate({ request: new Request(QF_URL), response: new Response('x', { status: 404 }) })).toBeNull()
    })
    it('refuses hosts without a policy and policy kinds it does not store', async () => {
      const { runtime } = setup()
      expect(await runtime.cacheWillUpdate({ request: new Request('https://example.com/a.mp3'), response: new Response('x') })).toBeNull()
      expect(await runtime.cacheWillUpdate({ request: new Request('https://api.quran.com/api/v4/chapters'), response: new Response('{}') })).toBeNull()
    })
  })

  describe('cachedResponseWillBeUsed', () => {
    const use = async (stored: number | null, extra: Record<string, string> = {}, url = QF_URL) => {
      const { storage, runtime } = setup()
      const cache = await storage.open('balligh-sw-audio-qf-v1')
      await cache.put(url, stamped('body', stored, extra))
      const waits: Promise<unknown>[] = []
      const out = await runtime.cachedResponseWillBeUsed({
        cacheName: 'balligh-sw-audio-qf-v1',
        request: new Request(url),
        cachedResponse: await cache.match(url),
        event: { waitUntil: (p) => void waits.push(p) },
      })
      await Promise.all(waits)
      return { out, kept: cache.store.has(url) }
    }
    it('serves a copy younger than its limit', async () => {
      const { out, kept } = await use(NOW - 5 * DAY)
      expect(await out?.text()).toBe('body')
      expect(kept).toBe(true)
    })
    it('refuses and deletes a QF copy 6 days old or older', async () => {
      expect(await use(NOW - 6 * DAY)).toEqual({ out: null, kept: false })
      expect(await use(NOW - 30 * DAY)).toEqual({ out: null, kept: false })
    })
    it('applies each host its own limit', async () => {
      expect((await use(NOW - 3 * DAY, {}, EA_URL)).out).toBeNull()
      expect((await use(NOW - DAY, {}, EA_URL)).out).not.toBeNull()
    })
    it('refuses and deletes an undated copy (its age cannot be told)', async () => {
      expect(await use(null)).toEqual({ out: null, kept: false })
    })
    it('refuses a copy stamped in the future (the clock went back)', async () => {
      expect((await use(NOW + DAY)).out).toBeNull()
    })
    it('honours an expiry stamp that ran out', async () => {
      expect((await use(NOW - DAY, { [EXPIRES_HEADER]: String(NOW - 1) })).out).toBeNull()
    })
    it('passes a miss through', async () => {
      const { runtime } = setup()
      expect(await runtime.cachedResponseWillBeUsed({ cacheName: 'balligh-sw-audio-qf-v1', request: new Request(QF_URL) })).toBeNull()
    })
  })

  describe('purge', () => {
    it('deletes stale entries of its dated caches and leftover caches, and leaves everything else alone', async () => {
      const { storage, runtime } = setup()
      const qf = await storage.open('balligh-sw-audio-qf-v1')
      await qf.put(QF_URL, stamped('fresh', NOW - DAY))
      await qf.put('https://verses.quran.com/Alafasy/mp3/112002.mp3', stamped('old', NOW - 7 * DAY))
      await qf.put('https://verses.quran.com/Alafasy/mp3/112003.mp3', stamped('undated', null))
      await qf.put('https://example.com/x.mp3', stamped('no policy', NOW))
      const fonts = await storage.open('balligh-sw-fonts-v1')
      await fonts.put('https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5.3.0/400.css', new Response('css'))
      await storage.open('balligh-sw-audio-v0')
      const data = await storage.open('balligh-data-v2')
      await data.put('https://api.quran.com/api/v4/chapters', stamped('{}', NOW - 9 * DAY))
      await storage.open('balligh-precache-v2-https://example.org/')

      await runtime.purge()

      expect([...qf.store.keys()]).toEqual([QF_URL])
      expect(fonts.store.size).toBe(1)
      expect(await storage.keys()).toEqual(['balligh-sw-audio-qf-v1', 'balligh-sw-fonts-v1', 'balligh-data-v2', 'balligh-precache-v2-https://example.org/'])
      expect(data.store.size).toBe(1) // data/ purges its own cache
    })
    it('runs one purge at a time and never rejects', async () => {
      const { runtime } = setup()
      const a = runtime.purge()
      expect(runtime.purge()).toBe(a)
      await a
      const broken = createRuntime({ keys: () => Promise.reject(new Error('no storage')) } as unknown as CacheStorage, CONFIG, () => NOW)
      await expect(broken.purge()).resolves.toBeUndefined()
    })
  })
})

describe('install', () => {
  type Listener = (e: never) => void
  const fakeScope = () => {
    const listeners = new Map<string, Listener>()
    const scope = {
      caches: asStorage(new FakeCacheStorage()),
      addEventListener: (type: string, l: Listener) => listeners.set(type, l),
    } as unknown as SwScope
    return { scope, listeners }
  }

  it('publishes the runtime for the Workbox plugins and wires fetch, activate and message', async () => {
    const { scope, listeners } = fakeScope()
    const runtime = install(scope, CONFIG)
    expect(scope.__balligh).toBe(runtime)
    expect([...listeners.keys()].sort()).toEqual(['activate', 'fetch', 'message'])

    const stops: string[] = []
    const fetchEvent = (headers: Record<string, string>) => ({ request: new Request(QF_URL, { headers }), stopImmediatePropagation: () => stops.push('stop'), waitUntil: () => {} })
    listeners.get('fetch')!(fetchEvent({ Range: 'bytes=0-1' }) as never)
    listeners.get('fetch')!(fetchEvent({}) as never)
    expect(stops).toEqual(['stop'])

    const waits: Promise<unknown>[] = []
    listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => waits.push(p) } as never)
    listeners.get('message')!({ data: { type: PURGE_MESSAGE }, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never)
    listeners.get('message')!({ data: { type: 'SKIP_WAITING' }, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never)
    listeners.get('message')!({ data: null, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never)
    expect(waits).toHaveLength(2)
    await Promise.all(waits)
  })
})
