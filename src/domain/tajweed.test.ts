import { describe, expect, it } from 'vitest'
import type { Ayah } from '../core/types'
import { ruleInfo, rulesInAyahs, TAJWEED_RULES, WAQF_INFO } from './index'
import { fixtureAyah, fixtureAyahs } from './__fixtures__/load'
import research from './__fixtures__/tajweed-rules.json'

const HEX = /^#[0-9A-F]{6}$/i
const RULE_IDS = [
  'ham_wasl',
  'laam_shamsiyah',
  'slnt',
  'madda_normal',
  'madda_permissible',
  'madda_necessary',
  'madda_obligatory',
  'madda_obligatory_mottasel',
  'madda_obligatory_monfasel',
  'qalaqah',
  'ikhafa',
  'ikhafa_shafawi',
  'idgham_shafawi',
  'idgham_ghunnah',
  'idgham_wo_ghunnah',
  'idgham_mutajanisayn',
  'idgham_mutaqaribayn',
  'iqlab',
  'ghunnah',
]

interface ResearchRule {
  class: string
  name_ar: string
  name_en: string
  group: string
  colours: { kfgqpc_v4: { light: string; dark: string } }
  explanation_ar: string
  matn?: string
  source: string
}
const RESEARCH = (research.rules as unknown as ResearchRule[]).filter((r) => r.group !== 'not-a-rule')

// ── the documented departures from the research file (header of tajweed-catalogue.ts) ──

/** 00-gaps D10 label fixes. */
const RENAMED: Record<string, [string, string]> = {
  madda_permissible: ['المد العارض للسكون', 'Prolongation before a pause (2, 4 or 6 counts)'],
  madda_obligatory: ['المد المتصل والمنفصل', 'Madd muttasil and munfasil (4 or 5 counts)'],
}
/** Explanations rewritten (slnt: scope matched to the markup; iqlab: examples in standard spelling). */
const REWRITTEN = new Set(['slnt', 'iqlab'])
/** Readex Pro has no U+06E1 (Quranic sukun) or U+0657 (QPC open fathatan): their standard equivalents. */
const uiSafe = (s: string) => s.replace(/ۡ/g, 'ْ').replace(/ٗ/g, 'ً')

const GENERAL_CITE = 'أحكام التجويد برواية حفص عن عاصم'
/** Section headings of the matn on https://ar.wikisource.org/wiki/تحفة_الأطفال (read 2026-11-21; «لام آل» there is a typo for «لام أل»). */
const TUHFA_SECTIONS = [
  'النون الساكنة والتنوين',
  'الميم والنون المشددتين',
  'الميم الساكنة',
  'لام أل ولام الفعل',
  'المثلين والمتقاربين والمتجانسين',
  'أقسام المد',
  'أحكام المد',
  'أقسام المد اللازم',
]

/**
 * Arabic code points of Readex Pro 0.4.1, the UI font (fontTools over node_modules/@expo-google-fonts/readex-pro,
 * weights 400/500/600, 2026-11-21): U+060C U+061B U+061F, U+0621–063A, U+0640–0656, U+0660–0671, U+06A1 U+06A4 U+06BA.
 */
function notInUiFont(s: string): string[] {
  const covered = (c: number) =>
    c === 0x060c || c === 0x061b || c === 0x061f || (c >= 0x0621 && c <= 0x063a) || (c >= 0x0640 && c <= 0x0656) ||
    (c >= 0x0660 && c <= 0x0671) || c === 0x06a1 || c === 0x06a4 || c === 0x06ba
  const arabicBlock = (c: number) =>
    (c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0x08a0 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)
  const invisible = (c: number) => (c >= 0x200b && c <= 0x200f) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff
  return [...s].filter((ch) => {
    const c = ch.codePointAt(0) as number
    return (arabicBlock(c) && !covered(c)) || invisible(c)
  }).map((ch) => `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`)
}

