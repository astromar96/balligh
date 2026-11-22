// Small pure helpers for the render module (no platform APIs, no Date, no Math.random).

/** 255 → "٢٥٥" (Arabic-Indic digits). Local so render does not depend on domain/ being ready. */
export function arabicDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + d.charCodeAt(0) - 48))
}

/** Deterministic PRNG (mulberry32). Same seed → same sequence on every platform. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Smoothstep easing 0..1 → 0..1. */
export const ease = (t: number): number => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Bounding box of SVG path data (all coordinate pairs, control points included — a safe over-estimate). */
export function pathBounds(d: string): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (!nums || nums.length < 2) return null
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i])
    const y = Number(nums[i + 1])
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
  }
  return { xMin, yMin, xMax, yMax }
}

/** Formats a number for SVG path data with limited precision (keeps strings short and stable). */
export const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

/** "rgba(r,g,b,a)" from "#rrggbb" + alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${Math.round(clamp(alpha, 0, 1) * 1000) / 1000})`
}

/**
 * Absolute URL of a file from public/. Expo serves public/ at the app's base: the site root, or app.json
 * experiments.baseUrl on a sub-path (Expo docs, "Hosting with sub-paths": a URL the code references directly must
 * get the baseUrl prepended by hand). Resolved against the document's base URL; never a bare "/file".
 */
export function resolvePublicUrl(file: string, baseUrl: string, documentBase: string | undefined): string {
  const base = baseUrl.replace(/\/+$/, '')
  const path = `${base}/${file.replace(/^\/+/, '')}`
  if (!documentBase) return path
  try {
    return new URL(path, documentBase).href
  } catch {
    return path
  }
}
