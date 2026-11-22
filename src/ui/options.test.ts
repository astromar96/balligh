import { ASPECTS, BLURS, ELEMENTS, OVERLAYS, durationWarningKeys, nearestIndex } from './options'

describe('nearestIndex', () => {
  it('maps any value to the closest option (links may carry in-between numbers)', () => {
    const overlays = OVERLAYS.map((o) => o.v)
    expect(nearestIndex(overlays, 0)).toBe(0)
    expect(nearestIndex(overlays, 0.3)).toBe(1)
    expect(nearestIndex(overlays, 0.5)).toBe(2)
    expect(nearestIndex(overlays, 2)).toBe(overlays.length - 1)
    expect(nearestIndex(BLURS.map((b) => b.v), 10)).toBe(1)
  })
})

it('offers the four clip shapes, story first', () => {
  expect(ASPECTS.map((a) => a.aspect)).toEqual(['9:16', '4:5', '1:1', '16:9'])
})

it('has no switch for the reciter credit: a video always names the reciter and the riwayah', () => {
  expect(ELEMENTS.map((e) => e.field)).not.toContain('showReciterName')
})

describe('durationWarningKeys', () => {
  it('says nothing up to a minute', () => {
    expect(durationWarningKeys(60_000)).toEqual([])
  })

  it('names every platform limit the clip passes, longest first', () => {
    expect(durationWarningKeys(61_000)).toEqual(['dur60'])
    expect(durationWarningKeys(95_000)).toEqual(['dur90', 'dur60'])
    expect(durationWarningKeys(200_000)).toEqual(['dur180', 'dur90', 'dur60'])
  })
})
