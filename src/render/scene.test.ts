import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_PRESETS, createScene } from './index'
import type { SceneAssets } from './index'
import { blurByResampling, coverCrop, drawImageBackground } from './backgrounds'
import { BASMALA, ISTIADHA } from './layout'
import { buildScene, pageIndicator, referenceLabel, type Rect } from './scene'
import {
  RecordingPainter,
  ayah,
  expandLog,
  fakeFont,
  fakeGraphics,
  fakeTimeline,
  makeDesign,
  makeModel,
  reciter,
  syntheticAyah,
  tafsirSource,
  translationSource,
  word,
  type Call,
  type FakeGraphics,
} from './testing/fakes'
import type { DesignOptions, RenderModel } from '../core/types'

function assets(g: FakeGraphics = fakeGraphics()): SceneAssets & { graphics: FakeGraphics } {
  return { font: fakeFont(), graphics: g, backgroundImage: null }
}

function render(model: RenderModel, design: DesignOptions, t: number, size = { width: 540, height: 960 }) {
  const a = assets()
  const scene = createScene(model, design, a, size)
  const painter = new RecordingPainter(size.width, size.height)
  scene.draw(painter, t)
  return { scene, painter, graphics: a.graphics, expanded: expandLog(painter.log, a.graphics.images) }
}

type Built = ReturnType<typeof buildScene>
const layoutOf = (scene: unknown) => (scene as Built).layout

/** every fillText call reachable from a painter log (surface snapshots expanded) */
function fillTextsIn(log: Call[], g: FakeGraphics): unknown[][] {
  const out: unknown[][] = []
  const walk = (calls: unknown[]) => {
    for (const c of calls) {
      if (!Array.isArray(c)) continue
      if (c[0] === 'fillText') out.push(c)
      const nested = c[c.length - 1]
      if (c[0] === 'drawImage' && Array.isArray(nested)) walk(nested)
    }
  }
  walk(expandLog(log, g.images))
  return out
}

/** every fillText string reachable from a painter log */
const textsIn = (log: Call[], g: FakeGraphics): string[] => fillTextsIn(log, g).map((c) => String(c[1]))

/** the texts of still page k, drawn by drawPage (the page layer carries everything but the background) */
function pageTexts(scene: Built, g: FakeGraphics, k: number, size: { width: number; height: number }): string[] {
  const p = new RecordingPainter(size.width, size.height)
  scene.drawPage(p, k)
  return textsIn(p.log, g)
}

const gold = (x: unknown) => JSON.stringify(x).split('"#F3C85A"').length - 1
const inkChars = (s: string) => s.replace(/ /g, '').length // fake font: one glyph per UTF-16 unit, spaces have no ink

const inside = (r: Rect, frame: { width: number; height: number }) =>
  r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= frame.width + 0.5 && r.y + r.h <= frame.height + 0.5
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5

afterEach(() => {
  vi.restoreAllMocks()
})

describe('determinism', () => {
  it('same inputs → the same calls, twice on one scene and across two scenes', () => {
    const model = makeModel([syntheticAyah(1, 12), syntheticAyah(2, 9)])
    model.timeline = fakeTimeline(model)
    const design = makeDesign({ highlightWords: true, showTajweed: true })
    const a = render(model, design, 2600)
    const b = render(model, design, 2600)
    expect(b.expanded).toEqual(a.expanded)
    const again = new RecordingPainter(540, 960)
    a.scene.draw(again, 2600)
    expect(expandLog(again.log, a.graphics.images)).toEqual(a.expanded)
  })

  it('still pages are deterministic too, built in any order', () => {
    const model = makeModel([syntheticAyah(282, 128, 5)], {
      tafsir: [{ ayahFrom: 282, ayahTo: 282, text: 'كلمة '.repeat(400) }],
      tafsirSource: tafsirSource(),
    })
    const design = makeDesign({ aspect: '1:1', showTafsir: true })
    const size = { width: 540, height: 540 }
    const one = buildScene(model, design, assets(), size, { width: 1080, height: 1080 })
    const two = buildScene(model, design, assets(), size, { width: 1080, height: 1080 })
    expect(one.pageCount).toBeGreaterThan(2)
    const draw = (s: Built, k: number) => {
      const p = new RecordingPainter(540, 540)
      s.drawPage(p, k)
      return p.log.filter((c) => c[0] !== 'drawImage').length + p.log.length
    }
    const forward = Array.from({ length: one.pageCount }, (_, k) => draw(one, k))
    const backward = Array.from({ length: two.pageCount }, (_, k) => draw(two, two.pageCount - 1 - k)).reverse()
    expect(backward).toEqual(forward)
  })

  it('never reads the clock or Math.random', () => {
    const rnd = vi.spyOn(Math, 'random')
    const now = vi.spyOn(Date, 'now')
    const model = makeModel([syntheticAyah(1, 8)])
    model.timeline = fakeTimeline(model)
    for (const b of BACKGROUND_PRESETS) render(model, makeDesign({ background: { kind: 'preset', id: b.id } }), 1000)
    expect(rnd).not.toHaveBeenCalled()
    expect(now).not.toHaveBeenCalled()
  })
})

