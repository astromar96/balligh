import { describe, expect, it } from 'vitest'
import type { DesignOptions, Selection } from '../core/types'
import { AYAH_END_WORD, clampSelection, decodeShareState, DEFAULT_DESIGN, encodeShareState, type ShareState } from './index'
import { fixtureAyahs } from './__fixtures__/load'
import { AYAH_COUNTS } from './quran-meta'

const sel = (surah: number, a1: number, w1: number, a2: number, w2: number): Selection => ({
  surah,
  start: { ayah: a1, word: w1 },
  end: { ayah: a2, word: w2 },
})
const state = (selection: Selection, rest: Partial<ShareState> = {}): ShareState => ({
  selection,
  reciterId: 'alafasy',
  tafsirId: null,
  translationId: null,
  design: {},
  ...rest,
})

describe('DEFAULT_DESIGN', () => {
  it('is the agreed starting design', () => {
    expect(DEFAULT_DESIGN).toEqual({
      aspect: '9:16',
      background: { kind: 'preset', id: 'lapis-night' },
      overlay: 0.35,
      blur: 0,
      textTone: 'light',
      fontScale: 1,
      showTajweed: false,
      showRulesLegend: false,
      showTranslation: false,
      showTafsir: false,
      showSurahHeader: true,
      showAyahNumbers: true,
      showWaqfMarks: true,
      showReciterName: true,
      highlightWords: true,
      showWatermark: true,
    })
  })
  it('cannot be mutated by accident', () => {
    expect(Object.isFrozen(DEFAULT_DESIGN)).toBe(true)
    expect(Object.isFrozen(DEFAULT_DESIGN.background)).toBe(true)
  })
})

describe('encodeShareState', () => {
  it('writes whole ayahs compactly and in a stable key order', () => {
    const s = state(sel(2, 255, 1, 257, AYAH_END_WORD), { tafsirId: 'mukhtasar', translationId: 20 })
    expect(encodeShareState(s)).toBe('v=1&s=2&a=255-257&r=alafasy&tf=mukhtasar&tr=20')
    expect(encodeShareState(state(sel(2, 255, 1, 255, AYAH_END_WORD)))).toBe('v=1&s=2&a=255&r=alafasy')
  })
  it("writes the isti'adha as i=1 right after the reciter, and only when it is on", () => {
    const s = state(sel(2, 255, 1, 257, AYAH_END_WORD), { istiadha: true, tafsirId: 'mukhtasar', translationId: 20 })
    expect(encodeShareState(s)).toBe('v=1&s=2&a=255-257&r=alafasy&i=1&tf=mukhtasar&tr=20')
    expect(encodeShareState(state(sel(112, 1, 1, 4, AYAH_END_WORD), { istiadha: true, reciterId: '' }))).toBe('v=1&s=112&a=1-4&i=1')
    for (const istiadha of [false, undefined, 'true' as unknown as boolean, 1 as unknown as boolean]) {
      expect(encodeShareState(state(sel(2, 255, 1, 255, AYAH_END_WORD), { istiadha }))).toBe('v=1&s=2&a=255&r=alafasy')
    }
  })
  it('writes word ranges as f/t', () => {
    expect(encodeShareState(state(sel(2, 255, 3, 257, 5)))).toBe('v=1&s=2&f=255.3&t=257.5&r=alafasy')
    expect(encodeShareState(state(sel(2, 257, 5, 255, 3)))).toBe('v=1&s=2&f=255.3&t=257.5&r=alafasy')
    expect(encodeShareState(state(sel(2, 255, 1, 257, 5)))).toBe('v=1&s=2&f=255&t=257.5&r=alafasy')
    expect(encodeShareState(state(sel(2, 255, 3, 257, AYAH_END_WORD)))).toBe('v=1&s=2&f=255.3&t=257&r=alafasy')
  })
  it('recognises whole ayahs with real word positions when given the ayahs', () => {
    const ayahs = fixtureAyahs(2)
    const whole = state(sel(2, 255, 1, 257, 24))
    expect(encodeShareState(whole)).toBe('v=1&s=2&f=255&t=257.24&r=alafasy')
    expect(encodeShareState(whole, ayahs)).toBe('v=1&s=2&a=255-257&r=alafasy')
    const back = decodeShareState(encodeShareState(whole, ayahs))!
    expect(back.selection).toEqual(sel(2, 255, 1, 257, AYAH_END_WORD))
    expect(clampSelection(back.selection, ayahs)).toEqual(whole.selection)
  })
  it('writes only the design fields that differ from DEFAULT_DESIGN', () => {
    const design: Partial<DesignOptions> = {
      ...DEFAULT_DESIGN,
      aspect: '1:1',
      background: { kind: 'preset', id: 'desert-dawn' },
      overlay: 0.5,
      textTone: 'dark',
      fontScale: 1.2,
      showTajweed: true,
      showRulesLegend: true,
      showWatermark: false,
    }
    expect(encodeShareState(state(sel(1, 1, 1, 7, AYAH_END_WORD), { reciterId: 'husary', design }))).toBe(
      'v=1&s=1&a=1-7&r=husary&ar=1x1&bg=desert-dawn&ov=0.5&fs=1.2&tt=d&tj=1&lg=1&wm=0',
    )
    expect(encodeShareState(state(sel(1, 1, 1, 7, AYAH_END_WORD), { design: DEFAULT_DESIGN }))).toBe('v=1&s=1&a=1-7&r=alafasy')
  })
  it('never shares an uploaded background or invalid values', () => {
    const s = state(sel(112, 1, 1, 4, AYAH_END_WORD), {
      reciterId: 'not ok',
      tafsirId: '',
      translationId: -3,
      design: { background: { kind: 'image', src: 'blob:http://x/1', focusX: 0.5, focusY: 0.5 }, overlay: Number.NaN },
    })
    expect(encodeShareState(s)).toBe('v=1&s=112&a=1-4')
  })
})

