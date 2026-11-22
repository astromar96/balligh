// Test-only: shapes text with the bundled Amiri Quran through the vendored harfbuzzjs (the wasm from public/),
// exactly as the renderer does (render/hbFont.ts: RTL, script Arab, language ar, cluster level CHARACTERS). Used to prove
// that every display word has a glyph for every character (no .notdef). Never imported by app code.
import { readBytesIfPresent, repoFile } from './load'

export interface TestShaper {
  /** glyph ids of the shaped text (0 = .notdef) */
  glyphs(text: string, direction?: 'rtl' | 'ltr'): number[]
}

const g = globalThis as unknown as { location?: { href: string } }

/** null when the wasm or the font is missing from the checkout. */
export async function loadAmiriShaper(): Promise<TestShaper | null> {
  const wasm = await readBytesIfPresent(repoFile('public/harfbuzz.wasm'))
  const ttf = await readBytesIfPresent(repoFile('assets/fonts/AmiriQuran-Regular.ttf'))
  if (!wasm || !ttf) return null
  // the vendored loader reads location.href only when no wasmBinary is given; it must exist all the same
  if (!g.location) g.location = { href: repoFile('src/vendor/harfbuzzjs/harfbuzz.js').href }
  const hb = await import('../../vendor/harfbuzzjs/index.mjs')
  await hb.loadHarfBuzz({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer })
  const face = new hb.Face(new hb.Blob(ttf))
  const font = new hb.Font(face)
  const buffer = new hb.Buffer()
  return {
    glyphs(text, direction = 'rtl') {
      buffer.clearContents()
      buffer.addText(text)
      buffer.setDirection(direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR)
      buffer.setScript('Arab')
      buffer.setLanguage('ar')
      buffer.setClusterLevel(hb.ClusterLevel.CHARACTERS)
      hb.shape(font, buffer)
      return buffer.getGlyphInfosAndPositions().map((x) => x.codepoint)
    },
  }
}
