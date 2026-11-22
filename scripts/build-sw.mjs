#!/usr/bin/env node
// Service worker for the Expo web export (PWA, milestone M6 — research/00-gaps.md §2.14: Workbox over
// `npx expo export -p web`). Run it on the export directory, with the same base URL the export was built with:
//
//   npx expo export -p web && node scripts/build-sw.mjs                       (site root, ./dist)
//   BALLIGH_BASE_URL=/balligh node scripts/build-sw.mjs <exportDir>           (GitHub Pages sub-path)
//
// It checks index.html against BALLIGH_BASE_URL and the manifest against its icons, then writes <exportDir>/sw.js
// (Workbox generateSW, runtime inlined) and <exportDir>/sw-runtime.<hash>.js (src/pwa/sw-runtime.ts transpiled,
// imported by sw.js), and prints what is precached and how big it is.
//
// Precache = the app shell, so the app opens and exports offline: index.html; every JS chunk, the lazily loaded ones
// too — HarfBuzz (any Quran text), Mediabunny (every video export) and the AAC encoder (video export where the browser
// has no AAC encoder: Firefox, Chrome on Linux/ChromeOS, Safari 16.4–18; without it in the precache an offline export
// fails there for good); harfbuzz.wasm; the fonts index.html declares; the manifest, its icons, favicon.ico. Left
// out: Expo Router's _sitemap/+not-found pages and asset files index.html never references (the font packages bundle
// every weight; the app registers five) — a same-origin runtime cache keeps those if they are ever requested.
//
// Runtime caches, hosts from src/data/cache-policy.json:
// - audio hosts: CacheFirst, whole 200 responses only, fetched past the HTTP cache, stamped when stored and never
//   served or kept past 6 days — Quran Foundation hosts (QF Developer Terms: one week; 00-gaps §2.9, D9) and
//   EveryAyah / mp3quran too (terms unknown, so no longer). Range requests (chapter-file windows, 206) never touch
//   a cache (sw-runtime.ts).
// - fontsource files (the Noto font of each translation script) on jsDelivr / unpkg: CacheFirst, 365 days.
// - JSON and text APIs: not cached by the worker. src/data/http.ts keeps every response in Cache Storage under the same
//   policy (dated, capped, purged at start-up) and reads it before the network, offline included. A second copy here
//   would double the storage, and a stale-while-revalidate copy could hand data/ a days-old response that data/ then
//   dates as new — past the QF limit.
// Updates: no skipWaiting (src/pwa/register.web.ts asks the user first), clientsClaim (a first visit is controlled at
// once), cleanupOutdatedCaches, navigations to the app's root page (any deep-link query) → the precached index.html.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POLICY_FILE = join(ROOT, 'src/data/cache-policy.json')
const RUNTIME_SOURCE = join(ROOT, 'src/pwa/sw-runtime.ts')
const DAY_SECONDS = 86_400

/** QF Developer Terms: one week; Balligh keeps every Quran Foundation host ≤ 6 days (00-gaps §2.9). */
export const QF_MAX_DAYS = 6
/** Recitation audio of hosts whose terms are unknown (EveryAyah, mp3quran — 00-gaps U7) gets no longer either. */
export const AUDIO_MAX_DAYS = 6
/** fontsource URLs carry an exact package version: the files never change. */
export const FONT_MAX_DAYS = 365
export const CACHE_PREFIX = 'balligh-sw-'
export const CACHES = {
  audioQf: 'balligh-sw-audio-qf-v1',
  audio: 'balligh-sw-audio-v1',
  fonts: 'balligh-sw-fonts-v1',
  static: 'balligh-sw-static-v1',
}
/** Expo's content-hashed file names (chunks "-<32 hex>.js", assets ".<32 hex>.ttf"): the URL is the revision. */
export const HASHED_URL = /[.-][0-9a-f]{32}\.[a-z0-9]+$/
/** the largest precached file today is the AAC encoder chunk (1.5 MB); anything over this fails the build */
const MAX_PRECACHE_FILE_BYTES = 4 * 1024 * 1024
const FONTSOURCE_URL = /^https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@fontsource\//
const KINDS = ['json', 'audio', 'font', 'other']

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** "" (site root) or "/a/b": leading slash, no trailing slash. Throws on anything that is not a plain path. */
export function normalizeBase(raw = '') {
  let base = String(raw).trim()
  if (base === '' || base === '/') return ''
  if (!base.startsWith('/')) base = `/${base}`
  base = base.replace(/\/+$/, '')
  if (!/^(?:\/[A-Za-z0-9._~-]+)+$/.test(base)) throw new Error(`build-sw: BALLIGH_BASE_URL "${raw}" is not a path such as /balligh`)
  return base
}

