// render/ — draws frames through the Painter contract (core/types.ts). Owner: render agent.
// One deterministic scene serves the live preview, PNG export and every video frame, so
// preview == export by construction. Platform code lives ONLY in ./platform(.web).ts:
//   platform.web.ts — Canvas 2D painter + HarfBuzz (vendored harfbuzzjs, wasm) — implemented now
//   platform.ts     — native (React Native Skia + a non-wasm shaper) — interface-ready stub for later
import type { Aspect, DesignOptions, Graphics, ImageHandle, Painter, RenderModel, Scene } from '../core/types'
import { BACKGROUND_PRESETS as PRESETS } from './backgrounds'
import { renderPlatform } from './platform'
import { buildScene } from './scene'

// ── Quran font ──

/** One shaped glyph in font units; glyphs come back in visual (left→right) order. */
export interface ShapedGlyph {
  gid: number
  /** UTF-16 index into the shaped string of the character this glyph came from */
  cluster: number
  xAdvance: number
  xOffset: number
  yOffset: number
}

export interface ShapedRun {
  glyphs: ShapedGlyph[]
  /** total advance in font units */
  advance: number
}

export interface QuranFont {
  upem: number
  /** font-unit metrics for line spacing */
  ascender: number
  descender: number
  /**
   * Shapes text with the Quran font. RTL by default (Arabic, cluster level CHARACTERS so every mark keeps its
   * own cluster unless the font ligates it — 00-gaps C19); pass 'ltr' for ayah numbers (U+06DD + digits) or the
   * digits reverse. Cached.
   */
  shape(text: string, direction?: 'rtl' | 'ltr'): ShapedRun
  /** Glyph outline as SVG path data in font units, y up (flip when drawing). Cached. */
  glyphSvg(gid: number): string
}

/** What a platform must provide to render. */
export interface RenderPlatform {
  /** loads the bundled Amiri Quran TTF into the shaper once; later calls return the same promise */
  loadQuranFont(): Promise<QuranFont>
  graphics: Graphics
  /** see ensureTextFonts below */
  ensureTextFonts(scripts?: string[], sampleText?: string): Promise<void>
}

export function loadQuranFont(): Promise<QuranFont> {
  return renderPlatform.loadQuranFont()
}

export function getGraphics(): Graphics {
  return renderPlatform.graphics
}

/**
 * Loads the fonts the scene draws non-Quran text with, so measureText and the pixels are right: the UI families
 * (ReadexPro, ReemKufi — registered by the UI through expo-font) and, on the web, the Noto family of each
 * translation script (TranslationSource.script, ISO 15924 — research/00-gaps.md §6.4) from the fontsource
 * packages on jsDelivr (unpkg fallback) with the FontFace API. Call it before createScene whenever the
 * translation changes; `sampleText` (e.g. the translation itself) also fetches the CJK shards that text needs.
 * One promise per family, cached; every wait is capped (~8 s), after which the scene draws with the fallback
 * stack (UI font, system-ui) — it never blocks a frame. Never rejects. Native: resolves at once for now.
 */
export function ensureTextFonts(scripts?: string[], sampleText?: string): Promise<void> {
  return renderPlatform.ensureTextFonts(scripts, sampleText)
}

/** The Noto family a translation in this script is drawn with (null: the UI font), for the app's own text views. */
export { translationFontFamily } from './fonts'

// ── Backgrounds ──

export interface BackgroundPreset {
  id: string
  nameAr: string
  /** text tone that reads best on it */
  tone: 'light' | 'dark'
  /** Draws the preset filling 0,0..w,h. Deterministic; uses only Painter/Graphics. */
  draw(painter: Painter, graphics: Graphics, w: number, h: number): void
}

/**
 * ~8 procedural presets from Islamic manuscript/architecture (no people, animals or the unseen);
 * 'lapis-night' (first) is the default. Implemented in ./backgrounds.
 */
export const BACKGROUND_PRESETS: BackgroundPreset[] = PRESETS

// ── Scene ──

/** Export pixel size per aspect (1080 on the short side). */
export const ASPECT_SIZES: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
}

/**
 * Pixel size for an export: 'hd' = 720 on the short side (default for video — research/media-pipeline.md §0.8),
 * 'fullhd' = 1080 (stills always use fullhd). Even numbers only (H.264).
 */
export function exportSize(aspect: Aspect, quality: 'hd' | 'fullhd'): { width: number; height: number } {
  const base = ASPECT_SIZES[aspect]
  const k = quality === 'hd' ? 720 / 1080 : 1
  const even = (n: number) => Math.round((n * k) / 2) * 2
  return { width: even(base.width), height: even(base.height) }
}

export interface SceneAssets {
  font: QuranFont
  graphics: Graphics
  /** decoded user background image when design.background.kind === 'image' */
  backgroundImage: ImageHandle | null
}

/**
 * Lays out everything once (fonts must already be loaded: loadQuranFont + ensureTextFonts) and returns a Scene.
 * Video (model.timeline set): pageCount 1, draw(painter, tMs) paints the frame at tMs. Still (no timeline): the
 * Quran text, translation and tafsir flow over scene.pageCount pages — never truncated (00-gaps C13/D6) — each
 * with the header, the reference line, a page indicator «١ / ٣» and the credits; drawPage(painter, k) paints page
 * k and draw(painter, t) page 0. `size` defaults to ASPECT_SIZES[design.aspect]; the preview passes a smaller
 * size with the same aspect and gets the same layout scaled.
 */
export function createScene(model: RenderModel, design: DesignOptions, assets: SceneAssets, size?: { width: number; height: number }): Scene {
  const ref = ASPECT_SIZES[design.aspect] ?? ASPECT_SIZES['9:16']
  return buildScene(model, design, assets, size ?? ref, ref)
}
