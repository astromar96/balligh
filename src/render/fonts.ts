// Translation fonts: Noto per script (research/00-gaps.md §2.11, §6.4). Readex Pro covers Arabic + Latin only —
// no Persian/Urdu/Kurdish/Sindhi/Pashto/Uyghur letters, no Cyrillic, no Thaana — so a translation is drawn in
// the Noto family of its script (TranslationSource.script, ISO 15924). platform.web.ts loads these families
// from the fontsource packages on jsDelivr (unpkg as the fallback host; both send ACAO *) with the FontFace
// API; this file is the platform-neutral part: the table, the family the scene draws with, and the parser of
// a fontsource stylesheet. No DOM here.

export interface ScriptFont {
  /** CSS family, exactly as the fontsource package declares it */
  family: string
  /** npm package name under the @fontsource scope */
  pkg: string
  version: string
  /**
   * a few characters of the script (plus "Aa" for the punctuation and digits): document.fonts.load(font, sample)
   * fetches only the unicode-range subsets they touch (CJK families come in ~100 shards)
   */
  sample: string
  /** line height of wrapped lines, em: scripts with tall stacks of marks need more room */
  lineHeight: number
  /** size against Latin at the same px (Naskh and Thaana run small) */
  sizeScale: number
}

const sf = (family: string, pkg: string, version: string, sample: string, lineHeight: number, sizeScale = 1): ScriptFont => ({
  family,
  pkg,
  version,
  sample,
  lineHeight,
  sizeScale,
})

// Versions: research/fixtures/gaps/fontsource-noto-packages.txt (npm, 2026-11-21).
const NOTO_SANS = sf('Noto Sans', 'noto-sans', '5.3.0', 'Aaİışğłạ', 1.5)
const JP = sf('Noto Sans JP', 'noto-sans-jp', '5.3.1', 'Aaあアの日本語', 1.65)
const KR = sf('Noto Sans KR', 'noto-sans-kr', '5.3.1', 'Aa한국어', 1.65)
const SC = sf('Noto Sans SC', 'noto-sans-sc', '5.3.1', 'Aa的一是中文', 1.65)
const TC = sf('Noto Sans TC', 'noto-sans-tc', '5.3.1', 'Aa的一是中文', 1.65)

/** ISO 15924 → family (00-gaps §6.4). Arabic script covers Persian, Urdu, Kurdish, Pashto, Sindhi, Uyghur, Dari. */
export const SCRIPT_FONTS: Readonly<Record<string, ScriptFont>> = {
  Latn: NOTO_SANS,
  Cyrl: sf('Noto Sans', 'noto-sans', '5.3.0', 'AaЖжӘәҖҗӀ', 1.5),
  Grek: sf('Noto Sans', 'noto-sans', '5.3.0', 'AaΩω', 1.5),
  Arab: sf('Noto Naskh Arabic', 'noto-naskh-arabic', '5.3.0', 'Aaابپچژگکیہےۓ', 1.9, 1.12),
  Thaa: sf('Noto Sans Thaana', 'noto-sans-thaana', '5.3.0', 'Aaހަދިވެހި', 1.9, 1.1),
  Nkoo: sf('Noto Sans NKo', 'noto-sans-nko', '5.3.0', 'Aaߒߞߏ', 1.75),
  Hebr: sf('Noto Sans Hebrew', 'noto-sans-hebrew', '5.3.0', 'Aaאבג', 1.55),
  Beng: sf('Noto Sans Bengali', 'noto-sans-bengali', '5.3.0', 'Aaঅআকবাংলা', 1.75),
  Deva: sf('Noto Sans Devanagari', 'noto-sans-devanagari', '5.3.0', 'Aaअआकहिन्दी', 1.75),
  Taml: sf('Noto Sans Tamil', 'noto-sans-tamil', '5.3.0', 'Aaஅஆகதமிழ்', 1.75),
  Mlym: sf('Noto Sans Malayalam', 'noto-sans-malayalam', '5.3.0', 'Aaഅആക', 1.8),
  Gujr: sf('Noto Sans Gujarati', 'noto-sans-gujarati', '5.3.0', 'Aaઅઆક', 1.75),
  Telu: sf('Noto Sans Telugu', 'noto-sans-telugu', '5.3.0', 'Aaఅఆక', 1.8),
  Knda: sf('Noto Sans Kannada', 'noto-sans-kannada', '5.3.0', 'Aaಅಆಕ', 1.8),
  Sinh: sf('Noto Sans Sinhala', 'noto-sans-sinhala', '5.3.0', 'Aaඅආක', 1.8),
  Thai: sf('Noto Sans Thai', 'noto-sans-thai', '5.3.0', 'Aaกขคไทย', 1.8),
  Khmr: sf('Noto Sans Khmer', 'noto-sans-khmer', '5.3.0', 'Aaកខគ', 1.85),
  Ethi: sf('Noto Sans Ethiopic', 'noto-sans-ethiopic', '5.3.0', 'Aaሀለሐ', 1.65),
  Jpan: JP,
  Hira: JP,
  Kana: JP,
  Kore: KR,
  Hang: KR,
  Hans: SC,
  Hani: SC,
  Hant: TC,
}

/** "latn", "LATN", "Latn" → "Latn" */
const canonical = (script: string): string => script.slice(0, 1).toUpperCase() + script.slice(1, 4).toLowerCase()

/** The Noto family for a translation script, or null for an unknown script (the scene then uses the UI font + system fallback). */
export function scriptFont(script: string | null | undefined): ScriptFont | null {
  if (!script) return null
  return SCRIPT_FONTS[canonical(script.trim())] ?? null
}

/** Family name the scene draws a translation of this script with (null: the UI font). */
export function translationFontFamily(script: string | null | undefined): string | null {
  return scriptFont(script)?.family ?? null
}

export interface FontFaceSource {
  family: string
  /** absolute URL of the woff2 file */
  url: string
  weight: string
  style: string
  /** CSS unicode-range, e.g. "U+0780-07B1,U+200C-200F"; undefined = all */
  unicodeRange: string | undefined
}

const descriptor = (block: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`, 'i').exec(block)
  return m ? m[1].trim() : undefined
}

/**
 * The @font-face rules of a fontsource stylesheet (e.g. …/@fontsource/noto-sans-thaana@5.3.0/400.css), woff2 sources
 * resolved against the stylesheet's own URL. Rules without a woff2 source are skipped.
 */
export function parseFontFaces(css: string, cssUrl: string): FontFaceSource[] {
  const out: FontFaceSource[] = []
  const re = /@font-face\s*{([^}]*)}/gi
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const block = m[1]
    const family = descriptor(block, 'font-family')?.replace(/^["']|["']$/g, '')
    const src = descriptor(block, 'src') ?? ''
    const woff2 = /url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/i.exec(src)?.[1]
    if (!family || !woff2) continue
    let url: string
    try {
      url = new URL(woff2, cssUrl).href
    } catch {
      continue
    }
    out.push({
      family,
      url,
      weight: descriptor(block, 'font-weight') ?? '400',
      style: descriptor(block, 'font-style') ?? 'normal',
      unicodeRange: descriptor(block, 'unicode-range'),
    })
  }
  return out
}

/** Stylesheet URL of a package's weight-400 faces on one CDN host ("https://cdn.jsdelivr.net/npm" or "https://unpkg.com"). */
export const fontsourceCssUrl = (host: string, f: ScriptFont): string => `${host}/@fontsource/${f.pkg}@${f.version}/400.css`