describe('highlight', () => {
  const model = makeModel([syntheticAyah(1, 6)])
  model.timeline = fakeTimeline(model, { wordMs: 500, gapMs: 400 })

  const goldFills = (log: unknown[]) => log.filter((c) => Array.isArray(c) && c[0] === 'fillPath' && c[2] === '#F3C85A')

  it('paints the recited word in gold while it is being recited', () => {
    const on = render(model, makeDesign({ highlightWords: true }), 1250) // word 3 (1000–1460)
    const fills = goldFills(on.painter.log)
    // fake font: one glyph per letter, 4 letters per word
    expect(fills).toHaveLength(4)
    const off = render(model, makeDesign({ highlightWords: false }), 1250)
    expect(goldFills(off.painter.log)).toHaveLength(0)
  })

  it('keeps tajweed colours and uses a gold band when tajweed is on', () => {
    const r = render(model, makeDesign({ highlightWords: true, showTajweed: true }), 1250)
    expect(goldFills(r.painter.log)).toHaveLength(0)
    expect(r.painter.log.some((c) => c[0] === 'fillRoundRect')).toBe(true)
  })

  it('dims the other ayahs when there are no word timings', () => {
    const m = makeModel([syntheticAyah(1, 5), syntheticAyah(2, 5)])
    m.timeline = fakeTimeline(m, { words: false })
    const r = render(m, makeDesign({ highlightWords: true }), m.timeline.ayahs[1].startMs + 100)
    // a dim pass of the page, then the current ayah copied back at full strength through src rects
    expect(r.painter.log.some((c) => c[0] === 'alpha' && c[1] === 0.36)).toBe(true)
    const copies = r.painter.log.filter((c) => c[0] === 'drawImage' && c[6] !== null)
    expect(copies.length).toBeGreaterThan(0)
  })
})

describe('basmala and isti’adha (RenderModel.basmala / istiadha, no inference)', () => {
  it('a video draws the basmala when the model says so and turns it gold while it is recited', () => {
    const model = makeModel([syntheticAyah(1, 4), syntheticAyah(2, 4)], { basmala: true })
    model.timeline = fakeTimeline(model, { basmalaMs: 3000 })
    const during = render(model, makeDesign({ highlightWords: true }), 1500)
    expect(gold(during.expanded)).toBe(inkChars(BASMALA))
    const firstWord = model.timeline.words[0]
    const after = render(model, makeDesign({ highlightWords: true }), firstWord.startMs + 50)
    expect(gold(after.expanded)).toBe(4) // only the recited word (4 letters)
    // it heads the text block
    const layout = layoutOf(during.scene)
    expect(layout.basmala).not.toBeNull()
    expect(layout.basmala!.y + layout.basmala!.h).toBeLessThanOrEqual(layout.quranZone.y)
    // the timeline alone does not draw it: the model decides
    const off = makeModel(model.ayahs, { basmala: false, timeline: model.timeline })
    expect(layoutOf(render(off, makeDesign(), 100).scene).basmala).toBeNull()
  })

  it('a still draws exactly what the model says (no surah-start inference)', () => {
    const basmalaOf = (m: RenderModel) => layoutOf(render(m, makeDesign(), 0).scene).basmala
    expect(basmalaOf(makeModel([syntheticAyah(1, 4)]))).toBeNull() // al-Baqarah 1, but the UI did not ask
    expect(basmalaOf(makeModel([syntheticAyah(1, 4)], { basmala: true }))).not.toBeNull()
    expect(basmalaOf(makeModel([syntheticAyah(30, 4)], { basmala: true }))).not.toBeNull() // mid-surah start, chosen
  })

  it('stays bright while recited and dims with the ayahs afterwards (ayah timings only)', () => {
    const m = makeModel([syntheticAyah(1, 4), syntheticAyah(2, 4)], { basmala: true })
    m.timeline = fakeTimeline(m, { basmalaMs: 3000, words: false })
    const dims = (t: number) => render(m, makeDesign({ highlightWords: true }), t).painter.log.filter((c) => c[0] === 'alpha' && c[1] === 0.36).length
    expect(dims(1500)).toBe(1) // the page only
    expect(dims(m.timeline.ayahs[1].startMs + 100)).toBe(2) // page + basmala
  })

  it('a still puts the isti’adha first, smaller, above the basmala', () => {
    const m = makeModel([syntheticAyah(1, 4)], { basmala: true, istiadha: true })
    const r = render(m, makeDesign(), 0)
    const { istiadha, basmala, quranZone } = layoutOf(r.scene)
    expect(istiadha).not.toBeNull()
    expect(istiadha!.y + istiadha!.h).toBeLessThanOrEqual(basmala!.y + 0.5)
    expect(basmala!.y + basmala!.h).toBeLessThanOrEqual(quranZone.y + 0.5)
    expect(istiadha!.h).toBeLessThan(basmala!.h)
  })

  it('a video shows the isti’adha only while it is recited (timeline ayah -1), then the basmala in its place', () => {
    const m = makeModel([syntheticAyah(1, 4), syntheticAyah(2, 4)], { basmala: true, istiadha: true })
    m.timeline = fakeTimeline(m, { istiadhaMs: 4000, basmalaMs: 3000 })
    const design = makeDesign({ highlightWords: true })
    // while recited: the isti'adha in gold, the basmala hidden
    expect(gold(render(m, design, 2000).expanded)).toBe(inkChars(ISTIADHA))
    // during the basmala: only the basmala is gold
    const basmalaWin = m.timeline.ayahs.find((a) => a.ayah === 0)!
    expect(gold(render(m, design, basmalaWin.startMs + 1000).expanded)).toBe(inkChars(BASMALA))
    // during the ayahs the isti'adha is gone: the same glyph fills as a model that never had it
    const fills = (model: RenderModel, t: number) => JSON.stringify(render(model, design, t).expanded).split('"fillPath"').length
    const without = { ...m, istiadha: false }
    const t = m.timeline.words[2].startMs + 50
    expect(fills(m, t)).toBe(fills(without, t))
    expect(fills(m, 2000)).not.toBe(fills(without, 2000))
    // one opening slot on a video: the layout is the same with or without it
    expect(layoutOf(render(m, design, 0).scene).quranZone).toEqual(layoutOf(render(without, design, 0).scene).quranZone)
  })

  it('a video without an isti’adha window does not draw it', () => {
    const m = makeModel([syntheticAyah(1, 4)], { istiadha: true })
    m.timeline = fakeTimeline(m)
    expect(layoutOf(render(m, makeDesign(), 100).scene).istiadha).toBeNull()
  })
})

