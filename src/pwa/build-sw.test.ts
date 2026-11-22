// scripts/build-sw.mjs: cache-policy → worker rules and routes, the export/manifest guards, and one full build over a
// small fixture export in a temp directory (generateSW runs for real; nothing touches the network).
import type { SwRule, SwScope } from './sw-runtime'

interface Route {
  urlPattern: RegExp | ((p: { url: URL; sameOrigin: boolean }) => boolean)
  handler: string
  options: Record<string, unknown> & { cacheName: string }
}
interface BuildResult {
  swFile: string
  runtimeFile: string
  precached: { rel: string; url: string; size: number }[]
  dropped: string[]
  count: number
}
interface BuildSw {
  QF_MAX_DAYS: number
  AUDIO_MAX_DAYS: number
  CACHES: Record<'audioQf' | 'audio' | 'fonts' | 'static', string>
  HASHED_URL: RegExp
  normalizeBase(raw?: string): string
  maxAgeDays(entry: { kind: string; qf: boolean; maxAgeDays: number }): number
  swRules(policy: unknown): SwRule[]
  hostsRegExp(matches: string[]): RegExp
  audioRoutes(rules: SwRule[]): { cacheName: string; urlPattern: RegExp; maxAgeSeconds: number }[]
  runtimeCaching(rules: SwRule[]): Route[]
  buildRuntimeScript(config: unknown): Promise<{ file: string; code: string }>
  checkBase(html: string, base: string): void
  checkManifest(outDir: string, html: string, base: string): { name: string }
  pngSize(file: string): { width: number; height: number } | null
  buildServiceWorker(o: { outDir: string; base?: string; log?: (line: string) => void }): Promise<BuildResult>
}
interface Fs {
  readFileSync(path: string | URL, encoding: 'utf8'): string
  readFileSync(path: string | URL): Uint8Array
  writeFileSync(path: string, data: string | Uint8Array): void
  mkdirSync(path: string, options: { recursive: boolean }): void
  mkdtempSync(prefix: string): string
  readdirSync(path: string): string[]
  existsSync(path: string): boolean
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void
}

const fs = async () => (await import('node:fs' as string)) as Fs
const tmpdir = async () => ((await import('node:os' as string)) as { tmpdir(): string }).tmpdir()
const load = async () => (await import('../../scripts/build-sw.mjs' as string)) as BuildSw
const repo = (rel: string) => new URL(`../../${rel}`, import.meta.url)
const policy = async () => JSON.parse((await fs()).readFileSync(repo('src/data/cache-policy.json'), 'utf8')) as unknown
const DAY_MS = 86_400_000

describe('normalizeBase', () => {
  it('accepts the root and plain sub-paths', async () => {
    const { normalizeBase } = await load()
    expect(normalizeBase('')).toBe('')
    expect(normalizeBase('/')).toBe('')
    expect(normalizeBase('balligh')).toBe('/balligh')
    expect(normalizeBase('/balligh/')).toBe('/balligh')
    expect(normalizeBase('/a/b-c.d')).toBe('/a/b-c.d')
  })
  it('rejects anything else', async () => {
    const { normalizeBase } = await load()
    for (const bad of ['https://x.io/balligh', '/bal ligh', '/a?b=1', '/a#b', '//x']) expect(() => normalizeBase(bad)).toThrow(/BALLIGH_BASE_URL/)
  })
})

