// Real HarfBuzz (vendored harfbuzzjs wasm) + the bundled Amiri Quran TTF, read from disk — no network. Real words
// come from the committed passages fixture (testing/passages.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { QuranFont } from './index'
import { createHarfBuzzQuranFont } from './hbFont'
import { BASMALA, ISTIADHA, breakLines, buildUnits, inkExtents, splitPauseMarks } from './layout'
import { charRules, glyphRules } from './tajweed'
import { ayah, makeModel, word } from './testing/fakes'
import { allPassageWords, passage, PASSAGE_KEYS } from './testing/passages'

type Fs = { readFileSync(p: URL): Uint8Array }
const g = globalThis as unknown as { location?: { href: string } }
const hadLocation = 'location' in g
let font: QuranFont

beforeAll(async () => {
  const fs = (await import('node:fs' as string)) as Fs
  // the vendored loader derives a base URL from location.href when running under Node
  if (!hadLocation) g.location = { href: new URL('../vendor/harfbuzzjs/harfbuzz.js', import.meta.url).href }
  const hb = await import('../vendor/harfbuzzjs/index.mjs')
  const wasm = fs.readFileSync(new URL('../../public/harfbuzz.wasm', import.meta.url))
  await hb.loadHarfBuzz({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer })
  font = createHarfBuzzQuranFont(hb, fs.readFileSync(new URL('../../assets/fonts/AmiriQuran-Regular.ttf', import.meta.url)))
})

afterAll(() => {
  if (!hadLocation) delete g.location
})

/** gid of a lone mark (the small meems keep theirs in context — 00-gaps §2.2; tanween do not, see below) */
const gidOf = (ch: string) => font.shape(ch).glyphs.find((x) => font.glyphSvg(x.gid))?.gid ?? -1
const SMALL_MEEM = /[ۭۢ]/g

