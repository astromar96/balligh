// Video lab: proves the core pipeline end to end in the browser.
// per-ayah MP3 (CORS) -> decodeAudioData -> cut by word segments -> HarfBuzz text frames
// with the current word highlighted -> Mediabunny (WebCodecs) -> MP4 in memory.
import * as hb from 'harfbuzzjs'
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeAudio, canEncodeVideo } from 'mediabunny'

const logEl = document.getElementById('log')!
const log = (s: string) => { logEl.textContent += s + '\n'; console.log(s) }
const W = 720, H = 1280, FPS = 30, SR = 48000
const AUDIO_BASE = 'https://verses.quran.com/'

type Seg = [number, number, number, number] // [index, wordPosition(1-based), startMs, endMs]
type Piece = { key: string; words: string[]; positions: number[]; url: string; segs: Seg[]; fromWord: number; toWord: number; whole: boolean }

async function fetchVerse(key: string) {
  const r = await fetch(`https://api.quran.com/api/v4/verses/by_key/${key}?words=true&word_fields=text_uthmani&audio=7`)
  const v = (await r.json()).verse
  const words = v.words.filter((w: { char_type_name: string }) => w.char_type_name === 'word')
  return { words: words.map((w: { text_uthmani: string }) => w.text_uthmani), positions: words.map((w: { position: number }) => w.position), url: AUDIO_BASE + v.audio.url, segs: v.audio.segments as Seg[] }
}

async function decode(url: string) {
  const buf = await (await fetch(url)).arrayBuffer()
  return await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf)
}