describe('cache policy → worker rules', () => {
  it('caps QF hosts and every audio host at 6 days, keeps other limits', async () => {
    const { maxAgeDays } = await load()
    expect(maxAgeDays({ kind: 'json', qf: true, maxAgeDays: 7 })).toBe(6)
    expect(maxAgeDays({ kind: 'audio', qf: false, maxAgeDays: 30 })).toBe(6)
    expect(maxAgeDays({ kind: 'json', qf: false, maxAgeDays: 7 })).toBe(7)
    expect(maxAgeDays({ kind: 'json', qf: false, maxAgeDays: 1 })).toBe(1)
  })
  it('turns src/data/cache-policy.json into rules in file order', async () => {
    const { swRules } = await load()
    const raw = (await policy()) as { match: string }[]
    const rules = swRules(raw)
    expect(rules.map((r) => r.match)).toEqual(raw.map((e) => e.match))
    for (const r of rules) {
      if (r.qf || r.kind === 'audio') expect(r.maxAgeMs).toBeLessThanOrEqual(6 * DAY_MS)
    }
    expect(rules.find((r) => r.match === 'everyayah.com')?.maxAgeMs).toBe(6 * DAY_MS)
    expect(rules.find((r) => r.match === 'cdn.mp3quran.net')?.maxAgeMs).toBe(6 * DAY_MS)
  })
  it('rejects a malformed policy', async () => {
    const { swRules } = await load()
    expect(() => swRules([])).toThrow()
    expect(() => swRules([{ match: 'x.com', kind: 'video', qf: false, maxAgeDays: 1 }])).toThrow(/malformed/)
    expect(() => swRules([{ match: 'x.com', kind: 'json', qf: 'yes', maxAgeDays: 1 }])).toThrow(/malformed/)
    expect(() => swRules([{ match: 'https://x.com/', kind: 'json', qf: false, maxAgeDays: 1 }])).toThrow(/malformed/)
  })
})

