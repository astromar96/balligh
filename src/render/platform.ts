// Native render platform — interface-ready stub. Metro picks platform.web.ts on the web; this file is
// also what TypeScript and Vitest (node) see.
//
// Skia port (to ship the mobile app; scene.ts / layout.ts / backgrounds.ts stay as they are — they only
// talk to Painter / Graphics / QuranFont):
// - Painter over an SkCanvas (@shopify/react-native-skia): save/restore/translate/scale map 1:1;
//   alpha(a) = canvas.saveLayer with an alpha paint (or carry the alpha into each paint);
//   fillRect/fillRoundRect/fillPath/strokePath = drawRect/drawRRect/drawPath with a cached SkPaint
//   per colour; Paint gradients → Skia.Shader.MakeLinearGradient / MakeRadialGradient.
//   drawImage(img, dx, dy, dw, dh, src) = drawImageRect with a linear sampling option (the blur by
//   down/upsampling in backgrounds.ts relies on bilinear filtering).
// - Surface = Skia.Surface.MakeOffscreen(w, h) (GPU) or Skia.Surface.Make (raster) and
//   snapshot() = surface.makeImageSnapshot(); web semantics: a snapshot never changes afterwards.
// - makePath = Skia.Path.MakeFromSVGString(d) (glyph outlines are y-up SVG paths in font units; the
//   scene flips them with scale(k, -k)). Glyph paths are cached per (Graphics, QuranFont) in scene.ts.
// - loadImage = Skia.Data.fromURI + Skia.Image.MakeImageFromEncoded.
// - Text: measureText/fillText with SkFont / Paragraph using the same family names as FONTS
//   (core/fonts.ts) registered through Skia's font manager; direction 'rtl' must run the bidi
//   algorithm (Paragraph API) — the scene draws whole Arabic/Latin lines and relies on it.
// - Quran shaping: Hermes has no WebAssembly → no harfbuzzjs. Options: a JSI HarfBuzz binding, or
//   Skia's own shaper (SkShaper/Paragraph with HarfBuzz inside) exposing glyph ids + positions +
//   clusters, or runs precomputed per word on the web and shipped as data. Whatever the source,
//   createHarfBuzzQuranFont's contract must hold: RTL, script Arab, language ar, cluster level
//   CHARACTERS, glyphs in visual (left→right) order, UTF-16 clusters; LTR for ayah numbers.
// - Translation fonts: bundle or download the Noto family of each script (render/fonts.ts SCRIPT_FONTS) and
//   register it with Skia's font manager under the same family name; ensureTextFonts(scripts) waits for it.
import type { Painter } from '../core/types'
import type { RenderPlatform } from './index'

const unsupported = (what: string): never => {
  throw new Error(`render: ${what} is not implemented on this platform yet (web only for now)`)
}

/** Same export as platform.web.ts; a Canvas 2D painter does not exist on native (Skia draws there). */
export function createCanvasPainter(_ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, _width: number, _height: number): Painter {
  return unsupported('createCanvasPainter')
}

export const renderPlatform: RenderPlatform = {
  loadQuranFont: () => Promise.reject(new Error('render: Quran shaping is not implemented on native yet')),
  graphics: {
    makePath: () => unsupported('makePath'),
    createSurface: () => unsupported('createSurface'),
    loadImage: () => Promise.reject(new Error('render: loadImage is not implemented on native yet')),
  },
  ensureTextFonts: () => Promise.resolve(),
}
