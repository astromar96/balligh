#!/usr/bin/env node
// Draws the PWA icons (public/icons/*.png) on a canvas in headless Chrome: the app name «بلّغ» in Reem Kufi
// (the display face of the design brief, OFL) in page cream on malachite, with the gold-leaf selection band under
// it — the band the app draws behind selected words (PLAN.md "Design brief"). No dependencies: Chrome is driven
// over the DevTools protocol with Node's built-in WebSocket (Node ≥ 22).
//
// Usage: node scripts/make-icons.mjs [outDir=public/icons]      CHROME_PATH=… picks the browser binary.
// Output: icon-192.png and icon-512.png (purpose "any": rounded tile, transparent corners), icon-maskable-512.png
// (full bleed, everything inside the 80 % safe circle) and apple-touch-icon.png (180 px, full bleed: iOS masks it);
// plus assets/favicon.png (app.json web.favicon), from which `expo export` makes favicon.ico (16, 32, 48 px), and the
// native app's icons named in app.json (assets/icon.png, android-icon-foreground.png, android-icon-monochrome.png,
// splash-icon.png).
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { crc32, deflateSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONT = join(ROOT, 'node_modules/@expo-google-fonts/reem-kufi/700Bold/ReemKufi_700Bold.ttf')
const WORD = 'بلّغ'
/** PLAN.md palette */
const PALETTE = { malachite: '#1D6B57', page: '#FBF8F0', gold: '#C29A3E' }

/**
 * shape: "tile" = rounded square with transparent corners (purpose any); "full" = full-bleed square; "none" = the
 * mark alone on a transparent canvas.
 * box: [width, height] of the mark (word + band) as fractions of the icon size.
 * band, gap: the gold band's height and its distance below the word, as fractions of the icon size (default 0.05, 0.055).
 * dir: written there (relative to the repo root) instead of the output folder.
 * mono: one colour for the word and the band (Android's themed icon, which the system tints).
 * opaque: written without an alpha channel (the App Store refuses an iOS app icon that has one).
 */
export const ICONS = [
  { file: 'icon-192.png', size: 192, shape: 'tile', box: [0.62, 0.7] },
  { file: 'icon-512.png', size: 512, shape: 'tile', box: [0.62, 0.7] },
  // maskable: a launcher may crop to a circle of radius 0.4 × size; the box's corners stay inside it (0.355)
  { file: 'icon-maskable-512.png', size: 512, shape: 'full', box: [0.46, 0.54] },
  { file: 'apple-touch-icon.png', size: 180, shape: 'full', box: [0.56, 0.64] },
  // the browser tab shows it at 16-32 px: a bigger mark and a thicker band; 96 px so 48, 32 and 16 are whole divisions
  { file: 'favicon.png', size: 96, shape: 'tile', box: [0.8, 0.84], band: 0.085, gap: 0.06, dir: 'assets' },
  // the native app (app.json). iOS masks the full-bleed icon itself. Android's adaptive icon is a 108 dp canvas whose
  // safe zone is a 66 dp circle (radius 0.306): the box's corners stay inside it; its background is app.json's
  // adaptiveIcon.backgroundColor (malachite). The splash image is a tile, so it shows on any splash colour.
  { file: 'icon.png', size: 1024, shape: 'full', box: [0.56, 0.64], dir: 'assets', opaque: true },
  { file: 'android-icon-foreground.png', size: 1024, shape: 'none', box: [0.39, 0.46], dir: 'assets' },
  { file: 'android-icon-monochrome.png', size: 1024, shape: 'none', box: [0.39, 0.46], dir: 'assets', mono: '#FFFFFF' },
  { file: 'splash-icon.png', size: 1024, shape: 'tile', box: [0.62, 0.7], dir: 'assets' },
]

/** Runs in the page: loads the font, draws every icon, returns { file: data URL }. Self-contained. */
async function drawIcons(fontBase64, palette, specs, word) {
  const bytes = Uint8Array.from(atob(fontBase64), (c) => c.charCodeAt(0))
  const face = new FontFace('BallighMark', bytes.buffer, { weight: '700' })
  await face.load()
  document.fonts.add(face)
  const setFont = (ctx, px) => {
    ctx.font = `700 ${px}px BallighMark`
    ctx.direction = 'rtl'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
  }
  const out = {}
  for (const spec of specs) {
    const S = spec.size
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = palette.malachite
    if (spec.shape === 'tile') {
      ctx.beginPath()
      ctx.roundRect(0, 0, S, S, S * 0.22)
      ctx.fill()
    } else if (spec.shape === 'full') {
      ctx.fillRect(0, 0, S, S)
    }
    // the band under the word: by default 5 % of the icon high, 5.5 % below the word's lowest ink
    const bandH = (spec.band ?? 0.05) * S
    const gap = (spec.gap ?? 0.055) * S
    setFont(ctx, 100)
    const probe = ctx.measureText(word)
    const probeW = probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight
    const probeH = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent
    const scale = Math.min((spec.box[0] * S) / probeW, (spec.box[1] * S - bandH - gap) / probeH)
    setFont(ctx, 100 * scale)
    const m = ctx.measureText(word)
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
    const top = (S - (h + gap + bandH)) / 2
    // centre the ink box (not the advance box): with textAlign center the ink spans x - left … x + right
    const x = S / 2 + (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2
    ctx.fillStyle = spec.mono ?? palette.page
    ctx.fillText(word, x, top + m.actualBoundingBoxAscent)
    const bandW = w * 0.92
    ctx.fillStyle = spec.mono ?? palette.gold
    ctx.beginPath()
    ctx.roundRect((S - bandW) / 2, top + h + gap, bandW, bandH, bandH / 2)
    ctx.fill()
    if (spec.opaque) {
      // the pixels without their alpha (all opaque here), base64: Node writes the PNG (encodeRgbPng)
      const px = ctx.getImageData(0, 0, S, S).data
      const rgb = new Uint8Array(S * S * 3)
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        rgb[j] = px[i]
        rgb[j + 1] = px[i + 1]
        rgb[j + 2] = px[i + 2]
      }
      let bin = ''
      for (let i = 0; i < rgb.length; i += 0x8000) bin += String.fromCharCode.apply(null, rgb.subarray(i, i + 0x8000))
      out[spec.file] = { rgb: btoa(bin), size: S }
    } else {
      out[spec.file] = canvas.toDataURL('image/png')
    }
  }
  return out
}

/** A PNG without an alpha channel (colour type 2, 8 bits, no filtering) from width × height × 3 bytes. */
function encodeRgbPng(width, height, rgb) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height) // each row starts with filter type 0 (none)
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour, no alpha
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('make-icons: no Chrome found; set CHROME_PATH')
  return found
}

