// Rendering lab: compares four ways of drawing tajweed-coloured Uthmani text.
// A: plain fillText (baseline) · B: one fillText per run with ZWJ at joins
// C: full-line redraw clipped to each run · D: HarfBuzz-shaped glyph outlines
// E: DOM spans. Not shipped; used to pick the renderer.
import * as hb from 'harfbuzzjs'

const ZWJ = '‍'
const COLORS: Record<string, string> = {
  ham_wasl: '#AAAAAA', laam_shamsiyah: '#AAAAAA', slnt: '#AAAAAA',
  madda_normal: '#537FFF', madda_permissible: '#4050FF', madda_necessary: '#000EBC', madda_obligatory: '#2144C1',
  qalaqah: '#DD0008', ikhafa: '#9400A8', ikhafa_shafawi: '#D500B7', idgham_ghunnah: '#169777',
  idgham_wo_ghunnah: '#169200', idgham_shafawi: '#58B800', idgham_mutajanisayn: '#A1A1A1',
  idgham_mutaqaribayn: '#A1A1A1', iqlab: '#26BFFD', ghunnah: '#FF7E1E',
}
const log = (s: string) => { document.getElementById('log')!.textContent += s + '\n' }
const out = document.getElementById('out')!

type Run = { text: string; cls: string | null }

function parseTajweed(html: string): Run[] {
  const runs: Run[] = []
  const re = /<tajweed class=([a-z_]+)>(.*?)<\/tajweed>|<span class=end>.*?<\/span>|([^<]+)/g
  for (const m of html.matchAll(re)) {
    if (m[1]) runs.push({ text: m[2], cls: m[1] })
    else if (m[3]) runs.push({ text: m[3], cls: null })
  }
  // trim trailing whitespace left by the stripped ayah-end span
  const last = runs[runs.length - 1]
  if (last && last.cls === null) last.text = last.text.replace(/\s+$/, '')
  return runs
}

function mkCanvas(title: string, w: number, h: number) {
  const h2 = document.createElement('h2'); h2.textContent = title; out.append(h2)
  const c = document.createElement('canvas'); c.width = w; c.height = h; out.append(c)
  const ctx = c.getContext('2d')!
  return ctx
}

const FONT_PX = 44
const FONT = `${FONT_PX}px "Amiri Quran"`

function drawA(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.font = FONT; ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillStyle = '#222'
  ctx.fillText(text, ctx.canvas.width - 16, y)
}

function drawB(ctx: CanvasRenderingContext2D, runs: Run[], y: number) {
  ctx.font = FONT; ctx.direction = 'rtl'; ctx.textAlign = 'right'
  let x = ctx.canvas.width - 16
  runs.forEach((r, i) => {
    const prev = runs[i - 1], next = runs[i + 1]
    const joinBefore = prev && !/\s$/.test(prev.text) && !/^\s/.test(r.text)
    const joinAfter = next && !/\s$/.test(r.text) && !/^\s/.test(next.text)
    const s = (joinBefore ? ZWJ : '') + r.text + (joinAfter ? ZWJ : '')
    ctx.fillStyle = r.cls ? COLORS[r.cls] ?? '#f0f' : '#222'
    ctx.fillText(s, x, y)
    x -= ctx.measureText(s).width
  })
}

function drawC(ctx: CanvasRenderingContext2D, runs: Run[], y: number) {
  ctx.font = FONT; ctx.direction = 'rtl'; ctx.textAlign = 'right'
  const full = runs.map(r => r.text).join('')
  const right = ctx.canvas.width - 16
  ctx.fillStyle = '#222'; ctx.fillText(full, right, y)
  let prefix = ''
  for (const r of runs) {
    const start = prefix
    prefix += r.text
    if (!r.cls) continue
    const w1 = start ? ctx.measureText(start + ZWJ).width : 0
    const w2 = ctx.measureText(prefix + ZWJ).width
    ctx.save()
    ctx.beginPath(); ctx.rect(right - w2, y - FONT_PX * 1.6, w2 - w1, FONT_PX * 2.6); ctx.clip()
    ctx.fillStyle = COLORS[r.cls] ?? '#f0f'; ctx.fillText(full, right, y)
    ctx.restore()
  }
}

type Shaped = { gid: number; cluster: number; xAdvance: number; xOffset: number; yOffset: number }