describe('TAJWEED_RULES', () => {
  it('has the 19 rule classes of the Quran.com markup', () => {
    expect(Object.keys(TAJWEED_RULES).sort()).toEqual([...RULE_IDS].sort())
    expect(RESEARCH).toHaveLength(19)
  })
  it('keeps the research file verbatim: KFGQPC V4 colours, groups, matn verses, sources', () => {
    for (const r of RESEARCH) {
      const info = TAJWEED_RULES[r.class]
      expect(info.id).toBe(r.class)
      expect(info.group).toBe(r.group)
      expect(info.color).toBe(r.colours.kfgqpc_v4.light)
      expect(info.colorDark).toBe(r.colours.kfgqpc_v4.dark)
      expect(info.matnAr).toBe(r.matn)
      expect(info.source).toBe(r.source)
    }
  })
  it('keeps names and explanations except the documented departures', () => {
    for (const r of RESEARCH) {
      const info = TAJWEED_RULES[r.class]
      const [nameAr, nameEn] = RENAMED[r.class] ?? [r.name_ar, r.name_en]
      expect([info.nameAr, info.nameEn], r.class).toEqual([nameAr, nameEn])
      if (!REWRITTEN.has(r.class)) expect(info.explanationAr, r.class).toBe(uiSafe(r.explanation_ar))
    }
  })
  it('fixes the 00-gaps D10 labels', () => {
    // the class marks the madd/leen letter before a pause sukun (every one of its 4,541 words ends an ayah);
    // «المد الجائز» would also name the munfasil, which the markup colours madda_obligatory
    expect(TAJWEED_RULES.madda_permissible.nameAr).toBe('المد العارض للسكون')
    expect(TAJWEED_RULES.madda_permissible.nameAr).not.toMatch(/جائز/)
    // the verse-level class merges the connected (واجب) and separated (جائز) madd: the name says both, nothing more
    expect(TAJWEED_RULES.madda_obligatory.nameAr).toBe('المد المتصل والمنفصل')
    expect(TAJWEED_RULES.madda_obligatory.nameEn).not.toMatch(/obligatory/i)
    expect(TAJWEED_RULES.madda_obligatory.explanationAr).toMatch(/متصل واجب/)
    expect(TAJWEED_RULES.madda_obligatory.explanationAr).toMatch(/منفصل جائز/)
    expect(TAJWEED_RULES.madda_obligatory_mottasel.nameAr).toBe('المد الواجب المتصل')
    expect(TAJWEED_RULES.madda_obligatory_monfasel.nameAr).toBe('المد الجائز المنفصل')
  })
  it('rewrites slnt to what the markup colours and iqlab examples in standard spelling', () => {
    const slnt = TAJWEED_RULES.slnt.explanationAr
    expect(slnt).not.toMatch(/يسقط لفظًا في الوصل/) // 2:11 «فِى ٱلْأَرْضِ»: the dropped long vowel is not coloured slnt
    expect(slnt).toMatch(/قَالُواْ/)
    expect(slnt).toMatch(/أُوْلَٰٓئِكَ/)
    expect(slnt).toMatch(/ٱلصَّلَوٰةَ/)
    const iqlab = TAJWEED_RULES.iqlab.explanationAr
    expect(iqlab).toMatch(/ميمًا صغيرة/)
    expect(iqlab).toMatch(/مِنْ بَعْدِ، سَمِيعٌ بَصِيرٌ/)
  })
  it('cites only the sources the research names (never an invented citation)', () => {
    for (const r of RESEARCH) {
      const cite = TAJWEED_RULES[r.class].citeAr
      if (r.source.includes('تحفة الأطفال')) {
        expect(cite, r.class).toMatch(/^تحفة الأطفال — /)
        const sections = cite.replace('تحفة الأطفال — ', '').split('، و')
        for (const s of sections) expect(TUHFA_SECTIONS, `${r.class}: ${s}`).toContain(s)
      } else {
        expect(cite, r.class).toBe(GENERAL_CITE)
      }
    }
    expect(TAJWEED_RULES.madda_permissible.citeAr).toBe('تحفة الأطفال — أحكام المد')
    expect(TAJWEED_RULES.ghunnah.citeAr).toBe('تحفة الأطفال — الميم والنون المشددتين')
    expect(TAJWEED_RULES.qalaqah.citeAr).toBe(GENERAL_CITE)
  })
  it('explains every rule in English too, with the same counts as the name', () => {
    const seen = new Set<string>()
    for (const info of Object.values(TAJWEED_RULES)) {
      expect(info.explanationEn.length, info.id).toBeGreaterThan(60)
      expect(info.explanationEn, info.id).toMatch(/^[A-Z]/)
      expect(info.explanationEn, info.id).toMatch(/\.$/)
      expect(seen.has(info.explanationEn)).toBe(false)
      seen.add(info.explanationEn)
    }
    expect(TAJWEED_RULES.madda_normal.explanationEn).toMatch(/two counts/)
    expect(TAJWEED_RULES.madda_necessary.explanationEn).toMatch(/six counts/)
    expect(TAJWEED_RULES.madda_permissible.explanationEn).toMatch(/two counts .* four .* six/)
    expect(TAJWEED_RULES.madda_obligatory.explanationEn).toMatch(/four or five counts/)
    expect(TAJWEED_RULES.ikhafa.explanationEn).toMatch(/fifteen letters/)
  })
  it('writes everything the UI shows with characters the UI font has (Readex Pro: no U+06E1, U+06E2, U+0657, U+08F0…)', () => {
    for (const info of Object.values(TAJWEED_RULES)) {
      for (const field of ['nameAr', 'nameEn', 'explanationAr', 'explanationEn', 'citeAr', 'matnAr'] as const) {
        expect(notInUiFont(info[field] ?? ''), `${info.id}.${field}`).toEqual([])
      }
    }
    for (const w of Object.values(WAQF_INFO)) {
      expect(notInUiFont(w.nameAr), w.kind).toEqual([])
      expect(notInUiFont(w.meaningAr), w.kind).toEqual([])
    }
    // the research file itself is not (that is why the catalogue departs from it)
    expect(notInUiFont(RESEARCH.find((r) => r.class === 'iqlab')!.explanation_ar)).toEqual(['U+06E2', 'U+06E1', 'U+06E2'])
  })
  it('every entry is complete', () => {
    for (const info of Object.values(TAJWEED_RULES)) {
      expect(info.color).toMatch(HEX)
      expect(info.colorDark).toMatch(HEX)
      expect(info.nameAr).toMatch(/[؀-ۿ]/)
      expect(info.explanationAr.length).toBeGreaterThan(40)
      expect(info.citeAr.length).toBeGreaterThan(10)
      expect(info.source?.length).toBeGreaterThan(5)
      expect(['silent', 'madd', 'ghunnah', 'qalqalah']).toContain(info.group)
      expect(info.fallback).toBeUndefined()
    }
  })
  it('keeps the correct madd names (alquran.cloud swaps لازم and واجب)', () => {
    expect(TAJWEED_RULES.madda_necessary.nameAr).toBe('المد اللازم')
    expect(TAJWEED_RULES.madda_obligatory_mottasel.nameAr).toBe('المد الواجب المتصل')
    expect(TAJWEED_RULES.madda_necessary.color).toBe('#B50000')
    expect(TAJWEED_RULES.qalaqah.colorDark).toBe('#00DEFF')
  })
  it('flags the wording that still needs a teacher review', () => {
    expect(TAJWEED_RULES.slnt.confidence).toMatch(/teacher/)
    expect(TAJWEED_RULES.iqlab.confidence).toMatch(/standard spelling/)
    expect(TAJWEED_RULES.idgham_shafawi.confidence).toMatch(/^colour: /)
  })
})