describe('reference line (D5)', () => {
  const m = (from: number, to: number, partialStart = false, partialEnd = false) =>
    makeModel(
      Array.from({ length: to - from + 1 }, (_, i) => syntheticAyah(from + i, 3)),
      { partialStart, partialEnd },
    )

  it('says «جزء من الآية» when the first or last ayah is partial', () => {
    expect(referenceLabel(m(255, 255))).toBe('الآية ٢٥٥')
    expect(referenceLabel(m(43, 43, false, true))).toBe('جزء من الآية ٤٣')
    expect(referenceLabel(m(43, 43, true, false))).toBe('جزء من الآية ٤٣')
    expect(referenceLabel(m(1, 7))).toBe('الآيات ١–٧')
    expect(referenceLabel(m(41, 43, false, true))).toBe('من الآية ٤١ إلى جزء من الآية ٤٣')
    expect(referenceLabel(m(41, 43, true, false))).toBe('من جزء من الآية ٤١ إلى الآية ٤٣')
    expect(referenceLabel(m(41, 43, true, true))).toBe('من جزء من الآية ٤١ إلى جزء من الآية ٤٣')
  })

  it('is the header subtitle, or part of the credits when the header is off', () => {
    const partial = m(43, 43, false, true)
    const a = assets()
    const withHeader = buildScene(partial, makeDesign(), a, { width: 540, height: 960 }, { width: 1080, height: 1920 })
    expect(pageTexts(withHeader, a.graphics, 0, { width: 540, height: 960 })).toContain('جزء من الآية ٤٣')
    const b = assets()
    const noHeader = buildScene(partial, makeDesign({ showSurahHeader: false }), b, { width: 540, height: 960 }, { width: 1080, height: 1920 })
    expect(pageTexts(noHeader, b.graphics, 0, { width: 540, height: 960 }).join('\n')).toContain('البقرة — جزء من الآية ٤٣')
  })
})