describe('routes', () => {
  it('host patterns match the host part only', async () => {
    const { hostsRegExp } = await load()
    const re = hostsRegExp(['verses.quran.com', '*.quranicaudio.com'])
    for (const ok of ['https://verses.quran.com/a.mp3', 'https://mirrors.quranicaudio.com/x.mp3', 'https://download.quranicaudio.com:443/q.mp3']) expect(re.test(ok)).toBe(true)
    for (const no of ['https://quranicaudio.com/x', 'https://verses.quran.com.evil.io/a', 'https://evil.io/verses.quran.com/a', 'https://api.quran.com/api/v4/x']) expect(re.test(no)).toBe(false)
  })
  it('audio: QF hosts and the others in two caches, 6 days, whole files fetched past the HTTP cache', async () => {
    const { swRules, audioRoutes, runtimeCaching, CACHES } = await load()
    const rules = swRules(await policy())
    const routes = audioRoutes(rules)
    expect(routes.map((r) => r.cacheName)).toEqual([CACHES.audioQf, CACHES.audio])
    const [qf, other] = routes
    for (const u of ['https://verses.quran.com/Alafasy/mp3/112001.mp3', 'https://download.quranicaudio.com/qdc/x/1.mp3', 'https://audio.qurancdn.com/x.mp3']) expect(qf.urlPattern.test(u)).toBe(true)
    for (const u of ['https://everyayah.com/data/Alafasy_128kbps/112001.mp3', 'https://cdn.mp3quran.net/audio/x/112.mp3']) expect(other.urlPattern.test(u)).toBe(true)
    expect(qf.urlPattern.test('https://everyayah.com/data/x.mp3')).toBe(false)
    expect(routes.every((r) => r.maxAgeSeconds === 6 * 86_400)).toBe(true)

    const audio = runtimeCaching(rules).filter((r) => r.options.cacheName === CACHES.audioQf || r.options.cacheName === CACHES.audio)
    expect(audio).toHaveLength(2)
    for (const r of audio) {
      expect(r.handler).toBe('CacheFirst')
      expect(r.options.fetchOptions).toEqual({ cache: 'no-store' })
      expect(r.options.cacheableResponse).toEqual({ statuses: [200] })
      // generateSW emits plugins in option order: the status filter must run before the stamp
      const keys = Object.keys(r.options)
      expect(keys.indexOf('cacheableResponse')).toBeLessThan(keys.indexOf('plugins'))
      expect(keys.indexOf('plugins')).toBeLessThan(keys.indexOf('expiration'))
    }
  })
  it('caches no JSON API host: data/ owns those responses', async () => {
    const { swRules, runtimeCaching } = await load()
    const routes = runtimeCaching(swRules(await policy()))
    const json = ['https://api.quran.com/api/v4/chapters', 'https://quranenc.com/api/v1/translation/sura/x/1', 'https://api.alquran.cloud/v1/surah', 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@v1.2.3/tafsir/x/1/1.json']
    for (const u of json) {
      const hit = routes.some((r) => (r.urlPattern instanceof RegExp ? r.urlPattern.test(u) : r.urlPattern({ url: new URL(u), sameOrigin: false })))
      expect(hit, u).toBe(false)
    }
  })
  it('fontsource files (jsDelivr, unpkg) for a year; same-origin build files on demand', async () => {
    const { swRules, runtimeCaching, CACHES } = await load()
    const routes = runtimeCaching(swRules(await policy()))
    const fonts = routes.find((r) => r.options.cacheName === CACHES.fonts)!
    const re = fonts.urlPattern as RegExp
    expect(re.test('https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5.3.0/files/noto-sans-latin-400-normal.woff2')).toBe(true)
    expect(re.test('https://unpkg.com/@fontsource/noto-naskh-arabic@5.3.0/400.css')).toBe(true)
    expect(re.test('https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@v1.2.3/tafsir/x.json')).toBe(false)
    expect(fonts.options.expiration).toMatchObject({ maxAgeSeconds: 365 * 86_400 })
    const statics = routes.find((r) => r.options.cacheName === CACHES.static)!
    const match = statics.urlPattern as (p: { url: URL; sameOrigin: boolean }) => boolean
    expect(match({ url: new URL('https://x.io/balligh/assets/node_modules/a.ttf'), sameOrigin: true })).toBe(true)
    expect(match({ url: new URL('https://x.io/balligh/_expo/static/js/web/a.js'), sameOrigin: true })).toBe(true)
    expect(match({ url: new URL('https://cdn.io/assets/a.ttf'), sameOrigin: false })).toBe(false)
  })
})

describe('guards', () => {
  const html = (base: string) =>
    `<html><head><link rel="manifest" href="${base}/manifest.webmanifest"/><script defer="" src="${base}/_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js"></script></head></html>`
  it('checkBase: the export and the worker must agree on the base URL', async () => {
    const { checkBase } = await load()
    expect(() => checkBase(html('/balligh'), '/balligh')).not.toThrow()
    expect(() => checkBase(html(''), '')).not.toThrow()
    expect(() => checkBase(html('/balligh'), '')).toThrow(/another base URL/)
    expect(() => checkBase(html(''), '/balligh')).toThrow(/another base URL/)
    expect(() => checkBase('<html></html>', '')).toThrow(/no \/_expo\/static\/js\/ bundle/)
  })
  it('pngSize reads the committed icons', async () => {
    const { pngSize } = await load()
    const at = (f: string) => decodeURIComponent(repo(`public/icons/${f}`).pathname)
    expect(pngSize(at('icon-192.png'))).toEqual({ width: 192, height: 192 })
    expect(pngSize(at('icon-512.png'))).toEqual({ width: 512, height: 512 })
    expect(pngSize(at('icon-maskable-512.png'))).toEqual({ width: 512, height: 512 })
    expect(pngSize(at('apple-touch-icon.png'))).toEqual({ width: 180, height: 180 })
    expect(pngSize(decodeURIComponent(repo('public/manifest.webmanifest').pathname))).toBeNull()
  })
})

// ── fixture export ──
const HASH_A = '0123456789abcdef0123456789abcdef'
const HASH_B = 'fedcba9876543210fedcba9876543210'
async function makeExport(base: string, manifestPatch?: (m: Record<string, unknown>) => void): Promise<string> {
  const f = await fs()
  const dir = f.mkdtempSync(`${await tmpdir()}/balligh-pwa-test-`)
  const put = (rel: string, data: string | Uint8Array) => {
    const path = `${dir}/${rel}`
    f.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    f.writeFileSync(path, data)
  }
  put(
    'index.html',
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charSet="utf-8"/>' +
      `<link rel="manifest" href="${base}/manifest.webmanifest"/>` +
      `<link rel="preload" href="${base}/assets/fonts/Used.${HASH_A}.ttf" as="font" crossorigin=""/>` +
      `<script defer="" src="${base}/_expo/static/js/web/entry-${HASH_A}.js"></script></head><body></body></html>`,
  )
  put(`_expo/static/js/web/entry-${HASH_A}.js`, 'console.log("entry")')
  put(`_expo/static/js/web/mediabunny-aac-encoder-${HASH_B}.js`, 'console.log("aac")')
  put(`assets/fonts/Used.${HASH_A}.ttf`, 'font')
  put(`assets/fonts/Unused.${HASH_B}.ttf`, 'font')
  put('harfbuzz.wasm', new Uint8Array([0, 97, 115, 109]))
  put('favicon.ico', 'ico')
  put('_sitemap.html', '<html></html>')
  put('+not-found.html', '<html></html>')
  put('_expo/.routes.json', '{}')
  const manifest = JSON.parse(f.readFileSync(repo('public/manifest.webmanifest'), 'utf8')) as Record<string, unknown>
  manifestPatch?.(manifest)
  put('manifest.webmanifest', JSON.stringify(manifest))
  for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) put(`icons/${icon}`, f.readFileSync(repo(`public/icons/${icon}`)))
  return dir
}

