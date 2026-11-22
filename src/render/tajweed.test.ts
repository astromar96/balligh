import { describe, expect, it } from 'vitest'
import { charRules, glyphRules, legendItems, ruleColor } from './tajweed'

describe('cluster → span colour mapping', () => {
  it('inner spans win over the spans that contain them; helper classes inherit', () => {
    const rules = charRules(8, [
      { start: 0, end: 8, rule: 'ghunnah' },
      { start: 2, end: 4, rule: 'madda_normal' },
      { start: 3, end: 4, rule: 'custom-alef-maksora' },
    ])
    expect(rules).toEqual(['ghunnah', 'ghunnah', 'madda_normal', 'madda_normal', 'ghunnah', 'ghunnah', 'ghunnah', 'ghunnah'])
  })

  it('a glyph covers [cluster, next cluster) and takes the first rule in it (ligatures, skipped clusters)', () => {
    // ٱلرَّحْمَٰنِ-like: 5 glyphs, clusters 5,4,2,1,0 (index 3 sits inside cluster 2's ligature)
    const text = 12
    const rules = charRules(text, [{ start: 3, end: 4, rule: 'ghunnah' }])
    const out = glyphRules([5, 4, 2, 1, 0], text, rules)
    // glyph with cluster 2 covers [2,4) → contains the ghunnah char at 3
    expect(out).toEqual([null, null, 'ghunnah', null, null])
    // the last glyph's range runs to the end of the text
    const tail = glyphRules([0, 6], text, charRules(text, [{ start: 9, end: 12, rule: 'madda_permissible' }]))
    expect(tail).toEqual([null, 'madda_permissible'])
  })

  it('colours a mark on its own when the mark has its own cluster (mark-only run)', () => {
    const rules = charRules(3, [{ start: 1, end: 2, rule: 'madda_normal' }])
    // base letter cluster 0, its mark cluster 1, next letter 2
    expect(glyphRules([2, 1, 0], 3, rules)).toEqual([null, 'madda_normal', null])
  })

  it('appended pause-mark glyphs (cluster beyond the word) get no rule', () => {
    const rules = charRules(3, [{ start: 0, end: 3, rule: 'qalaqah' }])
    expect(glyphRules([5, 4, 2, 1, 0], 3, rules)).toEqual([null, null, 'qalaqah', 'qalaqah', 'qalaqah'])
  })
})

describe('palette and legend', () => {
  it('uses the KFGQPC V4 light palette on dark text and the dark palette on light text', () => {
    expect(ruleColor('qalaqah', 'dark')).toBe('#2FADFF')
    expect(ruleColor('qalaqah', 'light')).toBe('#00DEFF')
    expect(ruleColor('madda_necessary', 'light')).toBe('#E30000')
    expect(ruleColor('custom-alef-maksora', 'light')).toBeNull()
    // a class nobody knows is drawn as plain text (not in domain's neutral ink, which is dark)
    expect(ruleColor('no_such_rule', 'light')).toBeNull()
    expect(legendItems(['no_such_rule', 'qalaqah'], 'light').map((i) => i.color)).toEqual(['#00DEFF'])
  })

  it('groups the legend by colour in the printed key order (silent, madd, ghunnah, qalqalah)', () => {
    const items = legendItems(['qalaqah', 'ikhafa', 'ham_wasl', 'idgham_ghunnah', 'madda_normal', 'ikhafa'], 'dark')
    expect(items.map((i) => i.color)).toEqual(['#9FA5A5', '#CE9E00', '#09B000', '#2FADFF'])
    const green = items[2]
    expect(green.names).toHaveLength(2)
  })

  it('merges colours a reader cannot tell apart (hamzat al-wasl grey with the other greys)', () => {
    const items = legendItems(['ham_wasl', 'laam_shamsiyah', 'madda_necessary', 'madda_obligatory_mottasel'], 'dark')
    // #9FA5A5 and #A3A5A5 → one grey swatch; the two reds (#B50000, #F40000) stay apart
    expect(items.map((i) => i.color)).toEqual(['#9FA5A5', '#B50000', '#F40000'])
    expect(items[0].names).toHaveLength(2)
  })
})