describe('credits (00-gaps §6.2)', () => {
  const texts = (r: ReturnType<typeof render>) => textsIn(r.painter.log, r.graphics).join('\n')

  it('a still credits Quran.com / Quran Foundation; a video adds the reciter, the riwayah and the audio source', () => {
    const m = makeModel([syntheticAyah(1, 4)], { reciter: reciter() })
    const still = texts(render(m, makeDesign(), 0))
    expect(still).toContain('Quran.com / Quran Foundation')
    expect(still).not.toContain('القارئ')
    expect(still).not.toContain('EveryAyah.com')
    m.timeline = fakeTimeline(m)
    const video = texts(render(m, makeDesign(), 100))
    expect(video).toContain('القارئ القارئ التجريبي')
    expect(video).toContain('رواية حفص عن عاصم')
    expect(video).toContain('EveryAyah.com')
    expect(video.match(/Quran\.com/g)).toHaveLength(1)
  })

  it('a video credits the reciter even when the name toggle is off (QF Developer Terms)', () => {
    const m = makeModel([syntheticAyah(1, 4)], { reciter: reciter() })
    m.timeline = fakeTimeline(m)
    expect(texts(render(m, makeDesign({ showReciterName: false }), 100))).toContain('القارئ التجريبي')
  })

  it('wraps a long credit line between parts, never inside a name or a licence', () => {
    const m = makeModel([syntheticAyah(1, 4)], {
      reciter: reciter({ nameAr: 'عبد الرحمن بن عبد العزيز السديس', sourceName: 'EveryAyah.com · Quran.com · quran-align (CC BY 4.0)' }),
      translation: [{ ayah: 1, text: 'In the name of Allah.' }],
      translationSource: translationSource(),
    })
    m.timeline = fakeTimeline(m)
    const r = render(m, makeDesign({ aspect: '4:5', showTranslation: true, showWatermark: true }), 100, { width: 1080, height: 1350 })
    const lines = textsIn(r.painter.log, r.graphics).filter((t) => t.includes('Quran.com') || t.includes('EveryAyah.com') || t.includes('القارئ'))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const parts = lines.flatMap((l) => l.split('  ·  '))
    expect(parts).toEqual([
      'القارئ عبد الرحمن بن عبد العزيز السديس',
      'رواية حفص عن عاصم',
      'Saheeh International',
      'EveryAyah.com',
      'quran-align (CC BY 4.0)',
      'Quran.com / Quran Foundation',
    ])
  })

  it('marks the translation of a partly selected ayah as the full verse', () => {
    const m = makeModel([syntheticAyah(43, 7)], {
      partialEnd: true,
      translation: [{ ayah: 43, text: 'O you who have believed, do not approach prayer.' }],
      translationSource: translationSource(),
    })
    expect(texts(render(m, makeDesign({ showTranslation: true }), 0))).toContain('(full verse) O you')
    m.partialEnd = false
    expect(texts(render(m, makeDesign({ showTranslation: true }), 0))).not.toContain('full verse')
  })

  it('the tafsir card credits the provider that served the text (tafsirCreditAr), in full', () => {
    const credit = 'المختصر في تفسير القرآن الكريم — مركز تفسير للدراسات القرآنية — QuranEnc.com (الإصدار 1.0.3)'
    const base = { tafsir: [{ ayahFrom: 1, ayahTo: 1, text: 'تفسير قصير.' }], tafsirSource: tafsirSource() }
    const served = texts(render(makeModel([syntheticAyah(1, 4)], { ...base, tafsirCreditAr: credit }), makeDesign({ showTafsir: true }), 0))
    // wrapped at word boundaries, nothing dropped
    expect(served.replace(/\s+/g, ' ')).toContain('QuranEnc.com (الإصدار 1.0.3)')
    expect(served).not.toContain('مركز تفسير · QuranEnc.com')
    const fallback = texts(render(makeModel([syntheticAyah(1, 4)], base), makeDesign({ showTafsir: true }), 0))
    expect(fallback).toContain('مركز تفسير · QuranEnc.com')
  })
})

describe('tajweed colours in the page layer', () => {
  it('fills a rule span with the dark-background palette on light text', () => {
    const m = makeModel([ayah(1, [word(1, 'قطب', { tajweed: [{ start: 1, end: 2, rule: 'qalaqah' }] })])], { rules: ['qalaqah'] })
    const r = render(m, makeDesign({ showTajweed: true, showRulesLegend: true }), 0)
    const all = JSON.stringify(r.expanded)
    expect(all).toContain('#00DEFF')
    // legend text uses the rule name
    expect(textsIn(r.painter.log, r.graphics).some((t) => t.includes('القلقلة'))).toBe(true)
  })
})

