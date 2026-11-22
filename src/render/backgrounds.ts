// Background presets (procedural, deterministic, no people/animals/unseen — research/features.md §2.2/§3.3)
// and the user-image background (cover fit around a focal point + blur by downscale/upscale through
// Surfaces; ctx.filter is not used because Safari has none — media-pipeline.md §9.4).
import type { Graphics, ImageHandle, Paint, Painter } from '../core/types'
import type { BackgroundPreset } from './index'
import { circle, cornerOrnament, diamond, insetRect, khatam, starLattice } from './geometry'
import { clamp, fmt, seededRandom } from './util'

const unit = (w: number, h: number) => Math.min(w, h) / 1080

function vignette(p: Painter, w: number, h: number, strength: number, color = '3,8,18') {
  p.fillRect(0, 0, w, h, {
    type: 'radial',
    cx: w / 2,
    cy: h / 2,
    r: Math.hypot(w, h) / 2,
    stops: [
      { offset: 0.55, color: `rgba(${color},0)` },
      { offset: 1, color: `rgba(${color},${strength})` },
    ],
  })
}

/** Many tiny squares as one path (paper grain, sand) — deterministic. */
function speckles(g: Graphics, w: number, h: number, count: number, size: number, seed: number): ReturnType<Graphics['makePath']> {
  const rnd = seededRandom(seed)
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const s = size * (0.5 + rnd())
    parts.push(`M${fmt(x)} ${fmt(y)}h${fmt(s)}v${fmt(s)}h${fmt(-s)}Z`)
  }
  return g.makePath(parts.join(''))
}

function drawLapisNight(p: Painter, g: Graphics, w: number, h: number) {
  const u = unit(w, h)
  p.fillRect(0, 0, w, h, {
    type: 'linear',
    x0: 0,
    y0: 0,
    x1: 0,
    y1: h,
    stops: [
      { offset: 0, color: '#0A1630' },
      { offset: 0.5, color: '#12284B' },
      { offset: 1, color: '#09142A' },
    ],
  })
  p.fillRect(0, 0, w, h, {
    type: 'radial',
    cx: w / 2,
    cy: h * 0.42,
    r: Math.max(w, h) * 0.6,
    stops: [
      { offset: 0, color: 'rgba(76,116,186,0.22)' },
      { offset: 1, color: 'rgba(76,116,186,0)' },
    ],
  })
  p.strokePath(g.makePath(starLattice(w, h, 156 * u)), 'rgba(214,184,112,0.085)', 1.6 * u)
  vignette(p, w, h, 0.5)
}

function gildedFrame(p: Painter, g: Graphics, w: number, h: number, gold: string) {
  const u = unit(w, h)
  const m = 34 * u
  p.strokePath(g.makePath(insetRect(w, h, m)), gold, 3 * u)
  p.strokePath(g.makePath(insetRect(w, h, m + 11 * u)), gold, 1.2 * u)
  const stars: string[] = []
  for (const [x, y] of [
    [m, m],
    [w - m, m],
    [m, h - m],
    [w - m, h - m],
  ]) {
    stars.push(khatam(x, y, 15 * u, Math.PI / 8))
  }
  for (const [x, y] of [
    [w / 2, m],
    [w / 2, h - m],
    [m, h / 2],
    [w - m, h / 2],
  ]) {
    stars.push(diamond(x, y, 9 * u))
  }
  p.fillPath(g.makePath(stars.join('')), gold)
}

function drawMalachite(p: Painter, g: Graphics, w: number, h: number) {
  p.fillRect(0, 0, w, h, {
    type: 'linear',
    x0: 0,
    y0: 0,
    x1: w * 0.3,
    y1: h,
    stops: [
      { offset: 0, color: '#0C362D' },
      { offset: 0.5, color: '#145A49' },
      { offset: 1, color: '#0A2D25' },
    ],
  })
  p.fillRect(0, 0, w, h, {
    type: 'radial',
    cx: w / 2,
    cy: h * 0.3,
    r: Math.max(w, h) * 0.55,
    stops: [
      { offset: 0, color: 'rgba(130,210,175,0.13)' },
      { offset: 1, color: 'rgba(130,210,175,0)' },
    ],
  })
  vignette(p, w, h, 0.45, '2,14,10')
  gildedFrame(p, g, w, h, '#C9A44C')
}

