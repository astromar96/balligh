// Geometry → SVG path data for patterns and ornaments (drawn through Graphics.makePath).
// Pure functions; coordinates are whatever space the caller draws in.
import { fmt } from './util'

type Pt = [number, number]

const poly = (pts: Pt[], close = true): string =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join('') + (close ? 'Z' : '')

/** {n/2}-style star outline (2n vertices alternating outer/inner radius), first point at angle `rot`. */
export function starPolygon(cx: number, cy: number, outer: number, inner: number, points: number, rot = 0): string {
  const pts: Pt[] = []
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? outer : inner
    const a = rot + (Math.PI * k) / points
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return poly(pts)
}

/** Eight-pointed star made of two overlapping squares (the khatam), as one outline. */
export function khatam(cx: number, cy: number, r: number, rot = 0): string {
  const inner = (r * Math.cos(Math.PI / 4)) / Math.cos(Math.PI / 8)
  return starPolygon(cx, cy, r, inner, 8, rot)
}

export function circle(cx: number, cy: number, r: number): string {
  // two arcs approximated by cubic Béziers (4 segments)
  const k = 0.5522847498 * r
  return (
    `M${fmt(cx + r)} ${fmt(cy)}` +
    `C${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)}` +
    `C${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)}` +
    `C${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)}` +
    `C${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)}Z`
  )
}

export function diamond(cx: number, cy: number, rx: number, ry = rx): string {
  return poly([
    [cx, cy - ry],
    [cx + rx, cy],
    [cx, cy + ry],
    [cx - rx, cy],
  ])
}

export function line(x0: number, y0: number, x1: number, y1: number): string {
  return `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}`
}

export function rect(x: number, y: number, w: number, h: number): string {
  return poly([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ])
}

/**
 * Eight-fold star lattice over [0,w]×[0,h]: a khatam at every grid point, joined to its neighbours
 * by straight strands, with small diamonds at the cell centres. Returns one path (strokes only).
 */
export function starLattice(w: number, h: number, cell: number): string {
  const r = cell * 0.3
  const parts: string[] = []
  const cols = Math.ceil(w / cell) + 1
  const rows = Math.ceil(h / cell) + 1
  // centre the grid so the pattern is symmetric in the frame
  const ox = (w - (cols - 1) * cell) / 2
  const oy = (h - (rows - 1) * cell) / 2
  for (let j = -1; j <= rows; j++) {
    for (let i = -1; i <= cols; i++) {
      const cx = ox + i * cell
      const cy = oy + j * cell
      parts.push(khatam(cx, cy, r, Math.PI / 8))
      // strands to the right and down neighbours, from star tip to star tip
      const tip = r * Math.cos(Math.PI / 8)
      parts.push(line(cx + tip, cy, cx + cell - tip, cy))
      parts.push(line(cx, cy + tip, cx, cy + cell - tip))
      // diamond in the cell centre
      parts.push(diamond(cx + cell / 2, cy + cell / 2, cell * 0.16))
    }
  }
  return parts.join('')
}

/** Rectangle outline inset by `inset` on every side. */
export function insetRect(w: number, h: number, inset: number): string {
  return rect(inset, inset, w - 2 * inset, h - 2 * inset)
}

/**
 * Surah-name cartouche: a long hexagon with pointed ends, centred at (cx, cy).
 * `point` is how far each tip reaches beyond the straight edges.
 */
export function cartouche(cx: number, cy: number, w: number, h: number, point: number): string {
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const y0 = cy - h / 2
  const y1 = cy + h / 2
  return poly([
    [x0 + point, y0],
    [x1 - point, y0],
    [x1, cy],
    [x1 - point, y1],
    [x0 + point, y1],
    [x0, cy],
  ])
}

/** Corner ornament: an L of two parallel rules with a khatam at the knot. (x,y) = corner; sx/sy = ±1 inward. */
export function cornerOrnament(x: number, y: number, sx: number, sy: number, len: number, gap: number, star: number): string {
  const parts: string[] = []
  parts.push(poly([[x + sx * len, y], [x, y], [x, y + sy * len]], false))
  parts.push(poly([[x + sx * len, y + sy * gap], [x + sx * gap, y + sy * gap], [x + sx * gap, y + sy * len]], false))
  parts.push(khatam(x + sx * gap * 3.2, y + sy * gap * 3.2, star, Math.PI / 8))
  return parts.join('')
}