describe('still pages: paged, never truncated (C13, D6, D3)', () => {
  const ref1 = { width: 1080, height: 1080 }
  const size1 = { width: 540, height: 540 }

  it('one page when everything fits; no page indicator', () => {
    const m = makeModel([syntheticAyah(1, 8)], { tafsir: [{ ayahFrom: 1, ayahTo: 1, text: 'تفسير قصير جدا.' }], tafsirSource: tafsirSource() })
    const a = assets()
    const s = buildScene(m, makeDesign({ showTafsir: true }), a, { width: 540, height: 960 }, { width: 1080, height: 1920 })
    expect(s.pageCount).toBe(1)
    expect(s.layout.plan).toBe('one')
    const texts = pageTexts(s, a.graphics, 0, { width: 540, height: 960 })
    expect(texts.some((t) => /^[٠-٩]+ \/ [٠-٩]+$/.test(t))).toBe(false)
    expect(texts.some((t) => t.includes('يتبع'))).toBe(false)
  })

  it('pages a long tafsir: every line once, in order, no ellipsis; indicator, hint, header and credits on the pages', () => {
    const words = Array.from({ length: 900 }, (_, i) => `كلمة${i}`)
    const m = makeModel([syntheticAyah(255, 20)], { tafsir: [{ ayahFrom: 255, ayahTo: 255, text: words.join(' ') }], tafsirSource: tafsirSource() })
    const a = assets()
    const s = buildScene(m, makeDesign({ aspect: '1:1', showTafsir: true }), a, size1, ref1)
    expect(s.pageCount).toBeGreaterThan(2)
    const pages = Array.from({ length: s.pageCount }, (_, k) => pageTexts(s, a.graphics, k, size1))
    const shown: string[] = []
    pages.forEach((texts, k) => {
      expect(texts).toContain(pageIndicator(k, s.pageCount))
      expect(texts.includes('يتبع ←')).toBe(k < s.pageCount - 1)
      expect(texts).toContain('سورة البقرة')
      expect(texts).toContain('الآية ٢٥٥')
      expect(texts.some((t) => t.includes('Quran.com / Quran Foundation'))).toBe(true)
      for (const t of texts) expect(t.includes('…')).toBe(false)
      shown.push(...texts.filter((t) => /كلمة\d/.test(t)))
    })
    expect(shown.join(' ').split(' ')).toEqual(words)
    // continuation cards say so; the Quran text is on page 1 only
    expect(pages[1]).toContain('تابع')
    expect(s.layout.stills.filter((p) => p.quranPage !== null)).toHaveLength(1)
  })

  it('pages the Quran text when it does not fit at the minimum size; every word once', () => {
    const m = makeModel([syntheticAyah(282, 128, 5)])
    const a = assets()
    const s = buildScene(m, makeDesign({ aspect: '1:1' }), a, size1, ref1)
    expect(s.layout.plan).toBe('quran-paged')
    expect(s.pageCount).toBe(s.layout.pages.length)
    expect(s.pageCount).toBeGreaterThan(1)
    const placed = s.layout.pages.flatMap((p) => p.placed.map((u) => u.unit.position))
    expect(placed.filter((x) => x > 0)).toEqual(Array.from({ length: 128 }, (_, i) => i + 1))
    // each page's glyphs are drawn on that page only
    const glyphFills = (k: number) => {
      const p = new RecordingPainter(540, 540)
      s.drawPage(p, k)
      return JSON.stringify(expandLog(p.log, a.graphics.images)).split('"fillPath"').length - 1
    }
    const perPage = s.layout.pages.map((pl) => pl.placed.reduce((n, u) => n + u.unit.glyphs.length, 0))
    const frameFills = Array.from({ length: s.pageCount }, (_, k) => glyphFills(k))
    // fills also include the header ornaments (same on every page; no halo without a photo) → the differences
    // between pages are the differences in glyphs
    for (let k = 1; k < s.pageCount; k++) expect(frameFills[k] - frameFills[0]).toBe(perPage[k] - perPage[0])
  })

  it('pages that read top to bottom inside the frame: no overlaps, nothing over the pager, legend or credits', () => {
    const m = makeModel([syntheticAyah(255, 60)], {
      translation: [{ ayah: 255, text: 'Allah - there is no deity except Him, the Ever-Living, the Self-Sustaining. '.repeat(8) }],
      translationSource: translationSource(),
      tafsir: [{ ayahFrom: 255, ayahTo: 255, text: 'الله الذي لا إله يعبد بحق إلا هو '.repeat(60) }],
      tafsirSource: tafsirSource(),
      rules: ['ghunnah', 'qalaqah'],
    })
    for (const aspect of ['9:16', '4:5', '1:1', '16:9'] as const) {
      const ref = { '9:16': { width: 1080, height: 1920 }, '4:5': { width: 1080, height: 1350 }, '1:1': { width: 1080, height: 1080 }, '16:9': { width: 1920, height: 1080 } }[aspect]
      const s = buildScene(m, makeDesign({ aspect, showTranslation: true, showTafsir: true, showTajweed: true, showRulesLegend: true }), assets(), ref, ref)
      expect(s.pageCount).toBeGreaterThan(1)
      let trLines = 0
      let tfLines = 0
      for (const p of s.layout.stills) {
        const zones = [p.istiadha, p.basmala, p.quranZone, p.translationZone, p.tafsirCard].filter((z): z is Rect => z !== null)
        for (const z of zones) expect(inside(z, ref), `${aspect} ${JSON.stringify(z)}`).toBe(true)
        // legend, pager and credits live below the content region
        for (const z of zones) expect(z.y + z.h, aspect).toBeLessThanOrEqual(p.contentBottom + 0.5)
        for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) expect(overlaps(zones[i], zones[j]), aspect).toBe(false)
        if (p.quranZone && p.translationZone) expect(p.quranZone.y + p.quranZone.h).toBeLessThanOrEqual(p.translationZone.y + 0.5)
        if (aspect !== '16:9' && p.translationZone && p.tafsirCard) expect(p.translationZone.y + p.translationZone.h).toBeLessThanOrEqual(p.tafsirCard.y + 0.5)
        if (p.translationLines) trLines += p.translationLines[1] - p.translationLines[0]
        if (p.tafsirLines) tfLines += p.tafsirLines[1] - p.tafsirLines[0]
      }
      // the 16:9 card sits beside the text, on the left (the RTL end side)
      if (aspect === '16:9') {
        const p0 = s.layout.stills[0]
        if (p0.tafsirCard && p0.quranZone) expect(p0.tafsirCard.x + p0.tafsirCard.w).toBeLessThan(p0.quranZone.x)
      }
      expect(trLines).toBeGreaterThan(0)
      expect(tfLines).toBeGreaterThan(0)
    }
  })

  it('quran-first: page 1 holds the whole translation (+ the tafsir start when it fits); no lone line runs over', () => {
    const ayahs = [1, 2, 3, 4].map((n) => syntheticAyah(n, 9))
    const base = {
      basmala: true,
      istiadha: true,
      translation: ayahs.map((a) => ({ ayah: a.number, text: 'A short verse in translation.' })),
      translationSource: translationSource(),
      tafsirSource: tafsirSource(),
    }
    let quranFirst = 0
    let withTafsir = 0
    for (const words of [60, 200, 400, 800]) {
      for (const aspect of ['9:16', '4:5', '1:1'] as const) {
        const ref = { '9:16': { width: 1080, height: 1920 }, '4:5': { width: 1080, height: 1350 }, '1:1': { width: 1080, height: 1080 } }[aspect]
        const m = makeModel(ayahs, { ...base, tafsir: [{ ayahFrom: 1, ayahTo: 4, text: 'كلمة '.repeat(words) }] })
        const s = buildScene(m, makeDesign({ aspect, showTranslation: true, showTafsir: true }), assets(), ref, ref)
        const name = `${aspect} ${words} ${s.layout.plan}`
        // a block that runs over to the next page takes two lines or more there (no widow)
        for (const p of s.layout.stills) {
          for (const r of [p.translationLines, p.tafsirLines]) if (r && r[0] > 0) expect(r[1] - r[0], name).toBeGreaterThanOrEqual(2)
        }
        if (s.layout.plan !== 'quran-first') continue
        quranFirst++
        const p0 = s.layout.stills[0]
        const trTotal = s.layout.stills.reduce((n, p) => n + (p.translationLines ? p.translationLines[1] - p.translationLines[0] : 0), 0)
        // the translation is whole on page 1 (never a fragment); a tafsir card under it starts with three lines or more
        expect(p0.translationLines, name).toEqual([0, trTotal])
        if (p0.tafsirLines) {
          expect(p0.tafsirLines[1] - p0.tafsirLines[0], name).toBeGreaterThanOrEqual(3)
          withTafsir++
        }
      }
    }
    expect(quranFirst).toBeGreaterThan(withTafsir)
    expect(withTafsir).toBeGreaterThan(0)
  })

  it('the page indicator keeps one place on every page, with or without the legend above it', () => {
    const m = makeModel([syntheticAyah(255, 60)], {
      rules: ['ghunnah', 'qalaqah'],
      tafsir: [{ ayahFrom: 255, ayahTo: 255, text: 'كلمة '.repeat(500) }],
      tafsirSource: tafsirSource(),
    })
    const a = assets()
    const s = buildScene(m, makeDesign({ aspect: '1:1', showTafsir: true, showTajweed: true, showRulesLegend: true }), a, size1, ref1)
    expect(s.pageCount).toBeGreaterThan(1)
    expect(s.layout.stills.some((p) => p.legend)).toBe(true)
    expect(s.layout.stills.some((p) => !p.legend)).toBe(true)
    const ys = new Set<unknown>()
    for (let k = 0; k < s.pageCount; k++) {
      const p = new RecordingPainter(540, 540)
      s.drawPage(p, k)
      const calls = fillTextsIn(p.log, a.graphics).filter((c) => c[1] === pageIndicator(k, s.pageCount))
      expect(calls).toHaveLength(1)
      ys.add(calls[0][3])
    }
    expect(ys.size).toBe(1)
  })

  it('16:9 two columns: a card alone on its page is centred; the Quran stays on page 1', () => {
    const m = makeModel([syntheticAyah(1, 6)], { tafsir: [{ ayahFrom: 1, ayahTo: 1, text: 'تفسير '.repeat(700) }], tafsirSource: tafsirSource() })
    const ref = { width: 1920, height: 1080 }
    const s = buildScene(m, makeDesign({ aspect: '16:9', showTafsir: true }), assets(), ref, ref)
    expect(s.pageCount).toBeGreaterThan(1)
    expect(s.layout.stills[0].quranZone).not.toBeNull()
    const last = s.layout.stills[s.pageCount - 1]
    expect(last.quranZone).toBeNull()
    expect(last.tafsirCard!.x + last.tafsirCard!.w / 2).toBeCloseTo(960, 0)
  })

  it('draw() of a still is page 1; drawPage clamps its index', () => {
    const m = makeModel([syntheticAyah(282, 128, 5)])
    const a = assets()
    const s = buildScene(m, makeDesign({ aspect: '1:1' }), a, size1, ref1)
    const log = (f: (p: RecordingPainter) => void) => {
      const p = new RecordingPainter(540, 540)
      f(p)
      return expandLog(p.log, a.graphics.images)
    }
    expect(log((p) => s.draw(p, 12345))).toEqual(log((p) => s.drawPage(p, 0)))
    expect(log((p) => s.drawPage(p, 99))).toEqual(log((p) => s.drawPage(p, s.pageCount - 1)))
    expect(log((p) => s.drawPage(p, -3))).toEqual(log((p) => s.drawPage(p, 0)))
  })

  it('draws a smaller preview with the same layout scaled', () => {
    const m = makeModel([syntheticAyah(1, 10)])
    const full = buildScene(m, makeDesign(), assets(), { width: 1080, height: 1920 }, { width: 1080, height: 1920 })
    const small = buildScene(m, makeDesign(), assets(), { width: 360, height: 640 }, { width: 1080, height: 1920 })
    expect(small.layout.size).toBe(full.layout.size)
    expect(small.layout.pages[0].placed.map((p) => p.x)).toEqual(full.layout.pages[0].placed.map((p) => p.x))
    expect(full.pageCount).toBe(1)
  })
})

