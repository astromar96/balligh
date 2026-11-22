// Live check (network): the lab passages through the app's data module (lab/model.ts → src/data), shaped with
// the real font (vendored HarfBuzz + bundled Amiri Quran) and laid out on every aspect. Skipped unless LIVE=1.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Aspect, RenderModel } from '../core/types'
import { ASPECT_SIZES, type QuranFont } from './index'
import { createHarfBuzzQuranFont } from './hbFont'
import { BASMALA, ISTIADHA, buildUnits, splitPauseMarks } from './layout'
import { PASSAGES, SCRIPT_TRANSLATIONS, fakeTimeline, modelFromData, translationSource } from './lab/model'
import { buildScene, type Rect } from './scene'
import { fakeGraphics, makeDesign } from './testing/fakes'

type Fs = { readFileSync(p: URL): Uint8Array }
const g = globalThis as unknown as { location?: { href: string }; process?: { env: Record<string, string | undefined> } }
const LIVE = !!g.process?.env.LIVE
const hadLocation = 'location' in g
let font: QuranFont
const models = new Map<string, RenderModel>()

describe.skipIf(!LIVE)('live passages through src/data (api.quran.com, QuranEnc)', () => {
  beforeAll(async () => {
    const fs = (await import('node:fs' as string)) as Fs
    if (!hadLocation) g.location = { href: new URL('../vendor/harfbuzzjs/harfbuzz.js', import.meta.url).href }
    const hb = await import('../vendor/harfbuzzjs/index.mjs')
    const wasm = fs.readFileSync(new URL('../../public/harfbuzz.wasm', import.meta.url))
    await hb.loadHarfBuzz({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer })
    font = createHarfBuzzQuranFont(hb, fs.readFileSync(new URL('../../assets/fonts/AmiriQuran-Regular.ttf', import.meta.url)))
    for (const spec of PASSAGES) models.set(spec.id, await modelFromData(spec))
  }, 180_000)

  afterAll(() => {
    if (!hadLocation) delete g.location
  })

  it('every word, pause mark and ornament shapes without a missing glyph; no stray small meem; open tanween', () => {
    for (const t of [BASMALA, ISTIADHA]) expect(font.shape(t).glyphs.some((x) => x.gid === 0)).toBe(false)
    const gidOf = (ch: string) => font.shape(ch).glyphs.find((x) => font.glyphSvg(x.gid))?.gid ?? -1
    const meems = new Set([gidOf('ۢ'), gidOf('ۭ')])
    const PLAIN: Record<string, string> = { 'ࣰ': 'ً', 'ࣱ': 'ٌ', 'ࣲ': 'ٍ' }
    const glyphsAt = (text: string, i: number) => font.shape(text).glyphs.filter((x) => x.cluster === i).map((x) => x.gid)
    for (const spec of PASSAGES) {
      const model = models.get(spec.id)!
      expect(model.ayahs.length, spec.id).toBe(spec.to - spec.from + 1)
      if (spec.lastWordTo) expect(model.ayahs[model.ayahs.length - 1].words).toHaveLength(spec.lastWordTo)
      let spans = 0
      for (const a of model.ayahs) {
        for (const w of a.words) {
          const key = `${a.key}:${w.position} ${w.text}`
          const gids = font.shape(w.text).glyphs.map((x) => x.gid)
          expect(gids.includes(0), key).toBe(false)
          expect(gids.filter((x) => meems.has(x)).length, key).toBe((w.text.match(/[ۭۢ]/g) ?? []).length)
          // open tanween never drawn as the plain one in the same context (Amiri swaps tanween beside a shadda)
          for (let i = 0; i < w.text.length; i++) {
            const plainCh = PLAIN[w.text[i]]
            if (!plainCh) continue
            const open = glyphsAt(w.text, i)
            expect(open.length > 0 && !open.some((x) => glyphsAt(w.text.slice(0, i) + plainCh + w.text.slice(i + 1), i).includes(x)), `${key} @${i}`).toBe(true)
          }
          for (const s of w.tajweed) {
            expect(s.start).toBeGreaterThanOrEqual(0)
            expect(s.end).toBeLessThanOrEqual(w.text.length)
          }
          spans += w.tajweed.length
        }
      }
      expect(spans, spec.id).toBeGreaterThan(0)
      const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: true })
      for (const u of units) expect(u.glyphs.some((x) => x.gid === 0), `${u.ayah}:${u.position}`).toBe(false)
      const words = model.ayahs.flatMap((a) => a.words).filter((w) => w.text)
      units
        .filter((u) => u.kind === 'word')
        .forEach((u, i) => {
          const { sakt, gap } = splitPauseMarks(words[i].waqfChar)
          expect(u.glyphs.filter((x) => x.role === 'waqf').length, `${u.ayah}:${u.position}`).toBe(sakt.length + (gap ? 1 : 0))
        })
    }
  })

  it('lays out every passage on every aspect, still (all pages) and video, inside the frame', () => {
    const inside = (r: Rect | null, ref: { width: number; height: number }) => !r || (r.y >= -0.5 && r.y + r.h <= ref.height + 0.5 && r.x >= -0.5 && r.x + r.w <= ref.width + 0.5)
    for (const spec of PASSAGES) {
      const model = models.get(spec.id)!
      expect(model.tafsirCreditAr ?? '', spec.id).not.toBe('')
      for (const aspect of Object.keys(ASPECT_SIZES) as Aspect[]) {
        const ref = ASPECT_SIZES[aspect]
        for (const timeline of [null, fakeTimeline(model, { words: true })]) {
          const design = makeDesign({ aspect, showTranslation: true, showTafsir: true, showTajweed: true, showRulesLegend: true })
          const scene = buildScene({ ...model, timeline }, design, { font, graphics: fakeGraphics(), backgroundImage: null }, ref, ref)
          expect(scene.layout.size).toBeGreaterThan(0)
          for (const r of [scene.layout.quranZone, scene.layout.translationZone, scene.layout.tafsirCard]) expect(inside(r, ref), `${spec.id} ${aspect}`).toBe(true)
          for (const p of scene.layout.stills) {
            for (const r of [p.quranZone, p.translationZone, p.tafsirCard, p.basmala, p.istiadha]) expect(inside(r, ref), `${spec.id} ${aspect} still`).toBe(true)
          }
        }
      }
    }
  })

  it('the script translations come back in their script (Urdu, Russian, Dhivehi, Bengali)', async () => {
    const want: Record<string, RegExp> = { Arab: /[؀-ۿ]/, Cyrl: /[Ѐ-ӿ]/, Thaa: /[ހ-޿]/, Beng: /[ঀ-৿]/ }
    for (const id of SCRIPT_TRANSLATIONS) {
      const src = translationSource(id)
      const model = await modelFromData(PASSAGES.find((p) => p.id === '2:255')!, id)
      expect(model.translationSource?.script, `${id}`).toBe(src.script)
      const text = model.translation?.map((e) => e.text).join(' ') ?? ''
      expect(want[src.script].test(text), `${id} ${src.script}: ${text.slice(0, 80)}`).toBe(true)
    }
  }, 120_000)
})