describe('ruleInfo', () => {
  it('returns catalogue entries', () => {
    expect(ruleInfo('iqlab')).toBe(TAJWEED_RULES.iqlab)
    expect(ruleInfo(' ghunnah ')).toBe(TAJWEED_RULES.ghunnah)
  })
  it('gives the markup helper custom-alef-maksora its parent madda_normal colours', () => {
    const info = ruleInfo('custom-alef-maksora')
    expect(info.id).toBe('custom-alef-maksora')
    expect(info.color).toBe(TAJWEED_RULES.madda_normal.color)
    expect(info.colorDark).toBe(TAJWEED_RULES.madda_normal.colorDark)
    expect(info.citeAr).toBe(TAJWEED_RULES.madda_normal.citeAr)
  })
  it('never throws: unknown ids get a neutral fallback drawn like plain text', () => {
    for (const id of ['izhar', 'end', '', 'toString', '__proto__', 'constructor', undefined, null, 42]) {
      const info = ruleInfo(id as unknown as string)
      expect(info.fallback).toBe(true)
      expect(info.color).toMatch(HEX)
      expect(info.colorDark).toMatch(HEX)
      expect(info.nameAr).toBe('حكم تجويد')
      expect([info.explanationAr, info.explanationEn, info.citeAr]).toEqual(['', '', ''])
    }
  })
})

