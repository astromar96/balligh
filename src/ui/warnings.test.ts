import type { Selection } from '../core/types'
import * as domain from '../domain'
import type { SelectionWarning } from '../domain'
import { fixtureAyahs } from './__fixtures__/load'
import { translate } from './i18n'
import { applySelectionFix, primaryWarning, warningCopy } from './warnings'

const baqarah = fixtureAyahs(2)
const at = { ayah: 255, word: 5 }
const sel = (a: number, w: number, b: number, x: number): Selection => ({ surah: 2, start: { ayah: a, word: w }, end: { ayah: b, word: x } })

const EVERY_KIND: SelectionWarning[] = [
  { kind: 'starts-mid-phrase', at },
  { kind: 'starts-after-speech-verb', at, verb: { ayah: 255, word: 3 } },
  { kind: 'ends-mid-phrase', at },
  { kind: 'ends-on-mamnu', at },
  { kind: 'ends-curated', at, extendTo: { ayah: 256, word: 6 } },
  { kind: 'next-starts-with-illa', at, extendTo: { ayah: 256, word: 3 } },
  { kind: 'pause-hint', at, mark: 'wasl_awla', bothStops: false },
  { kind: 'pause-hint', at, mark: 'muanaqa', bothStops: false },
  { kind: 'pause-hint', at, mark: 'muanaqa', bothStops: true },
  { kind: 'long', count: 140 },
]

describe('warningCopy', () => {
  it('has a full and a short wording for every warning in both languages', () => {
    for (const w of EVERY_KIND) {
      const copy = warningCopy(w)
      for (const lang of ['ar', 'en'] as const) {
        expect(translate(lang, copy.message, copy.params)).not.toBe(copy.message)
        expect(translate(lang, copy.short).length).toBeGreaterThan(3)
        for (const f of copy.fixes) expect(translate(lang, f.label, f.params)).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('never points at a pause-mark glyph (00-gaps D1)', () => {
    const marks = /[ۖ-ۜ]/
    for (const w of EVERY_KIND) {
      const copy = warningCopy(w)
      for (const lang of ['ar', 'en'] as const) {
        expect(translate(lang, copy.message, copy.params)).not.toMatch(marks)
        expect(translate(lang, copy.short)).not.toMatch(marks)
      }
    }
  })

  it('reads «do not stop here» for a no-stop end', () => {
    expect(translate('ar', warningCopy({ kind: 'ends-on-mamnu', at }).message)).toContain('الوقف هنا ممنوع')
  })

  it('keeps hints quiet: only stopping at both marks of a pair is a warning', () => {
    expect(warningCopy({ kind: 'pause-hint', at, mark: 'wasl_awla', bothStops: false }).severity).toBe('info')
    expect(warningCopy({ kind: 'pause-hint', at, mark: 'muanaqa', bothStops: true }).severity).toBe('warning')
    expect(warningCopy({ kind: 'ends-on-mamnu', at }).severity).toBe('warning')
  })

  it('offers to complete the meaning up to the ayah it continues into', () => {
    const copy = warningCopy({ kind: 'next-starts-with-illa', at, extendTo: { ayah: 256, word: 3 } })
    expect(copy.fixes).toEqual([{ fix: { kind: 'extend-to', to: { ayah: 256, word: 3 } }, label: 'fixExtendTo', params: { n: 256 } }])
    expect(translate('ar', copy.fixes[0].label, copy.fixes[0].params)).toContain('٢٥٦')
  })
})

describe('primaryWarning', () => {
  it('is null without warnings, and leaves info hints out', () => {
    expect(primaryWarning([])).toBeNull()
    expect(primaryWarning([{ kind: 'pause-hint', at, mark: 'wasl_awla', bothStops: false }])).toBeNull()
  })

  it('puts a no-stop end before a cut sentence, and length last', () => {
    const ws: SelectionWarning[] = [{ kind: 'long', count: 140 }, { kind: 'starts-mid-phrase', at }, { kind: 'ends-on-mamnu', at }]
    expect(primaryWarning(ws)?.kind).toBe('ends-on-mamnu')
    expect(primaryWarning([{ kind: 'long', count: 140 }, { kind: 'ends-mid-phrase', at }])?.kind).toBe('ends-mid-phrase')
    expect(primaryWarning([{ kind: 'starts-mid-phrase', at }, { kind: 'starts-after-speech-verb', at, verb: at }])?.kind).toBe('starts-after-speech-verb')
  })
})

describe('applySelectionFix', () => {
  const cut = sel(255, 5, 256, 4)

  it('widens to whole ayahs', () => {
    expect(applySelectionFix(cut, { kind: 'whole-ayahs' }, baqarah)).toEqual(domain.expandToAyahs(cut, baqarah))
  })

  it('moves only the start, or only the end, to the nearest allowed stop', () => {
    const snapped = domain.snapToPauses(cut, baqarah)
    expect(applySelectionFix(cut, { kind: 'snap-start' }, baqarah)).toEqual({ ...cut, start: snapped.start })
    expect(applySelectionFix(cut, { kind: 'snap-end' }, baqarah)).toEqual({ ...cut, end: snapped.end })
    expect(applySelectionFix(cut, { kind: 'snap-start' }, baqarah).start).toEqual({ ayah: 255, word: 1 })
  })

  it('extends the end, and never shortens the selection', () => {
    expect(applySelectionFix(sel(255, 1, 255, 50), { kind: 'extend-to', to: { ayah: 256, word: 6 } }, baqarah).end).toEqual({ ayah: 256, word: 6 })
    expect(applySelectionFix(cut, { kind: 'extend-to', to: { ayah: 255, word: 9 } }, baqarah)).toEqual(cut)
  })

  it('continues past a «continuing is better» stop to the next allowed one', () => {
    // 255:32 carries ۖ; the next allowed stop after it is 255:40 (ۚ)
    const next = applySelectionFix(sel(255, 27, 255, 32), { kind: 'next-stop', after: { ayah: 255, word: 32 } }, baqarah)
    expect(next.start).toEqual({ ayah: 255, word: 27 })
    expect(next.end).toEqual({ ayah: 255, word: 40 })
  })
})