describe('decodeShareState', () => {
  it('reads the examples back', () => {
    expect(decodeShareState('v=1&s=2&a=255-257&r=alafasy&tf=mukhtasar&tr=20')).toEqual(
      state(sel(2, 255, 1, 257, AYAH_END_WORD), { tafsirId: 'mukhtasar', translationId: 20 }),
    )
    expect(decodeShareState('v=1&s=2&f=255.3&t=257.5&r=alafasy')).toEqual(state(sel(2, 255, 3, 257, 5)))
    expect(decodeShareState('s=2&f=255.3&t=257.5')).toEqual(state(sel(2, 255, 3, 257, 5), { reciterId: '' }))
  })
  it('accepts a leading "?", a whole URL and a fragment', () => {
    const want = state(sel(2, 255, 3, 257, 5))
    expect(decodeShareState('?v=1&s=2&f=255.3&t=257.5&r=alafasy')).toEqual(want)
    expect(decodeShareState('https://balligh.app/c?v=1&s=2&f=255.3&t=257.5&r=alafasy#top')).toEqual(want)
    expect(decodeShareState('s=2&f=255:3&t=257:5&r=alafasy')).toEqual(want)
  })
  it("reads the isti'adha: on for i=1 (or true), absent otherwise", () => {
    expect(decodeShareState('v=1&s=2&a=255-257&r=alafasy&i=1&tf=mukhtasar&tr=20')).toEqual(
      state(sel(2, 255, 1, 257, AYAH_END_WORD), { istiadha: true, tafsirId: 'mukhtasar', translationId: 20 }),
    )
    expect(decodeShareState('s=1&a=1&i=true')!.istiadha).toBe(true)
    for (const q of ['s=1&a=1', 's=1&a=1&i=0', 's=1&a=1&i=false', 's=1&a=1&i=', 's=1&a=1&i=2', 's=1&a=1&i=yes%00', 's=1&a=1&i=%E0%A4%A']) {
      const d = decodeShareState(q)!
      expect(d, q).not.toBeNull()
      expect('istiadha' in d, q).toBe(false)
    }
    // the first value of a repeated key wins, like every other field (wm=0&wm=1 below)
    expect(decodeShareState('s=1&a=1&i=1&i=0')!.istiadha).toBe(true)
    expect(decodeShareState('s=1&a=1&i=0&i=1')!.istiadha).toBeUndefined()
  })
  it('returns null without a valid selection', () => {
    for (const q of ['', 'v=1', 'v=1&s=2', 's=0&a=1', 's=115&a=1', 's=2&a=300', 's=2&a=0', 's=x&a=1', 'v=2&s=2&a=255', 's=2&f=255.200', 's=2&a=1-2-3']) {
      expect(decodeShareState(q)).toBeNull()
    }
    expect(decodeShareState(undefined as unknown as string)).toBeNull()
  })
  it('clamps and completes partial selections', () => {
    expect(decodeShareState('s=2&a=280-300')!.selection).toEqual(sel(2, 280, 1, 286, AYAH_END_WORD))
    expect(decodeShareState('s=2&a=257-255')!.selection).toEqual(sel(2, 255, 1, 257, AYAH_END_WORD))
    expect(decodeShareState('s=2&f=255.3')!.selection).toEqual(sel(2, 255, 3, 255, AYAH_END_WORD))
    expect(decodeShareState('s=2&t=257.5')!.selection).toEqual(sel(2, 257, 1, 257, 5))
    expect(decodeShareState('s=2&f=255.3&t=255.9999')!.selection).toEqual(sel(2, 255, 3, 255, AYAH_END_WORD))
  })
  it('ignores garbage fields one by one', () => {
    const d = decodeShareState(
      's=1&a=1-7&r=bad%20id&tf=&tr=0&ar=3x2&bg=..&ov=abc&bl=1e400&tt=blue&fs=&tj=yes&lg=1&zz=1&%E0%A4%A=1&wm=0&wm=1',
    )!
    expect(d).toEqual({
      selection: sel(1, 1, 1, 7, AYAH_END_WORD),
      reciterId: '',
      tafsirId: null,
      translationId: null,
      design: { showRulesLegend: true, showWatermark: false },
    })
  })
  it('clamps numbers into their ranges and drops values equal to the default', () => {
    expect(decodeShareState('s=1&a=1&ov=9&bl=-5&fs=0.1')!.design).toEqual({ overlay: 0.85, fontScale: 0.75 })
    expect(decodeShareState('s=1&a=1&ar=9x16&bg=lapis-night&ov=0.35&tt=l&tj=0&wm=1')!.design).toEqual({})
    expect(decodeShareState('s=1&a=1&ar=16:9&tt=dark&tj=true')!.design).toEqual({ aspect: '16:9', textTone: 'dark', showTajweed: true })
  })
})

