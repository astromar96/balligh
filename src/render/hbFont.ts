// QuranFont over harfbuzzjs (vendored, wasm). Platform-neutral JS: the web platform feeds it the wasm
// and the TTF bytes; unit tests feed it the same files from disk. Recipe: research/fonts-rendering.md §5
// (RTL + script Arab + language ar + ClusterLevel.CHARACTERS so every mark keeps its own cluster unless the
// font ligates it — research/00-gaps.md C19; ayah numbers U+06DD + digits are shaped LTR or the digits come out
// reversed — §3). Level 2 over level 1 (MONOTONE_CHARACTERS), whole Quran, Amiri Quran, QPC display text: 0 vs 2
// tajweed classes lost, 1,687 vs 2,773 glyphs whose characters carry different classes (all of them font
// ligatures such as alef + madda), and the glyphs still come back in visual order (no non-monotone run).
import type * as HB from '../vendor/harfbuzzjs/index.mjs'
import type { QuranFont, ShapedGlyph, ShapedRun } from './index'

export type HarfBuzzModule = typeof HB

export function createHarfBuzzQuranFont(hb: HarfBuzzModule, ttf: ArrayBuffer | Uint8Array): QuranFont {
  const face = new hb.Face(new hb.Blob(ttf instanceof Uint8Array ? ttf : new Uint8Array(ttf)))
  const font = new hb.Font(face)
  const upem = face.upem
  const { ascender, descender } = font.hExtents()
  const buffer = new hb.Buffer()
  const shapes = new Map<string, ShapedRun>()
  const svgs = new Map<number, string>()

  const shape = (text: string, direction: 'rtl' | 'ltr' = 'rtl'): ShapedRun => {
    const key = (direction === 'rtl' ? 'r' : 'l') + text
    const cached = shapes.get(key)
    if (cached) return cached
    buffer.clearContents()
    buffer.addText(text)
    buffer.setDirection(direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR)
    buffer.setScript('Arab')
    buffer.setLanguage('ar')
    buffer.setClusterLevel(hb.ClusterLevel.CHARACTERS)
    hb.shape(font, buffer)
    const glyphs: ShapedGlyph[] = buffer.getGlyphInfosAndPositions().map((g) => ({
      gid: g.codepoint,
      cluster: g.cluster,
      xAdvance: g.xAdvance ?? 0,
      xOffset: g.xOffset ?? 0,
      yOffset: g.yOffset ?? 0,
    }))
    let advance = 0
    for (const g of glyphs) advance += g.xAdvance
    const run: ShapedRun = { glyphs, advance }
    shapes.set(key, run)
    return run
  }

  const glyphSvg = (gid: number): string => {
    let d = svgs.get(gid)
    if (d === undefined) {
      d = font.glyphToPath(gid)
      svgs.set(gid, d)
    }
    return d
  }

  return { upem, ascender, descender, shape, glyphSvg }
}