describe('Amiri Quran through HarfBuzz', () => {
  it('reads metrics and the space advance', () => {
    expect(font.upem).toBe(1000)
    expect(font.ascender).toBeGreaterThan(1000)
    expect(font.descender).toBeLessThan(0)
    expect(font.shape(' ').advance).toBeGreaterThan(0)
  })

  it('shapes the ayah number LTR into the ornament with the digits on top', () => {
    const run = font.shape('۝٢٥٥', 'ltr')
    expect(run.glyphs[0].cluster).toBe(0)
    expect(run.glyphs[0].xAdvance).toBeGreaterThan(800) // the ornament carries the advance
    expect(run.glyphs.slice(1).every((x) => x.xAdvance === 0)).toBe(true)
    // digits in reading order (clusters 1, 2, 3 left → right)
    expect(run.glyphs.slice(1).map((x) => x.cluster)).toEqual([1, 2, 3])
  })

  it('cluster level CHARACTERS: every mark its own cluster, glyphs still in visual order', () => {
    const text = passage('1:1-7')[0].words[2].text // «ٱلرَّحۡمَٰنِ» as QPC writes it (shadda before fatha)
    expect(text.length).toBe(12)
    const run = font.shape(text)
    const clusters = run.glyphs.map((x) => x.cluster)
    // no ligature in this word, so every character keeps its own cluster
    expect(new Set(clusters).size).toBe(text.length)
    // RTL: the leftmost glyph comes first, so clusters do not increase along the run
    for (let i = 1; i < clusters.length; i++) expect(clusters[i]).toBeLessThanOrEqual(clusters[i - 1])
    expect(font.glyphSvg(run.glyphs[0].gid)).toMatch(/^M/)
    // in the passages, QPC's mark order never makes HarfBuzz reorder (clusters stay monotone)
    for (const { key, word: w } of allPassageWords()) {
      const cl = font.shape(w.text).glyphs.map((x) => x.cluster)
      for (let i = 1; i < cl.length; i++) expect(cl[i], key).toBeLessThanOrEqual(cl[i - 1])
    }
  })

  it('a mark order HarfBuzz reorders only permutes clusters: every character still lands on exactly one glyph', () => {
    const typed = 'ٱلرَّحۡمَٰنِ' // fatha typed before shadda: level 2 keeps both clusters but swaps their glyphs
    const clusters = font.shape(typed).glyphs.map((x) => x.cluster)
    expect([...clusters].sort((a, b) => a - b)).toEqual(Array.from({ length: typed.length }, (_, i) => i))
    // a rule on the fatha alone colours one glyph (the fatha), wherever HarfBuzz put it
    const rules = glyphRules(clusters, typed.length, charRules(typed.length, [{ start: 3, end: 4, rule: 'madda_normal' }]))
    expect(rules.filter((r) => r === 'madda_normal')).toHaveLength(1)
    expect(rules[clusters.indexOf(3)]).toBe('madda_normal')
  })

  it('shaping words one by one adds up to the shaped line (space advance between words)', () => {
    const words = ['ٱللَّهُ', 'لَآ', 'إِلَٰهَ', 'إِلَّا', 'هُوَ']
    const line = font.shape(words.join(' ')).advance
    const sum = words.reduce((s, w) => s + font.shape(w).advance, 0) + font.shape(' ').advance * (words.length - 1)
    expect(sum).toBe(line)
  })

  it('has glyphs for the marks data/ leaves inside Word.text and for every pause mark', () => {
    // ۞ (quarter start, prefixed with a space), ۩ (sajdah, appended), the pause marks, 36:52's sakt + waqf
    for (const t of ['۞ إِنَّ', 'سُجَّدًا ۩', 'ۖ', 'ۗ', 'ۘ', 'ۙ', 'ۚ', 'ۛ', 'ۜ', 'مَّرْقَدِنَاۜ', 'بِسْمِ']) {
      expect(font.shape(t).glyphs.some((x) => x.gid === 0), t).toBe(false)
    }
    const two = makeModel([ayah(52, [word(1, 'مَّرْقَدِنَا', { waqf: 'waqf_awla', waqfChar: 'ۜ ۗ' }), word(2, 'هَٰذَا')], 36)])
    const units = buildUnits(two, font, { waqf: true, numbers: false, tajweed: false })
    expect(units[0].glyphs.filter((x) => x.role === 'waqf')).toHaveLength(2)
  })

  it('the opening lines (QPC encoding) shape without a missing glyph', () => {
    for (const t of [BASMALA, ISTIADHA]) expect(font.shape(t).glyphs.some((x) => x.gid === 0), t).toBe(false)
  })

  it('lays out real words: units, breaking and ink extents stay sane', () => {
    const model = makeModel(passage('2:255-255'))
    const units = buildUnits(model, font, { waqf: true, numbers: true, tajweed: true })
    expect(units).toHaveLength(51) // 50 words + the ornament
    const space = font.shape(' ').advance
    const lines = breakLines(units, 9000, space)
    expect(lines.length).toBeGreaterThan(3)
    expect(lines[lines.length - 1].units.at(-1)?.kind).toBe('number')
    const ink = inkExtents(units, font)
    expect(ink.top).toBeGreaterThan(0.8)
    expect(ink.top).toBeLessThan(2)
    expect(ink.bottom).toBeGreaterThan(0.2)
    expect(ink.bottom).toBeLessThan(1.2)
  })
})

