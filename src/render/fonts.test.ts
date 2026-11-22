import { describe, expect, it } from 'vitest'
import { SCRIPT_FONTS, fontsourceCssUrl, parseFontFaces, scriptFont, translationFontFamily } from './fonts'
import { resolvePublicUrl } from './util'

type Fs = { existsSync(p: URL): boolean; readFileSync(p: URL, encoding: 'utf8'): string }
/** The fixture's text, or null where it is not in the checkout (the public repository carries no fixture data). */
const readTextIfPresent = async (rel: string) => {
  const fs = (await import('node:fs' as string)) as Fs
  const url = new URL(rel, import.meta.url)
  return fs.existsSync(url) ? fs.readFileSync(url, 'utf8') : null
}

describe('translation fonts per script (00-gaps §6.4)', () => {
  it('maps the scripts of the catalogue to their Noto family; unknown → null (UI font + system fallback)', () => {
    expect(translationFontFamily('Latn')).toBe('Noto Sans')
    expect(translationFontFamily('Cyrl')).toBe('Noto Sans') // Russian, Tatar, Kazakh…
    expect(translationFontFamily('Arab')).toBe('Noto Naskh Arabic') // Urdu, Persian, Kurdish, Pashto…
    expect(translationFontFamily('Thaa')).toBe('Noto Sans Thaana') // Dhivehi
    expect(translationFontFamily('Beng')).toBe('Noto Sans Bengali')
    expect(translationFontFamily('Hans')).toBe('Noto Sans SC')
    expect(translationFontFamily('Zzzz')).toBeNull()
    expect(translationFontFamily(null)).toBeNull()
    expect(translationFontFamily('')).toBeNull()
  })

  it('accepts any casing of the ISO 15924 code', () => {
    expect(scriptFont('thaa')?.family).toBe('Noto Sans Thaana')
    expect(scriptFont('CYRL')?.family).toBe('Noto Sans')
    expect(scriptFont(' latn ')?.family).toBe('Noto Sans')
  })

  it('every entry is loadable: a fontsource package + exact version, a sample in its script, sane metrics', () => {
    for (const [script, f] of Object.entries(SCRIPT_FONTS)) {
      expect(f.pkg, script).toMatch(/^noto-[a-z-]+$/)
      expect(f.version, script).toMatch(/^\d+\.\d+\.\d+$/)
      expect(f.sample.length, script).toBeGreaterThan(2)
      expect(f.lineHeight, script).toBeGreaterThanOrEqual(1.4)
      expect(f.sizeScale, script).toBeGreaterThan(0.8)
    }
    expect(fontsourceCssUrl('https://cdn.jsdelivr.net/npm', SCRIPT_FONTS.Thaa)).toBe('https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-thaana@5.3.0/400.css')
  })
})

describe('fontsource stylesheet parsing', () => {
  it('reads every face of a real 400.css (Noto Sans Thaana 5.3.0, captured from jsDelivr): family, woff2 URL, range', async ({ skip }) => {
    const css = await readTextIfPresent('./__fixtures__/fontsource-noto-sans-thaana-5.3.0-400.css')
    if (css === null) return skip()
    const cssUrl = 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-thaana@5.3.0/400.css'
    const faces = parseFontFaces(css, cssUrl)
    expect(faces).toHaveLength(3) // thaana, latin-ext, latin subsets
    for (const f of faces) {
      expect(f.family).toBe('Noto Sans Thaana')
      expect(f.weight).toBe('400')
      expect(f.style).toBe('normal')
      expect(f.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource\/noto-sans-thaana@5\.3\.0\/files\/.+-400-normal\.woff2$/)
      expect(f.unicodeRange).toMatch(/^U\+/)
    }
    expect(faces[0].unicodeRange).toContain('U+0780-07B1') // the Thaana block
  })

  it('skips faces without a woff2 source and keeps an absent unicode-range as undefined', () => {
    const css = `@font-face{font-family:"X";src:url(a.woff) format('woff')}
      @font-face { font-family: X; font-weight: 400; src: url("files/x.woff2") format("woff2"); }`
    const faces = parseFontFaces(css, 'https://unpkg.com/@fontsource/x@1.0.0/400.css')
    expect(faces).toEqual([{ family: 'X', url: 'https://unpkg.com/@fontsource/x@1.0.0/files/x.woff2', weight: '400', style: 'normal', unicodeRange: undefined }])
  })
})

describe('public file URLs (sub-path hosting)', () => {
  it('prefixes the app base and resolves against the document', () => {
    expect(resolvePublicUrl('harfbuzz.wasm', '', 'https://example.org/lab/render')).toBe('https://example.org/harfbuzz.wasm')
    expect(resolvePublicUrl('harfbuzz.wasm', '/balligh', 'https://example.org/balligh/lab/render')).toBe('https://example.org/balligh/harfbuzz.wasm')
    expect(resolvePublicUrl('/harfbuzz.wasm', '/balligh/', 'https://example.org/balligh/')).toBe('https://example.org/balligh/harfbuzz.wasm')
    expect(resolvePublicUrl('harfbuzz.wasm', '/balligh', undefined)).toBe('/balligh/harfbuzz.wasm')
  })
})
