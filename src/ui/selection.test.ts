import type { Selection } from '../core/types'
import { fixtureAyahs } from './__fixtures__/load'
import {
  applyTap,
  contains,
  groupByPage,
  hull,
  lastWordOf,
  normalizeLocal,
  pageIndexOfAyah,
  pageSelectionKey,
  selectedText,
  stepWord,
  trimLocal,
  wholeAyahsLocal,
  type TapOptions,
  type TapState,
} from './selection'

const baqarah = fixtureAyahs(2) // 2:255–257
const fatiha = fixtureAyahs(1)
const sel = (a: number, w: number, b: number, x: number, surah = 2): Selection => ({ surah, start: { ayah: a, word: w }, end: { ayah: b, word: x } })
const ornament = (n: number) => `(${n})`
const EMPTY: TapState = { selection: null, pending: null }

function opts(over: Partial<TapOptions> = {}): TapOptions {
  return {
    surah: 2,
    ayahs: baqarah,
    mode: 'words',
    snap: false,
    expandToAyahs: (s) => {
      const n = normalizeLocal(s)
      return wholeAyahsLocal(n.surah, n.start.ayah, n.end.ayah, baqarah)
    },
    snapToPauses: (s) => s,
    ...over,
  }
}

describe('fixture', () => {
  it('has Ayat al-Kursi with its pause marks split off the words', () => {
    const kursi = baqarah[0]
    expect(kursi.key).toBe('2:255')
    expect(lastWordOf(kursi)).toBe(50)
    expect(kursi.words[6]).toMatchObject({ position: 7, waqf: 'jaiz', waqfChar: 'ۚ' })
    expect(kursi.words[6].text.endsWith('ۚ')).toBe(false)
  })
})

describe('applyTap', () => {
  it('selects the first tapped word alone and waits for the end', () => {
    const s = applyTap(EMPTY, { kind: 'word', ref: { ayah: 255, word: 5 } }, opts())
    expect(s.selection).toEqual(sel(255, 5, 255, 5))
    expect(s.pending).toEqual(sel(255, 5, 255, 5))
  })

  it('completes the range in reading order whichever end is tapped first', () => {
    const first = applyTap(EMPTY, { kind: 'word', ref: { ayah: 256, word: 4 } }, opts())
    const done = applyTap(first, { kind: 'word', ref: { ayah: 255, word: 5 } }, opts())
    expect(done).toEqual({ selection: sel(255, 5, 256, 4), pending: null })
  })

  it('selects a word alone when it is tapped twice', () => {
    const first = applyTap(EMPTY, { kind: 'word', ref: { ayah: 255, word: 9 } }, opts())
    const done = applyTap(first, { kind: 'word', ref: { ayah: 255, word: 9 } }, opts())
    expect(done).toEqual({ selection: sel(255, 9, 255, 9), pending: null })
  })

  it('starts over on the third tap', () => {
    let s = applyTap(EMPTY, { kind: 'word', ref: { ayah: 255, word: 1 } }, opts())
    s = applyTap(s, { kind: 'word', ref: { ayah: 255, word: 7 } }, opts())
    s = applyTap(s, { kind: 'word', ref: { ayah: 257, word: 2 } }, opts())
    expect(s).toEqual({ selection: sel(257, 2, 257, 2), pending: sel(257, 2, 257, 2) })
  })

  it('takes a whole ayah for an ornament tap', () => {
    const s = applyTap(EMPTY, { kind: 'ayah', ayah: 256 }, opts())
    expect(s.selection).toEqual(sel(256, 1, 256, lastWordOf(baqarah[1])))
    const done = applyTap(s, { kind: 'ayah', ayah: 255 }, opts())
    expect(done.selection).toEqual(sel(255, 1, 256, lastWordOf(baqarah[1])))
  })

  it('widens every tap to whole ayahs in ayahs mode', () => {
    const o = opts({ mode: 'ayahs' })
    const s = applyTap(EMPTY, { kind: 'word', ref: { ayah: 255, word: 20 } }, o)
    expect(s.selection).toEqual(sel(255, 1, 255, 50))
    const done = applyTap(s, { kind: 'word', ref: { ayah: 256, word: 3 } }, o)
    expect(done.selection).toEqual(sel(255, 1, 256, lastWordOf(baqarah[1])))
  })

  it('follows the pause marks only once the range is complete', () => {
    const snapped: Selection[] = []
    const o = opts({ snap: true, snapToPauses: (s) => (snapped.push(s), { ...s, end: { ayah: s.end.ayah, word: 7 } }) })
    const first = applyTap(EMPTY, { kind: 'word', ref: { ayah: 255, word: 1 } }, o)
    expect(snapped).toHaveLength(0)
    const done = applyTap(first, { kind: 'word', ref: { ayah: 255, word: 5 } }, o)
    expect(snapped).toEqual([sel(255, 1, 255, 5)])
    expect(done.selection).toEqual(sel(255, 1, 255, 7))
  })
})