/** How long the worker may keep a host's responses: the policy's maxAgeDays, capped for QF hosts and for audio. */
export function maxAgeDays(entry) {
  let days = entry.maxAgeDays
  if (entry.qf) days = Math.min(days, QF_MAX_DAYS)
  if (entry.kind === 'audio') days = Math.min(days, AUDIO_MAX_DAYS)
  return days
}

/** cache-policy.json → the rules sw-runtime.ts applies (every entry, file order, first match wins). */
export function swRules(policy) {
  if (!Array.isArray(policy) || policy.length === 0) throw new Error('build-sw: src/data/cache-policy.json must be a non-empty array')
  return policy.map((entry, i) => {
    const ok =
      entry &&
      typeof entry.match === 'string' &&
      /^(?:\*\.)?[a-z0-9.-]+$/.test(entry.match) &&
      KINDS.includes(entry.kind) &&
      typeof entry.qf === 'boolean' &&
      typeof entry.maxAgeDays === 'number' &&
      entry.maxAgeDays > 0
    if (!ok) throw new Error(`build-sw: cache-policy.json entry ${i} is malformed: ${JSON.stringify(entry)}`)
    return { match: entry.match, kind: entry.kind, qf: entry.qf, maxAgeMs: maxAgeDays(entry) * DAY_SECONDS * 1000 }
  })
}

/** Regular-expression source for one policy host: exact, or "*.suffix" = any subdomain of suffix. */
export function hostPatternSource(match) {
  return match.startsWith('*.') ? `[^/?#:@]+\\.${escapeRe(match.slice(2))}` : escapeRe(match)
}

export function hostsRegExp(matches) {
  return new RegExp(`^https?://(?:${matches.map(hostPatternSource).join('|')})(?::\\d+)?/`, 'i')
}

/**
 * The audio routes: QF hosts and the others in separate caches (00-gaps §2.9). The expiration age is a backstop;
 * sw-runtime.ts enforces each host's own limit from the stamp.
 */
export function audioRoutes(rules) {
  const audio = rules.filter((r) => r.kind === 'audio')
  return [
    { cacheName: CACHES.audioQf, rules: audio.filter((r) => r.qf) },
    { cacheName: CACHES.audio, rules: audio.filter((r) => !r.qf) },
  ]
    .filter((g) => g.rules.length > 0)
    .map((g) => ({
      cacheName: g.cacheName,
      urlPattern: hostsRegExp(g.rules.map((r) => r.match)),
      maxAgeSeconds: Math.max(...g.rules.map((r) => r.maxAgeMs)) / 1000,
    }))
}

/**
 * Plugin hooks generateSW serialises into sw.js (function source only — no closures): they call the runtime that
 * sw-runtime.<hash>.js installed on the worker's global object before Workbox started.
 */
const STAMP_PLUGIN = {
  cacheWillUpdate: (param) => globalThis.__balligh.cacheWillUpdate(param),
  cachedResponseWillBeUsed: (param) => globalThis.__balligh.cachedResponseWillBeUsed(param),
}