function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'balligh-icons-'))
  const proc = spawn(
    chromePath(),
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  const exited = new Promise((resolveExit) => proc.once('exit', resolveExit))
  const endpoint = new Promise((resolveEndpoint, reject) => {
    let log = ''
    const timer = setTimeout(() => reject(new Error('make-icons: Chrome did not start within 30 s')), 30_000)
    proc.stderr.on('data', (chunk) => {
      log += chunk
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log)
      if (m) {
        clearTimeout(timer)
        resolveEndpoint(m[1])
      }
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`make-icons: Chrome exited (${code}) before it listened`))
    })
  })
  return { proc, profile, endpoint, exited }
}

/** Minimal DevTools-protocol client over one WebSocket (flat sessions). */
function connect(url) {
  return new Promise((resolveClient, reject) => {
    const ws = new WebSocket(url)
    let next = 0
    const pending = new Map()
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data))
      const waiter = msg.id ? pending.get(msg.id) : undefined
      if (!waiter) return
      pending.delete(msg.id)
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`))
      else waiter.resolve(msg.result)
    }
    ws.onerror = () => reject(new Error(`make-icons: cannot connect to ${url}`))
    ws.onopen = () =>
      resolveClient({
        send(method, params = {}, sessionId) {
          const id = ++next
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej, method }))
        },
        close: () => ws.close(),
      })
  })
}

export async function makeIcons(outDir = join(ROOT, 'public/icons')) {
  const font = readFileSync(FONT).toString('base64')
  const chrome = launchChrome()
  let cdp = null
  try {
    cdp = await connect(await chrome.endpoint)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const expression = `(${drawIcons.toString()})(${JSON.stringify(font)}, ${JSON.stringify(PALETTE)}, ${JSON.stringify(ICONS)}, ${JSON.stringify(WORD)})`
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (exceptionDetails) throw new Error(`make-icons: drawing failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
    for (const [file, value] of Object.entries(result.value)) {
      const spec = ICONS.find((i) => i.file === file)
      const dir = spec?.dir ? join(ROOT, spec.dir) : outDir
      mkdirSync(dir, { recursive: true })
      const png =
        typeof value === 'string'
          ? Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
          : encodeRgbPng(value.size, value.size, Buffer.from(value.rgb, 'base64'))
      writeFileSync(join(dir, file), png)
      console.log(`${join(dir, file)}  ${png.length} B`)
    }
    await cdp.send('Browser.close').catch(() => {})
  } finally {
    cdp?.close()
    if (chrome.proc.exitCode === null) chrome.proc.kill()
    // Chrome writes to its profile until it exits: wait for that before deleting the profile
    await Promise.race([chrome.exited, new Promise((r) => setTimeout(r, 5000))])
    rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  makeIcons(process.argv[2] ? resolve(process.argv[2]) : undefined).catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