describe('ranges', () => {
  it('normalises, contains and hulls in reading order', () => {
    expect(normalizeLocal(sel(256, 4, 255, 5))).toEqual(sel(255, 5, 256, 4))
    expect(contains(sel(255, 5, 256, 4), { ayah: 255, word: 50 })).toBe(true)
    expect(contains(sel(255, 5, 256, 4), { ayah: 256, word: 5 })).toBe(false)
    expect(contains(null, { ayah: 1, word: 1 })).toBe(false)
    expect(hull(sel(255, 9, 255, 12), sel(255, 3, 255, 4))).toEqual(sel(255, 3, 255, 12))
  })

  it('clamps whole-ayah ranges to the surah', () => {
    expect(wholeAyahsLocal(1, 9, 0, fatiha)).toEqual(sel(1, 1, 7, lastWordOf(fatiha[6]), 1))
  })

  it('trims ayahs to the selection and flags partial ends', () => {
    const t = trimLocal(sel(255, 5, 256, 4), baqarah)
    expect(t.ayahs.map((a) => a.number)).toEqual([255, 256])
    expect(t.ayahs[0].words[0].position).toBe(5)
    expect(t.ayahs[1].words.map((w) => w.position)).toEqual([1, 2, 3, 4])
    expect(t.partialStart).toBe(true)
    expect(t.partialEnd).toBe(true)
    expect(t.ayahs.reduce((n, a) => n + a.words.length, 0)).toBe(50)
  })
})

describe('Mushaf pages', () => {
  it('groups ayahs by printed page and notes where a juz starts', () => {
    expect(groupByPage(fatiha)).toEqual([{ page: 1, juzStarts: [1], ayahs: fatiha }])
    const split = baqarah.map((a) => (a.number === 257 ? { ...a, page: 43 } : a))
    const pages = groupByPage(split)
    expect(pages.map((p) => [p.page, p.juzStarts, p.ayahs.length])).toEqual([
      [42, [3], 2],
      [43, [], 1],
    ])
    expect(pageIndexOfAyah(pages, 257)).toBe(1)
    expect(pageIndexOfAyah(pages, 300)).toBe(-1)
  })

  it('keys a page by how the selection touches it, so untouched pages do not re-render', () => {
    const pages = groupByPage(baqarah.map((a) => (a.number === 257 ? { ...a, page: 43 } : a)))
    expect(pageSelectionKey(pages[1], sel(255, 5, 256, 4), null, null)).toBe('')
    expect(pageSelectionKey(pages[0], sel(255, 5, 256, 4), null, { ayah: 255, word: 9 })).toBe('s255.5-256.4c255.9')
  })
})

describe('selectedText', () => {
  it('keeps pause marks and closes whole ayahs with their ornament', () => {
    const text = selectedText(sel(1, 1, 2, lastWordOf(fatiha[1]), 1), fatiha, ornament)
    expect(text.endsWith('(2)')).toBe(true)
    expect(text).toContain('(1) ')
    const cut = selectedText(sel(255, 1, 255, 7), baqarah, ornament)
    expect(cut.endsWith('ۚ')).toBe(true)
    expect(cut).not.toContain('(255)')
  })
})

describe('stepWord', () => {
  it('moves across ayahs and stays put at the edges', () => {
    expect(stepWord(baqarah, { ayah: 255, word: 50 }, 1)).toEqual({ ayah: 256, word: 1 })
    expect(stepWord(baqarah, { ayah: 256, word: 1 }, -1)).toEqual({ ayah: 255, word: 50 })
    expect(stepWord(fatiha, { ayah: 1, word: 1 }, -1)).toEqual({ ayah: 1, word: 1 })
    const last = { ayah: 7, word: lastWordOf(fatiha[6]) }
    expect(stepWord(fatiha, last, 1)).toEqual(last)
  })
})