describe('checkManifest (public/manifest.webmanifest + public/icons as exported)', () => {
  it('the committed manifest passes at the root and under /balligh', async () => {
    const { checkManifest } = await load()
    const f = await fs()
    for (const base of ['', '/balligh']) {
      const dir = await makeExport(base)
      expect(checkManifest(dir, f.readFileSync(`${dir}/index.html`, 'utf8'), base).name).toBe('بلّغ')
      f.rmSync(dir, { recursive: true, force: true })
    }
  })
  it('names what is wrong', async () => {
    const { checkManifest } = await load()
    const f = await fs()
    const cases: [(m: Record<string, unknown>) => void, RegExp][] = [
      [(m) => (m.start_url = '/'), /start_url resolves to \/, not the app's root \/balligh\//],
      [(m) => (m.display = 'browser'), /display "browser"/],
      [(m) => ((m.icons as { sizes: string }[])[1].sizes = '256x256'), /icon-512.png is 512x512, declared 256x256/],
      [(m) => (m.icons = (m.icons as { purpose: string }[]).filter((i) => i.purpose !== 'maskable')), /no maskable icon/],
      [(m) => ((m.icons as { src: string }[])[0].src = 'icons/missing.png'), /missing.png is missing/],
    ]
    for (const [patch, error] of cases) {
      const dir = await makeExport('/balligh', patch)
      expect(() => checkManifest(dir, f.readFileSync(`${dir}/index.html`, 'utf8'), '/balligh')).toThrow(error)
      f.rmSync(dir, { recursive: true, force: true })
    }
    const dir = await makeExport('')
    expect(() => checkManifest(dir, '<html><head></head></html>', '')).toThrow(/no <link rel="manifest">/)
    f.rmSync(dir, { recursive: true, force: true })
  })
})

describe('buildServiceWorker (generateSW over a fixture export)', () => {
  it('precaches the shell under /balligh, leaves out unreferenced assets and router pages, wires the runtime', { timeout: 120_000 }, async () => {
    const { buildServiceWorker, CACHES } = await load()
    const f = await fs()
    const dir = await makeExport('/balligh')
    const lines: string[] = []
    const first = await buildServiceWorker({ outDir: dir, base: '/balligh', log: (l) => lines.push(l) })
    const result = await buildServiceWorker({ outDir: dir, base: 'balligh/', log: () => {} }) // a second run replaces the first

    const rels = result.precached.map((e) => e.rel).sort()
    expect(rels).toEqual(
      [
        'index.html',
        `_expo/static/js/web/entry-${HASH_A}.js`,
        `_expo/static/js/web/mediabunny-aac-encoder-${HASH_B}.js`,
        `assets/fonts/Used.${HASH_A}.ttf`,
        'harfbuzz.wasm',
        'favicon.ico',
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
      ].sort(),
    )
    expect(result.dropped).toEqual([`assets/fonts/Unused.${HASH_B}.ttf`])
    expect(result.precached.every((e) => e.url === `/balligh/${e.rel}`)).toBe(true)
    expect(lines.some((l) => /^precache: 11 files/.test(l))).toBe(true)

    const files = f.readdirSync(dir)
    expect(files.filter((n) => n.startsWith('sw-runtime.'))).toEqual([result.runtimeFile])
    expect(first.runtimeFile).toBe(result.runtimeFile) // deterministic output: same input, same worker
    const sw = f.readFileSync(result.swFile, 'utf8')
    expect(sw).toContain(`importScripts("${result.runtimeFile}")`)
    expect(sw).toContain('"/balligh/index.html"')
    expect(sw).toContain(String.raw`/^\/balligh\/(?:index\.html)?(?:\?.*)?$/`)
    expect(sw).toContain(`{url:"/balligh/_expo/static/js/web/entry-${HASH_A}.js",revision:null}`)
    expect(sw).toMatch(/\{url:"\/balligh\/index\.html",revision:"[0-9a-f]{32}"\}/)
    expect(sw).not.toContain('Unused')
    expect(sw).not.toContain('_sitemap')
    for (const name of Object.values(CACHES)) expect(sw).toContain(`"${name}"`)
    // no skipWaiting at start-up: the only call is the one Workbox makes on the page's SKIP_WAITING message
    expect(sw).toContain('"SKIP_WAITING"')
    expect(sw.match(/skipWaiting\(\)/g)).toHaveLength(1)

    // the runtime script runs on its own in a worker-like scope
    const listeners: string[] = []
    const scope = { caches: {}, addEventListener: (type: string) => listeners.push(type) } as unknown as SwScope
    const vm = (await import('node:vm' as string)) as { runInNewContext(code: string, context: object): unknown }
    vm.runInNewContext(f.readFileSync(`${dir}/${result.runtimeFile}`, 'utf8'), { self: scope })
    expect(typeof scope.__balligh?.cacheWillUpdate).toBe('function')
    expect(listeners.sort()).toEqual(['activate', 'fetch', 'message'])
    f.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses an export built for another base URL, and a missing export', async () => {
    const { buildServiceWorker } = await load()
    const f = await fs()
    const dir = await makeExport('')
    await expect(buildServiceWorker({ outDir: dir, base: '/balligh', log: () => {} })).rejects.toThrow(/another base URL/)
    expect(f.existsSync(`${dir}/sw.js`)).toBe(false)
    await expect(buildServiceWorker({ outDir: `${dir}/nope`, log: () => {} })).rejects.toThrow(/index\.html not found/)
    f.rmSync(dir, { recursive: true, force: true })
  })
})

describe('buildRuntimeScript', () => {
  it('bakes the config in and is content-addressed', async () => {
    const { buildRuntimeScript } = await load()
    const a = await buildRuntimeScript({ rules: [], prefix: 'balligh-sw-', caches: [], undatedCaches: [], storeKinds: ['audio'] })
    const b = await buildRuntimeScript({ rules: [], prefix: 'balligh-sw-', caches: ['x'], undatedCaches: [], storeKinds: ['audio'] })
    expect(a.file).toMatch(/^sw-runtime\.[0-9a-f]{10}\.js$/)
    expect(a.file).not.toBe(b.file)
    expect(a.code).not.toMatch(/\brequire\(/)
    expect(a.code).toContain('exports.install(self, {"rules":[]')
  })
})