describe('video: one page; translation and tafsir in sync with the recitation, never cut', () => {
  const ref = { width: 1080, height: 1920 }

  it('a video switches Quran page at the start time of the page’s first word', () => {
    const m = makeModel([syntheticAyah(282, 128, 5)])
    m.timeline = fakeTimeline(m, { wordMs: 400 })
    const a = assets()
    const scene = buildScene(m, makeDesign({ aspect: '1:1' }), a, { width: 540, height: 540 }, { width: 1080, height: 1080 })
    expect(scene.pageCount).toBe(1)
    expect(scene.layout.pages.length).toBeGreaterThan(1)
    const p1 = scene.layout.pages[1]
    const firstWord = p1.placed[0].unit
    const tw = m.timeline.words.find((w) => w.ayah === firstWord.ayah && w.word === firstWord.position)!
    expect(p1.startMs).toBe(tw.startMs)
    const drawn = (t: number) => {
      const p = new RecordingPainter(540, 540)
      scene.draw(p, t)
      return p.log.filter((c) => c[0] === 'drawImage').map((c) => c[1])
    }
    expect(drawn(p1.startMs - 1000)).not.toEqual(drawn(p1.startMs + 1000))
  })

  // 40 words × 500 ms: a 20 s ayah, long enough for a slow scroll to show a few lines more than the card holds
  const tafsirModel = (words: number, ayahWords = 40) => {
    const m = makeModel([syntheticAyah(1, ayahWords), syntheticAyah(2, ayahWords)], {
      tafsir: [
        { ayahFrom: 1, ayahTo: 1, text: Array.from({ length: words }, (_, i) => `ت${i}`).join(' ') },
        { ayahFrom: 2, ayahTo: 2, text: 'قصير.' },
      ],
      tafsirSource: tafsirSource(),
    })
    m.timeline = fakeTimeline(m, { wordMs: 500 })
    return m
  }

  it('static when it fits, a slow scroll when that shows it all, else pages', () => {
    const modes = (words: number) => buildScene(tafsirModel(words), makeDesign({ showTafsir: true }), assets(), ref, ref).layout.timed.filter((x) => x.kind === 'tafsir')
    expect(modes(4)[0].mode).toBe('static')
    expect(modes(4)[1].mode).toBe('static')
    expect(modes(180)[0].mode).toBe('scroll')
    const long = modes(1500)[0]
    expect(long.mode).toBe('pages')
    expect(long.pages).toBeGreaterThan(2)
    // more text never goes back to an easier mode
    const order = { static: 0, scroll: 1, pages: 2 }
    const seq = [4, 40, 100, 140, 180, 220, 300, 600, 1500].map((n) => order[modes(n)[0].mode])
    expect([...seq].sort((a, b) => a - b)).toEqual(seq)
  })

  it('a short page slot still shows each page fully (the crossfade never eats the slot)', () => {
    const m = tafsirModel(1500, 8) // 4 s ayah, many pages
    const a = assets()
    const s = buildScene(m, makeDesign({ showTafsir: true }), a, ref, ref)
    const info = s.layout.timed.find((x) => x.kind === 'tafsir')!
    expect(info.pages).toBeGreaterThan(8)
    const step = (info.end - info.start) / info.pages
    const p = new RecordingPainter(1080, 1920)
    s.draw(p, info.start + step * 2.5)
    const slices = p.log.filter((c) => c[0] === 'drawImage' && c[6] !== null)
    expect(slices).toHaveLength(1)
  })

  it('pages switch evenly across the ayah’s recitation, each page’s lines shown whole', () => {
    const m = tafsirModel(1500)
    const a = assets()
    const s = buildScene(m, makeDesign({ showTafsir: true }), a, ref, ref)
    const info = s.layout.timed.find((x) => x.kind === 'tafsir')!
    expect(info.start).toBe(m.timeline!.ayahs[0].startMs)
    expect(info.end).toBe(m.timeline!.ayahs[0].endMs)
    const shownAt = (t: number) => {
      const p = new RecordingPainter(1080, 1920)
      s.draw(p, t)
      return textsIn(p.log, a.graphics).filter((x) => /ت\d/.test(x))
    }
    const step = (info.end - info.start) / info.pages
    const seen: string[] = []
    for (let i = 0; i < info.pages; i++) {
      const lines = shownAt(info.start + step * (i + 0.5))
      expect(lines.length).toBeGreaterThan(0)
      seen.push(...lines)
    }
    // all of the text, in order, across the pages; nothing cut
    const all = seen.join(' ').split(' ')
    expect(all).toEqual(Array.from({ length: 1500 }, (_, i) => `ت${i}`))
  })

  it('a long translation pages the same way (never “…”)', () => {
    const m = makeModel([syntheticAyah(1, 6)], {
      translation: [{ ayah: 1, text: 'word '.repeat(600).trim() }],
      translationSource: translationSource(),
    })
    m.timeline = fakeTimeline(m)
    const a = assets()
    const s = buildScene(m, makeDesign({ showTranslation: true }), a, ref, ref)
    expect(s.layout.timed[0]).toMatchObject({ kind: 'translation', mode: 'pages' })
    const p = new RecordingPainter(1080, 1920)
    s.draw(p, 100)
    expect(textsIn(p.log, a.graphics).some((t) => t.includes('…'))).toBe(false)
  })
})