async function makeHb() {
  const data = await (await fetch('/fonts/AmiriQuran-Regular.ttf')).arrayBuffer()
  const face = new hb.Face(new hb.Blob(data))
  const font = new hb.Font(face)
  const upem = face.upem
  const pathCache = new Map<number, Path2D>()
  const path = (gid: number) => {
    let p = pathCache.get(gid)
    if (!p) { p = new Path2D(font.glyphToPath(gid)); pathCache.set(gid, p) }
    return p
  }
  const shape = (text: string): Shaped[] => {
    const buf = new hb.Buffer()
    buf.addText(text)
    buf.setDirection(hb.Direction.RTL); buf.setScript('Arab'); buf.setLanguage('ar')
    buf.setClusterLevel(hb.ClusterLevel.MONOTONE_CHARACTERS)
    hb.shape(font, buf)
    return buf.getGlyphInfosAndPositions().map(g => ({
      gid: g.codepoint, cluster: g.cluster, xAdvance: g.xAdvance ?? 0, xOffset: g.xOffset ?? 0, yOffset: g.yOffset ?? 0,
    }))
  }
  return { upem, shape, path }
}

function drawD(ctx: CanvasRenderingContext2D, H: Awaited<ReturnType<typeof makeHb>>, runs: Run[], y: number) {
  const full = runs.map(r => r.text).join('')
  // char index -> colour
  const colorAt: string[] = []
  for (const r of runs) for (let i = 0; i < r.text.length; i++) colorAt.push(r.cls ? COLORS[r.cls] ?? '#f0f' : '#222')
  const glyphs = H.shape(full)
  const scale = FONT_PX / H.upem
  const width = glyphs.reduce((s, g) => s + g.xAdvance, 0) * scale
  let x = ctx.canvas.width - 16 - width // glyphs come out in visual (left→right) order
  for (const g of glyphs) {
    ctx.save()
    ctx.translate(x + g.xOffset * scale, y - g.yOffset * scale)
    ctx.scale(scale, -scale)
    ctx.fillStyle = colorAt[g.cluster] ?? '#222'
    ctx.fill(H.path(g.gid))
    ctx.restore()
    x += g.xAdvance * scale
  }
  // word boxes from clusters (spaces delimit words)
  return { width }
}

async function main() {
  await document.fonts.load(FONT, 'بسم')
  const keys = ['1:2', '1:7', '2:255', '4:43', '112:1']
  const res = await fetch(`https://api.quran.com/api/v4/verses/by_key/2:255?fields=text_uthmani,text_uthmani_tajweed`)
  void res
  const H = await makeHb()
  for (const key of keys) {
    const j = await (await fetch(`https://api.quran.com/api/v4/verses/by_key/${key}?fields=text_uthmani,text_uthmani_tajweed`)).json()
    const v = j.verse
    // take the first ~7 words so a line fits
    const words = (v.text_uthmani as string).split(' ')
    const take = Math.min(words.length, 7)
    const runsAll = parseTajweed(v.text_uthmani_tajweed)
    // cut runs to the same first `take` words
    const runs: Run[] = []
    let spaces = 0
    for (const r of runsAll) {
      if (spaces >= take) break
      let t = ''
      for (const ch of r.text) {
        if (ch === ' ') { spaces++; if (spaces >= take) break }
        t += ch
      }
      if (t) runs.push({ text: t, cls: r.cls })
    }
    const plain = runs.map(r => r.text).join('')
    log(`${key}: plain==uthmani-prefix ${plain === words.slice(0, take).join(' ')}; runs=${runs.length}`)
    const W = 1100, Hh = 130
    drawA(mkCanvas(`${key} · A plain fillText`, W, Hh), plain, 85)
    drawB(mkCanvas(`${key} · B per-run fillText + ZWJ`, W, Hh), runs, 85)
    drawC(mkCanvas(`${key} · C full-line redraw clipped per run`, W, Hh), runs, 85)
    drawD(mkCanvas(`${key} · D HarfBuzz glyph outlines`, W, Hh), H, runs, 85)
    const h2 = document.createElement('h2'); h2.textContent = `${key} · E DOM spans`; out.append(h2)
    const d = document.createElement('div'); d.className = 'dom'
    for (const r of runs) {
      const s = document.createElement('span'); s.textContent = r.text
      if (r.cls) s.style.color = COLORS[r.cls] ?? '#f0f'
      d.append(s)
    }
    out.append(d)
  }
  log('done')
}
main().catch(e => log('ERROR ' + (e?.stack ?? e)))