function drawMushafPaper(p: Painter, g: Graphics, w: number, h: number) {
  const u = unit(w, h)
  p.fillRect(0, 0, w, h, '#F4ECDA')
  p.fillRect(0, 0, w, h, {
    type: 'radial',
    cx: w / 2,
    cy: h / 2,
    r: Math.hypot(w, h) / 2,
    stops: [
      { offset: 0, color: 'rgba(253,250,243,0.9)' },
      { offset: 0.6, color: 'rgba(250,245,233,0.45)' },
      { offset: 1, color: 'rgba(226,210,176,0.5)' },
    ],
  })
  p.fillPath(speckles(g, w, h, Math.round((w * h) / 1400), 1.6 * u, 11), 'rgba(120,92,40,0.07)')
  const brown = '#A3803F'
  p.strokePath(g.makePath(insetRect(w, h, 40 * u)), brown, 3.2 * u)
  p.strokePath(g.makePath(insetRect(w, h, 53 * u)), brown, 1.2 * u)
  const knots: string[] = []
  const m = 40 * u
  for (const [x, y] of [
    [m, m],
    [w - m, m],
    [m, h - m],
    [w - m, h - m],
  ]) {
    knots.push(diamond(x, y, 8 * u))
  }
  p.fillPath(g.makePath(knots.join('')), brown)
}

function drawFajr(p: Painter, g: Graphics, w: number, h: number) {
  const u = unit(w, h)
  p.fillRect(0, 0, w, h, {
    type: 'linear',
    x0: 0,
    y0: 0,
    x1: 0,
    y1: h,
    stops: [
      { offset: 0, color: '#0A1230' },
      { offset: 0.45, color: '#1B2856' },
      { offset: 0.76, color: '#47396A' },
      { offset: 1, color: '#77506A' },
    ],
  })
  p.fillRect(0, 0, w, h, {
    type: 'radial',
    cx: w / 2,
    cy: h * 1.08,
    r: Math.max(w, h) * 0.62,
    stops: [
      { offset: 0, color: 'rgba(246,170,128,0.36)' },
      { offset: 1, color: 'rgba(246,170,128,0)' },
    ],
  })
  // a few faint stars in the upper sky (seeded)
  const rnd = seededRandom(1405)
  const dots: string[] = []
  const n = Math.round(60 * (w / 1080))
  for (let i = 0; i < n; i++) {
    const x = rnd() * w
    const y = rnd() * rnd() * h * 0.45
    dots.push(circle(x, y, (0.8 + rnd() * 1.4) * u))
  }
  p.fillPath(g.makePath(dots.join('')), 'rgba(255,248,230,0.45)')
}

function drawSandStone(p: Painter, g: Graphics, w: number, h: number) {
  const u = unit(w, h)
  p.fillRect(0, 0, w, h, {
    type: 'linear',
    x0: 0,
    y0: 0,
    x1: w,
    y1: h,
    stops: [
      { offset: 0, color: '#EEE4CF' },
      { offset: 1, color: '#DCCBAA' },
    ],
  })
  const rnd = seededRandom(2607)
  for (let i = 0; i < 26; i++) {
    const cx = rnd() * w
    const cy = rnd() * h
    const r = (120 + rnd() * 380) * u
    const light = rnd() > 0.5
    const a = 0.05 + rnd() * 0.07
    const c = light ? '255,250,240' : '150,120,80'
    const paint: Paint = {
      type: 'radial',
      cx,
      cy,
      r,
      stops: [
        { offset: 0, color: `rgba(${c},${a})` },
        { offset: 1, color: `rgba(${c},0)` },
      ],
    }
    p.fillRect(cx - r, cy - r, 2 * r, 2 * r, paint)
  }
  p.fillPath(speckles(g, w, h, Math.round((w * h) / 900), 1.5 * u, 77), 'rgba(110,82,45,0.08)')
  p.fillPath(speckles(g, w, h, Math.round((w * h) / 1800), 1.4 * u, 78), 'rgba(255,255,255,0.18)')
}

function drawInkGold(p: Painter, g: Graphics, w: number, h: number) {
  const u = unit(w, h)
  p.fillRect(0, 0, w, h, {
    type: 'radial',
    cx: w / 2,
    cy: h * 0.45,
    r: Math.hypot(w, h) / 2,
    stops: [
      { offset: 0, color: '#1F2A36' },
      { offset: 1, color: '#0C1117' },
    ],
  })
  const gold = '#C29A3E'
  const m = 48 * u
  const len = 150 * u
  const gap = 12 * u
  const parts = [
    cornerOrnament(m, m, 1, 1, len, gap, 13 * u),
    cornerOrnament(w - m, m, -1, 1, len, gap, 13 * u),
    cornerOrnament(m, h - m, 1, -1, len, gap, 13 * u),
    cornerOrnament(w - m, h - m, -1, -1, len, gap, 13 * u),
  ]
  p.strokePath(g.makePath(parts.join('')), gold, 2 * u)
  p.strokePath(g.makePath(insetRect(w, h, m + gap * 0.5)), 'rgba(194,154,62,0.16)', 1 * u)
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'lapis-night', nameAr: 'ليل لازوردي', tone: 'light', draw: drawLapisNight },
  { id: 'malachite-gilded', nameAr: 'ملكيت مذهّب', tone: 'light', draw: drawMalachite },
  { id: 'mushaf-paper', nameAr: 'ورق المصحف', tone: 'dark', draw: drawMushafPaper },
  { id: 'fajr', nameAr: 'فجر', tone: 'light', draw: drawFajr },
  { id: 'sand-stone', nameAr: 'رمل وحجر', tone: 'dark', draw: drawSandStone },
  { id: 'ink-gold', nameAr: 'حبر وذهب', tone: 'light', draw: drawInkGold },
  { id: 'plain-dark', nameAr: 'داكن', tone: 'light', draw: (p, _g, w, h) => p.fillRect(0, 0, w, h, '#16222E') },
  { id: 'plain-light', nameAr: 'فاتح', tone: 'dark', draw: (p, _g, w, h) => p.fillRect(0, 0, w, h, '#FBF8F0') },
]