export function runtimeCaching(rules) {
  return [
    {
      urlPattern: FONTSOURCE_URL,
      handler: 'CacheFirst',
      options: {
        cacheName: CACHES.fonts,
        cacheableResponse: { statuses: [200] },
        // CJK fonts come in ~100 unicode-range shards; a page loads only the shards its text needs
        expiration: { maxEntries: 250, maxAgeSeconds: FONT_MAX_DAYS * DAY_SECONDS, purgeOnQuotaError: true },
      },
    },
    ...audioRoutes(rules).map((route) => ({
      urlPattern: route.urlPattern,
      handler: 'CacheFirst',
      options: {
        cacheName: route.cacheName,
        // past the browser's HTTP cache: the CDNs send max-age=25600000 (~296 days), so an HTTP-cache copy could
        // be months old and would enter this cache stamped as new. The stamped copy here is the only one kept.
        fetchOptions: { cache: 'no-store' },
        // option order = plugin order: refuse non-200 (opaque 0, partial 206) before stamping
        cacheableResponse: { statuses: [200] },
        plugins: [STAMP_PLUGIN],
        expiration: { maxEntries: 400, maxAgeSeconds: route.maxAgeSeconds, purgeOnQuotaError: true },
      },
    })),
    {
      // same-origin build files that are not precached (unused font weights, Expo Router's images): content-hashed
      urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(?:assets|_expo\/static)\//.test(url.pathname),
      handler: 'CacheFirst',
      options: {
        cacheName: CACHES.static,
        cacheableResponse: { statuses: [200] },
        expiration: { maxEntries: 60, maxAgeSeconds: 30 * DAY_SECONDS, purgeOnQuotaError: true },
      },
    },
  ]
}

/** Transpiles src/pwa/sw-runtime.ts into the classic script sw.js imports, with this build's config baked in. */
export async function buildRuntimeScript(config) {
  const ts = (await import('typescript')).default
  const out = ts.transpileModule(readFileSync(RUNTIME_SOURCE, 'utf8'), {
    fileName: 'sw-runtime.ts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, removeComments: true },
  })
  if (out.diagnostics?.length) {
    throw new Error(`build-sw: sw-runtime.ts: ${out.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`)
  }
  if (/\brequire\(/.test(out.outputText)) throw new Error('build-sw: src/pwa/sw-runtime.ts must not import anything at runtime (it runs alone in the worker)')
  const code =
    '// Balligh service-worker runtime, generated by scripts/build-sw.mjs from src/pwa/sw-runtime.ts. Do not edit.\n' +
    `(function (exports) {\n${out.outputText}\nexports.install(self, ${JSON.stringify(config)});\n})({});\n`
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 10)
  return { file: `sw-runtime.${hash}.js`, code }
}

function attributes(tag) {
  const attrs = {}
  for (const m of tag.matchAll(/([a-zA-Z-:]+)(?:="([^"]*)")?/g)) attrs[m[1].toLowerCase()] = m[2] ?? ''
  return attrs
}

/** index.html must load the Expo bundles from <base>/_expo/: the export and the worker must agree on the base URL. */
export function checkBase(html, base) {
  const srcs = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => attributes(m[0]).src).filter((s) => s && s.includes('/_expo/static/js/'))
  if (srcs.length === 0) throw new Error('build-sw: index.html loads no /_expo/static/js/ bundle — is this an `expo export -p web` directory?')
  const wrong = srcs.find((s) => !s.startsWith(`${base}/_expo/static/js/`))
  if (wrong) {
    throw new Error(
      `build-sw: index.html was exported for another base URL (it loads ${wrong}) but BALLIGH_BASE_URL is "${base}". ` +
        'Run the export and this script with the same BALLIGH_BASE_URL.',
    )
  }
}