// ── property: decode(encode(s)) === s for every valid state (seeded, reproducible) ──

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomState(rnd: () => number): ShareState {
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]
  const surah = int(1, 114)
  const count = AYAH_COUNTS[surah - 1]
  const a1 = int(1, count)
  const a2 = int(a1, Math.min(count, a1 + int(0, 5)))
  const w1 = rnd() < 0.4 ? 1 : int(1, 40)
  let w2 = rnd() < 0.4 ? AYAH_END_WORD : int(1, 128)
  if (a1 === a2 && w2 < w1) w2 = w1
  const design: Partial<DesignOptions> = {}
  if (rnd() < 0.5) design.aspect = pick(['4:5', '1:1', '16:9'] as const)
  if (rnd() < 0.5) design.background = { kind: 'preset', id: pick(['desert-dawn', 'emerald-arch', 'night_sky.2', 'P1']) }
  if (rnd() < 0.5) design.overlay = rnd() * 0.85
  if (rnd() < 0.5) design.blur = pick([1, 8, 24, rnd() * 24])
  if (rnd() < 0.5) design.textTone = 'dark'
  if (rnd() < 0.5) design.fontScale = 0.75 + rnd() * 0.65
  for (const k of ['showTajweed', 'showRulesLegend', 'showTranslation', 'showTafsir', 'showSurahHeader', 'showAyahNumbers', 'showWaqfMarks', 'showReciterName', 'highlightWords', 'showWatermark'] as const) {
    if (rnd() < 0.3) design[k] = !DEFAULT_DESIGN[k]
  }
  // decode returns design fields in DEFAULT_DESIGN order
  const ordered: Partial<DesignOptions> = {}
  for (const k of Object.keys(DEFAULT_DESIGN) as (keyof DesignOptions)[]) if (design[k] !== undefined) (ordered as Record<string, unknown>)[k] = design[k]
  return {
    selection: sel(surah, a1, w1, a2, w2),
    reciterId: rnd() < 0.2 ? '' : pick(['alafasy', 'abdulbasit-murattal', 'yasser-dosari', 'husary_2']),
    ...(rnd() < 0.3 ? { istiadha: true } : {}),
    tafsirId: rnd() < 0.4 ? null : pick(['mukhtasar', 'muyassar', 'ahkam-ibn-alarabi']),
    translationId: rnd() < 0.4 ? null : int(1, 300),
    design: ordered,
  }
}

describe('share links round-trip (property, seeded)', () => {
  it('decode(encode(s)) equals s for 2,000 random valid states', () => {
    const rnd = mulberry32(0xba11e)
    for (let i = 0; i < 2000; i++) {
      const s = randomState(rnd)
      const q = encodeShareState(s)
      expect(q).toMatch(/^v=1&s=\d+&/)
      expect(decodeShareState(q), q).toEqual(s)
      expect(encodeShareState(decodeShareState(q)!)).toBe(q)
    }
  })
})