describe('translation fonts (Noto per script, 00-gaps §6.4)', () => {
  const families = (script: string) => {
    const m = makeModel([syntheticAyah(1, 4)], {
      translation: [{ ayah: 1, text: 'ބިސްމި ﷲ' }],
      translationSource: translationSource({ lang: 'dv', script, dir: script === 'Thaa' || script === 'Arab' ? 'rtl' : 'ltr' }),
    })
    const r = render(m, makeDesign({ showTranslation: true }), 0)
    const out = new Set<string>()
    const walk = (calls: unknown[]) => {
      for (const c of calls) {
        if (!Array.isArray(c)) continue
        if (c[0] === 'fillText' && c[1] === 'ބިސްމި ﷲ') out.add(String(c[4]))
        const nested = c[c.length - 1]
        if (c[0] === 'drawImage' && Array.isArray(nested)) walk(nested)
      }
    }
    walk(r.expanded)
    return [...out]
  }

  it('draws a translation with its script’s Noto family, the UI font for an unknown script', () => {
    expect(families('Thaa')).toEqual(['Noto Sans Thaana'])
    expect(families('Arab')).toEqual(['Noto Naskh Arabic'])
    expect(families('Cyrl')).toEqual(['Noto Sans'])
    expect(families('Beng')).toEqual(['Noto Sans Bengali'])
    expect(families('Zzzz')).toEqual(['ReadexPro'])
  })
})