/** Width and height of a PNG file, from its IHDR chunk; null if it is not a PNG. */
export function pngSize(file) {
  const b = readFileSync(file)
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/**
 * Installability checks done by hand (no Lighthouse here): index.html links <base>/manifest.webmanifest; the manifest
 * has a name, start_url and scope at the app's root, standalone display, a 192 and a 512 icon for "any" and a
 * maskable one; every icon file exists with the size it declares. Returns the manifest.
 */
export function checkManifest(outDir, html, base) {
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => attributes(m[0]))
  const link = links.find((a) => a.rel === 'manifest')
  if (!link) throw new Error('build-sw: index.html has no <link rel="manifest"> (src/app/+html.tsx)')
  const manifestUrl = new URL(link.href, `https://app.invalid${base}/`)
  if (manifestUrl.pathname !== `${base}/manifest.webmanifest`) throw new Error(`build-sw: the manifest link points at ${link.href}, not ${base}/manifest.webmanifest`)
  const file = join(outDir, 'manifest.webmanifest')
  if (!existsSync(file)) throw new Error('build-sw: manifest.webmanifest is missing from the export (public/manifest.webmanifest)')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`build-sw: manifest.webmanifest is not JSON: ${e instanceof Error ? e.message : e}`)
  }
  const problems = []
  if (!manifest.name || !manifest.short_name) problems.push('name and short_name are required')
  const appRoot = `${base}/`
  for (const key of ['start_url', 'scope']) {
    const path = manifest[key] === undefined ? null : new URL(manifest[key], manifestUrl).pathname
    if (path !== appRoot) problems.push(`${key} resolves to ${path}, not the app's root ${appRoot}`)
  }
  if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) problems.push(`display "${manifest.display}" is not installable as an app`)
  const icons = Array.isArray(manifest.icons) ? manifest.icons : []
  const purposes = (icon) => String(icon.purpose ?? 'any').split(/\s+/)
  for (const icon of icons) {
    const url = new URL(icon.src, manifestUrl)
    if (!url.pathname.startsWith(appRoot)) {
      problems.push(`icon ${icon.src} is outside the app`)
      continue
    }
    const iconFile = join(outDir, decodeURIComponent(url.pathname.slice(appRoot.length)))
    const size = existsSync(iconFile) ? pngSize(iconFile) : null
    if (!size) problems.push(`icon ${icon.src} is missing or not a PNG`)
    else if (icon.sizes !== `${size.width}x${size.height}`) problems.push(`icon ${icon.src} is ${size.width}x${size.height}, declared ${icon.sizes}`)
  }
  const has = (sizes, purpose) => icons.some((i) => i.sizes === sizes && purposes(i).includes(purpose))
  if (!has('192x192', 'any')) problems.push('no 192x192 icon for purpose "any"')
  if (!has('512x512', 'any')) problems.push('no 512x512 icon for purpose "any"')
  if (!icons.some((i) => purposes(i).includes('maskable'))) problems.push('no maskable icon')
  if (problems.length) throw new Error(`build-sw: manifest.webmanifest: ${problems.join('; ')}`)
  return manifest
}

/** Manifest transform: drops assets/** files index.html never references (they stay available at runtime). */
function keepReferencedAssets(html, base, dropped) {
  return (entries) => {
    const manifest = entries.filter((entry) => {
      const rel = entry.url.slice(base.length + 1)
      if (!rel.startsWith('assets/')) return true
      const used = html.includes(`/${rel}`) || html.includes(`/${encodeURI(rel)}`)
      if (!used) dropped.push(rel)
      return used
    })
    return { manifest, warnings: [] }
  }
}

/** Manifest transform: records what is precached, for the size report (sizes are dropped after the transforms). */
function recordEntries(base, into) {
  return (entries) => {
    for (const e of entries) into.push({ rel: e.url.slice(base.length + 1), url: e.url, size: e.size })
    return { manifest: entries, warnings: [] }
  }
}

/** The generateSW configuration for an export directory (exported for the tests). */
export function generateSwOptions({ outDir, base, html, rules, runtimeFile, precached = [], dropped = [] }) {
  return {
    globDirectory: outDir,
    swDest: join(outDir, 'sw.js'),
    globPatterns: ['**/*.{html,js,css,wasm,ttf,otf,woff,woff2,png,ico,svg,webmanifest}'],
    globIgnores: ['_sitemap.html', '+not-found.html', '404.html', '**/*.map', 'sw-runtime.*.js', 'workbox-*.js'],
    modifyURLPrefix: { '': `${base}/` },
    dontCacheBustURLsMatching: HASHED_URL,
    maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
    manifestTransforms: [keepReferencedAssets(html, base, dropped), recordEntries(base, precached)],
    cacheId: 'balligh',
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    // the app is one page; deep links only add a query (?v=1&s=…). Other paths go to the network (404 page).
    navigateFallback: `${base}/index.html`,
    navigateFallbackAllowlist: [new RegExp(`^${escapeRe(base)}/(?:index\\.html)?(?:\\?.*)?$`)],
    importScripts: [runtimeFile],
    inlineWorkboxRuntime: true,
    sourcemap: false,
    mode: 'production',
    runtimeCaching: runtimeCaching(rules),
  }
}

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`
const mib = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`