async function main() {
  const t0 = performance.now()
  log(`canEncode avc=${await canEncodeVideo('avc', { width: W, height: H })} aac=${await canEncodeAudio('aac', { numberOfChannels: 1, sampleRate: SR })} opus=${await canEncodeAudio('opus')}`)
  // selection: 1:2 (whole) .. 1:4 words 1-2 (partial)
  const sel: Array<[string, number, number | null]> = [['1:2', 1, null], ['1:3', 1, null], ['1:4', 1, 2]]
  const pieces: Piece[] = []
  for (const [key, from, to] of sel) {
    const v = await fetchVerse(key)
    pieces.push({ key, ...v, fromWord: from, toWord: to ?? v.words.length, whole: to === null })
  }
  log('segments 1:4 ' + JSON.stringify(pieces[2].segs))

  // --- audio: cut + concatenate with 15 ms fades at cut points
  const PAD_MS = 120, FADE = Math.round(0.015 * SR)
  const chunks: Float32Array[] = []
  const wordTimes: Array<{ piece: number; word: number; start: number; end: number }> = []
  let cursor = 0 // samples written so far
  for (const [pi, p] of pieces.entries()) {
    const ab = await decode(p.url)
    const data = ab.getChannelData(0)
    const segOf = (pos: number) => p.segs.find(s => s[1] === pos)!
    const srcStart = p.whole || p.fromWord === 1 ? 0 : Math.max(0, segOf(p.fromWord)[2] - PAD_MS)
    const srcEndMs = p.whole || p.toWord === p.words.length ? ab.duration * 1000 : segOf(p.toWord)[3] + PAD_MS
    const a = Math.round(srcStart / 1000 * SR), b = Math.min(data.length, Math.round(srcEndMs / 1000 * SR))
    const cut = data.slice(a, b)
    if (!p.whole) { // fade only where we cut inside the ayah
      if (a > 0) for (let i = 0; i < FADE && i < cut.length; i++) cut[i] *= i / FADE
      if (b < data.length) for (let i = 0; i < FADE && i < cut.length; i++) cut[cut.length - 1 - i] *= i / FADE
    }
    for (let w = p.fromWord; w <= p.toWord; w++) {
      const s = segOf(w)
      wordTimes.push({ piece: pi, word: w, start: (cursor + (s[2] - srcStart) / 1000 * SR) / SR, end: (cursor + (s[3] - srcStart) / 1000 * SR) / SR })
    }
    chunks.push(cut); cursor += cut.length
    log(`${p.key}: file ${ab.duration.toFixed(2)}s sr=${ab.sampleRate} ch=${ab.numberOfChannels} cut ${srcStart}-${Math.round(srcEndMs)}ms`)
  }
  const out = new AudioBuffer({ length: cursor, numberOfChannels: 1, sampleRate: SR })
  let off = 0
  for (const c of chunks) { out.copyToChannel(c as Float32Array<ArrayBuffer>, 0, off); off += c.length }
  const duration = cursor / SR
  log(`audio total ${duration.toFixed(2)}s, words ${wordTimes.length}`)

  // --- text: HarfBuzz shaping per word, greedy RTL line breaking
  const fontData = await (await fetch('/fonts/AmiriQuran-Regular.ttf')).arrayBuffer()
  const face = new hb.Face(new hb.Blob(fontData)); const font = new hb.Font(face)
  const PX = 64, scale = PX / face.upem
  const cache = new Map<number, Path2D>()
  const glyphPath = (g: number) => cache.get(g) ?? (cache.set(g, new Path2D(font.glyphToPath(g))), cache.get(g)!)
  const shapeWord = (text: string) => {
    const buf = new hb.Buffer(); buf.addText(text)
    buf.setDirection(hb.Direction.RTL); buf.setScript('Arab'); buf.setLanguage('ar')
    hb.shape(font, buf)
    const gl = buf.getGlyphInfosAndPositions()
    return { gl, width: gl.reduce((s, g) => s + (g.xAdvance ?? 0), 0) * scale }
  }
  const allWords = pieces.flatMap((p, pi) => p.words.slice(p.fromWord - 1, p.toWord).map((t, i) => ({ t, pi, w: p.fromWord + i })))
  const shaped = allWords.map(w => ({ ...w, ...shapeWord(w.t) }))
  const space = shapeWord(' ').width * 1.4, maxW = W - 120
  const lines: Array<typeof shaped> = [[]]
  let lw = 0
  for (const s of shaped) {
    if (lines.at(-1)!.length && lw + space + s.width > maxW) { lines.push([]); lw = 0 }
    lw += (lines.at(-1)!.length ? space : 0) + s.width; lines.at(-1)!.push(s)
  }
  const lineH = PX * 2.1, top = H / 2 - (lines.length * lineH) / 2 + PX

  const canvas = document.getElementById('c') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  const draw = (t: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0f2742'); g.addColorStop(1, '#06121f')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const active = wordTimes.find(w => t >= w.start && t < w.end)
    lines.forEach((line, li) => {
      const total = line.reduce((s, w) => s + w.width, 0) + space * (line.length - 1)
      let x = W / 2 + total / 2 // RTL: start from the right edge of the centred line
      const y = top + li * lineH
      for (const w of line) {
        x -= w.width
        const on = active && active.piece === w.pi && active.word === w.w
        ctx.fillStyle = on ? '#e9c46a' : '#f5f1e6'
        let gx = x
        for (const gi of w.gl) {
          ctx.save(); ctx.translate(gx + (gi.xOffset ?? 0) * scale, y - (gi.yOffset ?? 0) * scale); ctx.scale(scale, -scale)
          ctx.fill(glyphPath(gi.codepoint)); ctx.restore()
          gx += (gi.xAdvance ?? 0) * scale
        }
        x -= space
      }
    })
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.direction = 'rtl'
    ctx.fillText('سورة الفاتحة · مشاري العفاسي', W / 2, H - 80)
  }

  // --- encode
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 2 })
  const audio = new AudioBufferSource({ codec: 'aac', bitrate: QUALITY_HIGH })
  output.addVideoTrack(video, { frameRate: FPS })
  output.addAudioTrack(audio)
  await output.start()
  const tEnc = performance.now()
  const frames = Math.ceil(duration * FPS)
  for (let i = 0; i < frames; i++) { draw(i / FPS); await video.add(i / FPS, 1 / FPS) }
  await audio.add(out)
  await output.finalize()
  const bytes = new Uint8Array((output.target as BufferTarget).buffer!)
  log(`encoded ${frames} frames in ${((performance.now() - tEnc) / 1000).toFixed(2)}s; mp4 ${(bytes.length / 1024).toFixed(0)} KB; total ${((performance.now() - t0) / 1000).toFixed(2)}s`)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  ;(window as unknown as { __mp4: string; __words: unknown }).__mp4 = btoa(bin)
  ;(window as unknown as { __words: unknown }).__words = wordTimes
  log('DONE')
}
main().catch(e => { log('ERROR ' + (e?.stack ?? e)); (window as unknown as { __mp4: string }).__mp4 = 'ERROR' })