describe('rulesInAyahs', () => {
  it('lists the rules of Al-Fatiha in first-appearance order with up to 3 distinct examples', () => {
    const rules = rulesInAyahs(fixtureAyahs(1))
    const ids = rules.map((r) => r.rule.id)
    expect(ids.slice(0, 4)).toEqual(['ham_wasl', 'laam_shamsiyah', 'madda_normal', 'madda_permissible'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of rules) {
      expect(r.examples.length).toBeGreaterThan(0)
      expect(r.examples.length).toBeLessThanOrEqual(3)
      expect(new Set(r.examples).size).toBe(r.examples.length)
    }
    // 1:1 w2–w4 (verse-initial «ٱلْحَمْدُ» of 1:2 has no ham_wasl markup: it is pronounced there)
    expect(rules[0].examples).toEqual(fixtureAyah('1:1').words.slice(1).map((w) => w.text))
  })
  it('gives the same rules on the QPC display text, with its own words as examples', () => {
    const tanzil = rulesInAyahs(fixtureAyahs(2))
    const qpc = rulesInAyahs(fixtureAyahs(2, 1, 999, 'qpc'))
    expect(qpc.map((r) => r.rule.id)).toEqual(tanzil.map((r) => r.rule.id))
    const qpcWords = new Set(fixtureAyahs(2, 1, 999, 'qpc').flatMap((a) => a.words.map((w) => w.text)))
    for (const r of qpc) for (const ex of r.examples) expect(qpcWords.has(ex)).toBe(true)
  })
  it('folds custom-alef-maksora into madda_normal (never its own legend entry)', () => {
    const ayah = fixtureAyah('2:2') // «ذَٰلِكَ» carries madda_normal > custom-alef-maksora
    expect(ayah.words[0].tajweed.map((s) => s.rule)).toContain('custom-alef-maksora')
    const ids = rulesInAyahs([ayah]).map((r) => r.rule.id)
    expect(ids).toContain('madda_normal')
    expect(ids).not.toContain('custom-alef-maksora')
  })
  it('only counts the words it is given (trimmed selection)', () => {
    const a = fixtureAyah('112:1') // «قُلْ هُوَ ٱللَّهُ أَحَدٌ»
    expect(rulesInAyahs([a]).map((r) => r.rule.id)).toEqual(['ham_wasl', 'qalaqah'])
    expect(rulesInAyahs([{ ...a, words: a.words.slice(3) }]).map((r) => r.rule.id)).toEqual(['qalaqah'])
    expect(rulesInAyahs([{ ...a, words: a.words.slice(0, 2) }])).toEqual([])
    expect(rulesInAyahs([])).toEqual([])
  })
  it('skips unknown classes and malformed words', () => {
    const a: Ayah = {
      ...fixtureAyah('112:1'),
      words: [
        { position: 1, text: 'x', waqf: null, waqfChar: null, tajweed: [{ start: 0, end: 1, rule: 'izhar' }] },
        { position: 2, text: 'y', waqf: null, waqfChar: null, tajweed: undefined as never },
      ],
    }
    expect(rulesInAyahs([a])).toEqual([])
  })
})