describe('backgrounds', () => {
  it('every preset fills the frame first and draws the same calls every time', () => {
    expect(BACKGROUND_PRESETS.length).toBeGreaterThanOrEqual(8)
    expect(BACKGROUND_PRESETS[0].id).toBe('lapis-night')
    for (const b of BACKGROUND_PRESETS) {
      const p1 = new RecordingPainter(1080, 1920)
      const p2 = new RecordingPainter(1080, 1920)
      b.draw(p1, fakeGraphics(), 1080, 1920)
      b.draw(p2, fakeGraphics(), 1080, 1920)
      expect(p1.log).toEqual(p2.log)
      expect(p1.log[0].slice(0, 5)).toEqual(['fillRect', 0, 0, 1080, 1920])
    }
  })

  it('cover-fits around the focal point', () => {
    // 2000×1000 photo into a 9:16 frame: crop is 562.5 wide, centred on x = 0.25 × 2000
    const c = coverCrop(2000, 1000, 1080, 1920, 0.25, 0.5)
    expect(c.h).toBe(1000)
    expect(c.w).toBeCloseTo(562.5, 5)
    expect(c.x).toBeCloseTo(500 - 562.5 / 2, 5)
    // clamped at the image edge
    expect(coverCrop(2000, 1000, 1080, 1920, 0, 0.5).x).toBe(0)
  })

  it('blurs by halving then doubling through surfaces (no filters)', () => {
    const g = fakeGraphics()
    const src = g.createSurface(1080, 1920).snapshot()
    blurByResampling(g, src, 1080, 1920, 3)
    const sizes = g.surfaces.slice(1).map((s) => [s.width, s.height])
    expect(sizes).toEqual([
      [540, 960],
      [270, 480],
      [135, 240],
      [270, 480],
      [540, 960],
      [1080, 1920],
    ])
    const p = new RecordingPainter(1080, 1920)
    drawImageBackground(p, g, { kind: 'image', width: 4000, height: 3000 } as never, 1080, 1920, 0.5, 0.5, 12)
    expect(p.log).toHaveLength(1)
    expect(p.log[0][0]).toBe('drawImage')
  })
})