export const DEFAULT_PRESET_ID = 'lapis-night'

export function presetById(id: string): BackgroundPreset {
  return BACKGROUND_PRESETS.find((b) => b.id === id) ?? BACKGROUND_PRESETS[0]
}

// ── user image ──

/** Source rect of `img` that covers a w×h frame with the focal point as close to the centre as possible. */
export function coverCrop(iw: number, ih: number, w: number, h: number, focusX: number, focusY: number) {
  const s = Math.max(w / iw, h / ih)
  const cw = Math.min(iw, w / s)
  const ch = Math.min(ih, h / s)
  const x = clamp(clamp(focusX, 0, 1) * iw - cw / 2, 0, iw - cw)
  const y = clamp(clamp(focusY, 0, 1) * ih - ch / 2, 0, ih - ch)
  return { x, y, w: cw, h: ch }
}

/** Draws `src` (whole, or `crop`) into a new w×h surface, halving first so big downscales do not alias. */
function resample(g: Graphics, src: ImageHandle, crop: { x: number; y: number; w: number; h: number }, w: number, h: number): ImageHandle {
  let cur = src
  let c = crop
  while (c.w > w * 2.2 && c.h > h * 2.2) {
    const nw = Math.ceil(c.w / 2)
    const nh = Math.ceil(c.h / 2)
    const s = g.createSurface(nw, nh)
    s.painter.drawImage(cur, 0, 0, nw, nh, c)
    cur = s.snapshot()
    c = { x: 0, y: 0, w: nw, h: nh }
  }
  const out = g.createSurface(w, h)
  out.painter.drawImage(cur, 0, 0, w, h, c)
  return out.snapshot()
}

/**
 * Blurs an image of size w×h by `levels` halvings followed by the same number of doublings
 * (bilinear filtering at every step ≈ a blur of radius ~2^levels px). Deterministic per engine.
 */
export function blurByResampling(g: Graphics, img: ImageHandle, w: number, h: number, levels: number): ImageHandle {
  if (levels <= 0) return img
  const sizes: [number, number][] = [[w, h]]
  for (let l = 1; l <= levels; l++) {
    const [pw, ph] = sizes[l - 1]
    sizes.push([Math.max(1, Math.round(pw / 2)), Math.max(1, Math.round(ph / 2))])
  }
  let cur = img
  for (let l = 1; l <= levels; l++) {
    const [nw, nh] = sizes[l]
    const s = g.createSurface(nw, nh)
    s.painter.drawImage(cur, 0, 0, nw, nh)
    cur = s.snapshot()
  }
  for (let l = levels - 1; l >= 0; l--) {
    const [nw, nh] = sizes[l]
    const s = g.createSurface(nw, nh)
    s.painter.drawImage(cur, 0, 0, nw, nh)
    cur = s.snapshot()
  }
  return cur
}

/** Blur radius in output pixels → number of halvings. */
export function blurLevels(radiusPx: number): number {
  if (radiusPx < 0.75) return 0
  return clamp(Math.round(Math.log2(radiusPx * 1.25)), 1, 7)
}

/** Draws the user image cover-fitted around (focusX, focusY), blurred by `blurPx` output pixels. */
export function drawImageBackground(
  p: Painter,
  g: Graphics,
  img: ImageHandle,
  w: number,
  h: number,
  focusX: number,
  focusY: number,
  blurPx: number,
) {
  const crop = coverCrop(img.width, img.height, w, h, focusX, focusY)
  const levels = blurLevels(blurPx)
  const sharp = resample(g, img, crop, w, h)
  const out = levels ? blurByResampling(g, sharp, w, h, levels) : sharp
  p.drawImage(out, 0, 0, w, h)
}