/** Builds the service worker for an export directory. Returns what it wrote and what is precached. */
export async function buildServiceWorker({ outDir, base = '', log = console.log }) {
  base = normalizeBase(base)
  const index = join(outDir, 'index.html')
  if (!existsSync(index)) throw new Error(`build-sw: ${index} not found — run \`npx expo export -p web\` first`)
  const html = readFileSync(index, 'utf8')
  checkBase(html, base)
  checkManifest(outDir, html, base)
  // outputs of an earlier run over the same directory
  for (const f of readdirSync(outDir)) {
    if (/^(?:sw\.js(?:\.map)?|sw-runtime\.[0-9a-f]+\.js|workbox-[0-9a-f]+\.js(?:\.map)?)$/.test(f)) rmSync(join(outDir, f))
  }

  const rules = swRules(JSON.parse(readFileSync(POLICY_FILE, 'utf8')))
  const runtime = await buildRuntimeScript({
    rules,
    prefix: CACHE_PREFIX,
    caches: Object.values(CACHES),
    undatedCaches: [CACHES.fonts, CACHES.static],
    storeKinds: ['audio'],
  })
  writeFileSync(join(outDir, runtime.file), runtime.code)

  const precached = []
  const dropped = []
  const { generateSW } = await import('workbox-build')
  const result = await generateSW(generateSwOptions({ outDir, base, html, rules, runtimeFile: runtime.file, precached, dropped }))
  const tooBig = result.warnings.filter((w) => /won't be precached/.test(w))
  if (tooBig.length) throw new Error(`build-sw: files too large to precache:\n${tooBig.join('\n')}`)
  for (const w of result.warnings) log(`warning: ${w}`)

  let gzipTotal = 0
  const rows = precached.map((e) => {
    const gz = gzipSync(readFileSync(join(outDir, e.rel)), { level: 9 }).length
    gzipTotal += gz
    return { ...e, gz }
  })
  rows.sort((a, b) => b.size - a.size)
  const swBytes = statSync(join(outDir, 'sw.js')).size
  log(`service worker: ${join(outDir, 'sw.js')} (${kib(swBytes)}) + ${runtime.file} (${kib(runtime.code.length)}), scope ${base}/`)
  log(`precache: ${result.count} files, ${mib(result.size)} (gzip ${mib(gzipTotal)})`)
  for (const r of rows.slice(0, 12)) log(`  ${kib(r.size).padStart(11)}  gzip ${kib(r.gz).padStart(10)}  ${r.rel}`)
  if (rows.length > 12) log(`  … ${rows.length - 12} smaller files`)
  log(`not precached (fetched and kept on demand): ${dropped.length} unreferenced asset files; _sitemap.html and +not-found.html`)
  log(
    `runtime caches: ${CACHES.fonts} (fontsource, ${FONT_MAX_DAYS} d) · ` +
      audioRoutes(rules)
        .map((r) => `${r.cacheName} (${r.maxAgeSeconds / DAY_SECONDS} d)`)
        .join(' · ') +
      ` · ${CACHES.static} (same-origin, 30 d) · JSON APIs: none (data/ caches them)`,
  )
  return { ...result, base, swFile: join(outDir, 'sw.js'), runtimeFile: runtime.file, precached: rows, dropped, gzipTotal }
}

async function main() {
  const outDir = resolve(process.argv[2] ?? 'dist')
  await buildServiceWorker({ outDir, base: process.env.BALLIGH_BASE_URL ?? '' })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