describe('the contact-sheet passages (1:1–7, 2:2, 2:10, 2:19, 2:255, 2:282, 4:43, 112, 36:52), real words', () => {
  it('no .notdef anywhere, with pause marks and ayah numbers', () => {
    for (const k of PASSAGE_KEYS) {
      const units = buildUnits(makeModel(passage(k)), font, { waqf: true, numbers: true, tajweed: true })
      const missing = units.flatMap((u) => u.glyphs.filter((x) => x.gid === 0).map(() => `${u.ayah}:${u.position}`))
      expect(missing, k).toEqual([])
    }
  })

  it('a small meem only where the text has one (iqlab): no stray meem on open tanween (00-gaps §2.2)', () => {
    const meems = new Set([gidOf('ۢ'), gidOf('ۭ')])
    expect(meems.has(-1)).toBe(false)
    let iqlab = 0
    for (const { key, word: w } of allPassageWords()) {
      const want = (w.text.match(SMALL_MEEM) ?? []).length
      const got = font.shape(w.text).glyphs.filter((x) => meems.has(x.gid)).length
      expect(got, `${key} ${w.text}`).toBe(want)
      iqlab += want
    }
    expect(iqlab).toBeGreaterThan(0) // 2:10:9 «أَلِيمُۢ», 2:19:18 «مُحِيطُۢ»
  })

  it('open tanween (U+08F0–08F2) never draws as the plain tanween in the same context (shadda variants too)', () => {
    const PLAIN: Record<string, string> = { '\u08F0': '\u064B', '\u08F1': '\u064C', '\u08F2': '\u064D' }
    let seen = 0
    let withShadda = 0
    for (const { key, word: w } of allPassageWords()) {
      for (let i = 0; i < w.text.length; i++) {
        const plainCh = PLAIN[w.text[i]]
        if (!plainCh) continue
        // Amiri swaps tanween glyphs by context (a smaller pair beside a shadda), so compare like with like
        const at = (text: string) => font.shape(text).glyphs.filter((x) => x.cluster === i).map((x) => x.gid)
        const open = at(w.text)
        const plain = at(w.text.slice(0, i) + plainCh + w.text.slice(i + 1))
        expect(open.length, key).toBeGreaterThan(0)
        expect(open.some((x) => plain.includes(x)), `${key} @${i}`).toBe(false)
        seen++
        if (w.text.includes('\u0651')) withShadda++
      }
    }
    expect(seen).toBeGreaterThan(10) // 2:2:6 «هُدࣰى», 2:19:2 «كَصَيِّبࣲ», …
    expect(withShadda).toBeGreaterThan(0) // 2:282:9 «مُّسَمࣰّى»
  })

  it('pause marks come from waqfChar: one waqf glyph per printed mark, none when hidden', () => {
    let marks = 0
    for (const k of PASSAGE_KEYS) {
      const model = makeModel(passage(k))
      const shown = buildUnits(model, font, { waqf: true, numbers: false, tajweed: false })
      const hidden = buildUnits(model, font, { waqf: false, numbers: false, tajweed: false })
      const words = model.ayahs.flatMap((a) => a.words)
      words.forEach((w, i) => {
        const { sakt, gap } = splitPauseMarks(w.waqfChar)
        const want = sakt.length + (gap ? 1 : 0)
        expect(shown[i].glyphs.filter((x) => x.role === 'waqf').length, `${k} ${w.position}`).toBe(want)
        expect(hidden[i].glyphs.some((x) => x.role === 'waqf')).toBe(false)
        marks += want
      })
    }
    expect(marks).toBeGreaterThan(5) // 2:2 «ۛ ۛ», 2:255, 4:43, 36:52 «ۜ ۗ», …
  })

  it('tajweed colouring stays exact on marks: no class lost, a bare letter never takes its marks’ colour', () => {
    let markOnly = 0
    for (const { key, word: w } of allPassageWords()) {
      if (!w.tajweed.length) continue
      const run = font.shape(w.text)
      const clusters = run.glyphs.map((x) => x.cluster)
      const chars = charRules(w.text.length, w.tajweed)
      const rules = glyphRules(clusters, w.text.length, chars)
      // every class of the word reaches at least one glyph
      for (const r of new Set(chars.filter((x) => x !== null))) expect(rules, `${key} ${w.text} ${r}`).toContain(r)
      // a glyph that is one character (its own cluster, no ligature) takes exactly that character's class
      const starts = [...new Set(clusters)].sort((a, b) => a - b)
      run.glyphs.forEach((x, i) => {
        const next = starts[starts.indexOf(x.cluster) + 1] ?? w.text.length
        if (next - x.cluster === 1) expect(rules[i], `${key} ${w.text} @${x.cluster}`).toBe(chars[x.cluster])
      })
      // a span on marks only (e.g. madda_normal on «َٰ») leaves the letter under them uncoloured
      for (const s of w.tajweed) {
        const base = s.start - 1
        if (base < 0 || /\p{M}/u.test(w.text[base]) || ![...w.text.slice(s.start, s.end)].every((c) => /\p{M}/u.test(c))) continue
        const gi = clusters.indexOf(base)
        if (gi >= 0 && (starts[starts.indexOf(base) + 1] ?? w.text.length) === s.start && chars[base] === null) {
          expect(rules[gi], `${key} ${w.text}`).toBeNull()
          markOnly++
        }
      }
    }
    expect(markOnly).toBeGreaterThan(5) // 2:2:1 «ذَٰلِكَ», 2:2:2 «ٱلۡكِتَٰبُ», 2:255 «إِلَٰهَ», …
  })
})
