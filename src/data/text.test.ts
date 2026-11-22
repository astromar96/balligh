// Text helpers over real Quran.com / alquran.cloud verses (fixtures captured 2026-11-21, see __fixtures__/load.ts):
// the QPC display encoding, pause marks, tajweed markup, §3.7 grouping and the projection port.
import aqc112 from './__fixtures__/aqc-surah-112.json'
import qc112 from './__fixtures__/qc-verses-112.json'
import special from './__fixtures__/qc-verses-special.json'
import {
  buildWords,
  charClasses,
  classesToSpans,
  hasTanweenMeem,
  normalizeQuranText,
  opcodes,
  parseAlquranCloudTajweed,
  parseQuranComTajweed,
  parseTajweedVerse,
  project,
  qpcToStandard,
  skeleton,
  splitWaqf,
  tanzilToStandard,
  wordRanges,
  type WordSource,
} from './text'

type Verse = {
  verse_key: string
  text_uthmani_tajweed: string
  words: { position: number; char_type_name: string; text_uthmani: string; text_qpc_hafs: string }[]
}
const verse = (key: string): Verse => (special as unknown as Record<string, Verse>)[key]
const wordsOf = (v: Verse) => v.words.filter((w) => w.char_type_name === 'word')
const wordTexts = (v: Verse) => wordsOf(v).map((w) => w.text_uthmani)
const sources = (v: Verse): WordSource[] => wordsOf(v).map((w) => ({ tanzil: w.text_uthmani, qpc: w.text_qpc_hafs }))
const build = (key: string) => {
  const v = verse(key)
  return buildWords(sources(v), parseQuranComTajweed(v.text_uthmani_tajweed))
}
const word = (key: string, position: number) => build(key).words[position - 1]
const codes = (s: string) => [...s].map((c) => (c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')).join(' ')

describe('qpcToStandard (QPC Hafs → the encoding Amiri Quran draws)', () => {
  it('maps the open tanween to U+08F0–U+08F2 (raw QPC U+065E has no glyph in Amiri)', () => {
    expect(qpcToStandard('هُدٗى')).toBe('هُد\u{08F0}ى')
    expect(qpcToStandard('عَلِيمٞ')).toBe('عَلِيم\u{08F1}')
    expect(qpcToStandard('ظُلُمَٰتٖ')).toBe('ظُلُمَٰت\u{08F2}')
  })

  it('writes a word-final yeh dotless (U+0649) as the Madani Mushaf prints it, and leaves other yehs alone', () => {
    expect(codes(qpcToStandard('فِي'))).toBe(codes('فِى'))
    expect(qpcToStandard('ٱلَّذِي')).toBe('ٱلَّذِى')
    expect(qpcToStandard('ذُرِّيَّتِيۖ')).toBe('ذُرِّيَّتِىۖ') // before an attached pause mark
    expect(qpcToStandard('بَرِيٓءٞ')).toBe('بَرِىٓء\u{08F1}') // before a hamza (does not join)
    expect(qpcToStandard('وَلِيِّۦ')).toBe('وَلِىِّۦ') // before the small yeh
    expect(qpcToStandard('تِلۡقَآيِٕ')).toBe('تِلۡقَآىِٕ') // the hamza seat, hamza below as printed
    expect(qpcToStandard('فِيهِ')).toBe('فِيهِ') // medial
    expect(qpcToStandard('يَٰٓأَيُّهَا')).toBe('يَٰٓأَيُّهَا') // initial (joins the alef)
    expect(qpcToStandard('إِلۡ يَاسِينَ')).toBe('إِلۡ يَاسِينَ')
  })

  it('is length-preserving and idempotent', () => {
    for (const v of Object.values(special as unknown as Record<string, Verse>)) {
      for (const w of wordsOf(v)) {
        const once = qpcToStandard(w.text_qpc_hafs)
        expect(once.length).toBe(w.text_qpc_hafs.length)
        expect(qpcToStandard(once)).toBe(once)
      }
    }
  })
})

describe('tanzilToStandard (the alquran.cloud fallback)', () => {
  it('maps open tanween + small meem to U+08F0–U+08F2 (no stray meem) and iqlab to haraka + meem', () => {
    expect(tanzilToStandard('هُدًۭى')).toBe('هُد\u{08F0}ى')
    expect(tanzilToStandard('عَظِيمٌۭ')).toBe('عَظِيم\u{08F1}')
    expect(tanzilToStandard('كَصَيِّبٍۢ')).toBe('كَصَيِّب\u{08F2}')
    expect(tanzilToStandard('أَلِيمٌۢ')).toBe('أَلِيمُۢ')
    expect(tanzilToStandard('كَافِرٍۭ')).toBe('كَافِرِۭ')
    expect(hasTanweenMeem('هُدًۭى')).toBe(true)
    expect(hasTanweenMeem(tanzilToStandard('هُدًۭى'))).toBe(false)
  })

  it('writes sukun and the silent-letter zero as QPC does, so the two paths look the same', () => {
    expect(tanzilToStandard('ٱلْكِتَـٰبُ')).toBe('ٱلۡكِتَـٰبُ')
    expect(tanzilToStandard('ءَامَنُوا۟')).toBe('ءَامَنُواْ')
    const kursi = wordsOf(verse('2:255'))
    expect(kursi.filter((w) => tanzilToStandard(w.text_uthmani).replace(' ۚ', 'ۚ') === qpcToStandard(w.text_qpc_hafs)).length).toBeGreaterThan(40)
  })
})

describe('normalizeQuranText', () => {
  it('drops invisible format characters (RLM after ۩ in 27:26, BOM) and collapses spaces', () => {
    expect(normalizeQuranText('ٱلْعَظِيمِ ۩\u{200F}')).toBe('ٱلْعَظِيمِ ۩')
    expect(normalizeQuranText('\u{FEFF}بِسْمِ')).toBe('بِسْمِ')
    expect(normalizeQuranText(' أَنفُسِهِمْ \u{00A0} ۖ ')).toBe('أَنفُسِهِمْ ۖ')
  })

  it('sets ۩ after a space (QPC glues it to the word in 6 of 15 words)', () => {
    expect(normalizeQuranText('ٱلۡعَظِيمِ۩')).toBe('ٱلۡعَظِيمِ ۩')
    expect(normalizeQuranText('خُشُوعٗا ۩')).toBe('خُشُوعٗا ۩')
  })

  it('maps the tajweed-text stand-ins the font lacks (U+0672 → U+0670, U+066E → U+0649)', () => {
    expect(normalizeQuranText('ٱفْتَرَ\u{066E}\u{0672}هُ')).toBe('ٱفْتَرَ\u{0649}\u{0670}هُ')
  })

  it('never reorders marks (no NFC)', () => {
    const shaddaFatha = 'ل\u{0651}\u{064E}'
    expect(normalizeQuranText(shaddaFatha)).toBe(shaddaFatha)
    expect(shaddaFatha.normalize('NFC')).not.toBe(shaddaFatha)
  })
})

describe('splitWaqf', () => {
  it.each([
    ['\u{06D6}', 'wasl_awla'],
    ['\u{06D7}', 'waqf_awla'],
    ['\u{06D8}', 'lazim'],
    ['\u{06D9}', 'mamnu'],
    ['\u{06DA}', 'jaiz'],
    ['\u{06DB}', 'muanaqa'],
    ['\u{06DC}', 'saktah'],
  ])('maps %s to %s', (mark, kind) => {
    expect(splitWaqf(`فَوْقَهَا ${mark}`)).toEqual({ text: 'فَوْقَهَا', waqfChar: mark, waqf: kind })
  })

  it('splits marks separated by ZWNJ (tajweed text), NBSP or a double space (11:31), and attached marks (QPC, 18:1)', () => {
    expect(splitWaqf('فَوْقَهَا\u{200C}\u{06DA}')).toEqual({ text: 'فَوْقَهَا', waqfChar: '\u{06DA}', waqf: 'jaiz' })
    expect(splitWaqf('فَوْقَهَا\u{00A0}\u{06DA}').waqfChar).toBe('\u{06DA}')
    expect(splitWaqf('فَوۡقَهَاۚ')).toEqual({ text: 'فَوۡقَهَا', waqfChar: '\u{06DA}', waqf: 'jaiz' })
    expect(splitWaqf(wordTexts(verse('11:31'))[26])).toEqual({ text: 'أَنفُسِهِمْ', waqfChar: '\u{06D6}', waqf: 'wasl_awla' })
    expect(splitWaqf(wordTexts(verse('18:1'))[10])).toEqual({ text: 'عِوَجَا', waqfChar: '\u{06DC}', waqf: 'saktah' })
  })

  it('keeps both marks of 36:52 (Tanzil spaced, QPC attached) and picks the stop-relevant kind', () => {
    const raw = wordTexts(verse('36:52'))[5]
    expect(splitWaqf(raw)).toEqual({ text: raw.split(' ')[0], waqfChar: '\u{06DC} \u{06D7}', waqf: 'waqf_awla' })
    expect(splitWaqf(wordsOf(verse('36:52'))[5].text_qpc_hafs)).toMatchObject({ waqfChar: '\u{06DC} \u{06D7}', waqf: 'waqf_awla' })
  })

  it('leaves marks inside a word (2:245), ۩, bare marks and plain words alone', () => {
    const inside = wordTexts(verse('2:245'))[13]
    expect(inside).toContain('\u{06DC}')
    expect(splitWaqf(inside)).toEqual({ text: inside, waqfChar: null, waqf: null })
    expect(splitWaqf('يَسْجُدُونَ ۩')).toEqual({ text: 'يَسْجُدُونَ ۩', waqfChar: null, waqf: null })
    expect(splitWaqf('\u{06DA}')).toEqual({ text: '\u{06DA}', waqfChar: null, waqf: null })
    expect(splitWaqf('قُلْ')).toEqual({ text: 'قُلْ', waqfChar: null, waqf: null })
  })
})

describe('parseQuranComTajweed', () => {
  it('strips tags and the ayah-end span, keeping spans on the plain text (112:1)', () => {
    const p = parseQuranComTajweed(qc112.verses[0].text_uthmani_tajweed)
    expect(p.plain).toBe(qc112.verses[0].words.filter((w) => w.char_type_name === 'word').map((w) => w.text_uthmani).join(' '))
    expect(p.ayahNumber).toBe('١')
    expect(p.spans.map((s) => [p.plain.slice(s.start, s.end), s.cls])).toEqual([
      ['ٱ', 'ham_wasl'],
      ['د', 'qalaqah'],
    ])
  })

  it('survives the broken opener of 32:3 (no stray angle brackets in the plain text)', () => {
    const p = parseQuranComTajweed(verse('32:3').text_uthmani_tajweed)
    expect(p.plain).not.toMatch(/[<>]/)
    expect(p.plain).toContain('ٱفْتَرَ\u{066E}\u{0670}هُ')
    expect(p.spans.every((s) => s.end > s.start && s.end <= p.plain.length)).toBe(true)
  })

  it('reads the word-level <rule> variant and nested spans, innermost class winning per character', () => {
    expect(parseQuranComTajweed('أَحَ<rule class=qalaqah>د</rule>ٌ').spans).toEqual([{ start: 4, end: 5, cls: 'qalaqah', depth: 0 }])
    const p = parseQuranComTajweed('قَالُ<tajweed class=madda_normal>و<tajweed class=slnt>اْ</tajweed></tajweed>')
    expect(p.plain).toBe('قَالُواْ')
    expect(p.spans.map((s) => [s.cls, s.depth])).toEqual([
      ['madda_normal', 0],
      ['slnt', 1],
    ])
    expect(charClasses(p.spans, 0, p.plain.length)).toEqual([null, null, null, null, null, 'madda_normal', 'slnt', 'slnt'])
  })
})

describe('parseAlquranCloudTajweed', () => {
  it('yields the same plain text and classes as Quran.com for 112:2', () => {
    const aq = parseAlquranCloudTajweed(aqc112.data[1].ayahs[1].text)
    const qc = parseQuranComTajweed(qc112.verses[1].text_uthmani_tajweed)
    expect(aq.plain).toBe(qc.plain)
    expect(aq.spans.map((s) => [s.start, s.end, s.cls])).toEqual(qc.spans.map((s) => [s.start, s.end, s.cls]))
  })

  it('maps every code letter and ignores the class-less opener', () => {
    const p = parseAlquranCloudTajweed('[h:1[ٱ]ل[ٮٰ]ه[o[ُوٓ[s[اْ]]')
    expect(p.plain).toBe('ٱلٮٰهُوٓاْ')
    expect(p.spans.map((s) => s.cls)).toEqual(['ham_wasl', 'madda_obligatory', 'slnt'])
  })
})

describe('wordRanges (§3.7 token merges)', () => {
  const ranges = (key: string) => {
    const v = verse(key)
    const p = parseQuranComTajweed(v.text_uthmani_tajweed)
    return wordRanges(p.plain, wordTexts(v)).map(([a, b]) => p.plain.slice(a, b))
  }

  it('joins a leading ۞ to the next word and ZWNJ-glued pause marks stay with their word (2:26)', () => {
    const r = ranges('2:26')
    expect(r).toHaveLength(39)
    expect(r[0]).toBe(wordTexts(verse('2:26'))[0])
    expect(r[0].startsWith('۞ ')).toBe(true)
    expect(r[10]).toBe('فَوْقَهَا\u{200C}\u{06DA}')
  })

  it('joins ۩ to the previous word (7:206) and absorbs two-token words (8:6, 37:130)', () => {
    expect(ranges('7:206').at(-1)).toBe('يَسْجُدُونَ ۩')
    expect(ranges('8:6')[3]).toBe('بَعْدَ مَا')
    expect(ranges('37:130')[2]).toBe('إِلْ يَاسِينَ')
  })

  it('throws when the words do not fit the tokens', () => {
    expect(() => wordRanges('قُلْ هُوَ', ['قُلْ', 'هُوَ', 'ٱللَّهُ'])).toThrow(/ran out/)
    expect(() => wordRanges('قُلْ هُوَ ٱللَّهُ', ['قُلْ'])).toThrow(/left over/)
  })

  it('skeleton folds alef/yeh forms and drops marks, ۞, ۩ and digits', () => {
    expect(skeleton('۞ إِنَّ')).toBe('ان')
    expect(skeleton('عَلَىٰٓ')).toBe('علي')
    expect(skeleton('يَسْجُدُونَ ۩ ٢٠٦')).toBe('يسجدون')
  })
})

describe('opcodes (difflib.SequenceMatcher port)', () => {
  // reference: python3 -c "difflib.SequenceMatcher(None, list(a), list(b), autojunk=False).get_opcodes()"
  it.each([
    ['abxcd', 'abcd', [['equal', 0, 2, 0, 2], ['delete', 2, 3, 2, 2], ['equal', 3, 5, 2, 4]]],
    ['abcd', 'abxcd', [['equal', 0, 2, 0, 2], ['insert', 2, 2, 2, 3], ['equal', 2, 4, 3, 5]]],
    ['qabxyzc', 'abyc', [['delete', 0, 1, 0, 0], ['equal', 1, 3, 0, 2], ['delete', 3, 4, 2, 2], ['equal', 4, 5, 2, 3], ['delete', 5, 6, 3, 3], ['equal', 6, 7, 3, 4]]],
    ['aaaa', 'aa', [['equal', 0, 2, 0, 2], ['delete', 2, 4, 2, 2]]],
    ['abcabc', 'cba', [['insert', 0, 0, 0, 2], ['equal', 0, 1, 2, 3], ['delete', 1, 6, 3, 3]]],
    ['', 'ab', [['insert', 0, 0, 0, 2]]],
    ['ab', '', [['delete', 0, 2, 0, 0]]],
    ['ٱلۡعَظِيمِ', 'ٱلْعَظِيمِ', [['equal', 0, 2, 0, 2], ['replace', 2, 3, 2, 3], ['equal', 3, 10, 3, 10]]],
  ])('%s vs %s', (a, b, expected) => {
    expect(opcodes([...a], [...b])).toEqual(expected)
  })
})

describe('project (tajweed_projection_check.py project())', () => {
  it('maps equal characters 1:1 and treats canonical equivalents as equal (sukun forms, open tanween, yeh forms)', () => {
    expect(project('ab', ['x', 'y'], 'ab')).toEqual({ classes: ['x', 'y'], clean: true })
    const r = project('عَلِيمٌ', [null, null, null, null, 'm', 'm', 't'], 'عَلِيم\u{08F1}')
    expect(r.classes).toEqual([null, null, null, null, 'm', 'm', 't'])
    expect(project('فِى', ['a', 'b', 'c'], 'فِى').classes).toEqual(['a', 'b', 'c'])
    expect(project('ْ', ['s'], 'ۡ').classes).toEqual(['s'])
  })

  it('gives a target-only mark the next source class, a target-only letter the previous one, tatweel its mark', () => {
    // U+06ED small low meem only in the target: takes the class of what follows it in the source
    expect(project('بًى', ['a', 'b', 'c'], 'بًۭى').classes).toEqual(['a', 'b', 'c', 'c'])
    // tatweel in the target takes the class of the dagger alef after it
    expect(project('مَٰ', [null, null, 'n'], 'مَـٰ').classes).toEqual([null, null, 'n', 'n'])
    // whitespace is never coloured
    expect(project('a b', ['x', 'x', 'x'], 'a b').classes).toEqual(['x', null, 'x'])
  })

  it('marks a coloured unequal match as not clean', () => {
    expect(project('ab', ['x', 'y'], 'ac').clean).toBe(false)
    expect(project('ab', ['x', null], 'ac').clean).toBe(true)
    expect(classesToSpans(['x', 'x', null, 'y'])).toEqual([
      { start: 0, end: 2, rule: 'x' },
      { start: 3, end: 4, rule: 'y' },
    ])
  })
})

describe('buildWords (display words of an ayah)', () => {
  it('displays qpcToStandard(text_qpc_hafs) and projects tajweed onto it (112:1)', () => {
    const v = qc112.verses[0]
    const ws = v.words.filter((w) => w.char_type_name === 'word')
    const { words, alignmentFailed } = buildWords(
      ws.map((w) => ({ tanzil: w.text_uthmani, qpc: w.text_qpc_hafs })),
      parseQuranComTajweed(v.text_uthmani_tajweed),
    )
    expect(alignmentFailed).toBe(false)
    expect(words.map((w) => w.text)).toEqual(ws.map((w) => qpcToStandard(w.text_qpc_hafs)))
    expect(words[2].tajweed).toEqual([{ start: 0, end: 1, rule: 'ham_wasl' }])
    expect(words[3].tajweed).toEqual([{ start: 4, end: 5, rule: 'qalaqah' }])
    expect(words.map((w) => w.position)).toEqual([1, 2, 3, 4])
  })

  it('draws no stray meem: open tanween and iqlab in QPC form, tajweed on the same letters (2:10)', () => {
    const ws = build('2:10').words
    expect(ws.some((w) => hasTanweenMeem(w.text))).toBe(false)
    expect(ws[0].text).toBe('فِى') // final yeh dotless
    const alim = ws[8] // أَلِيمُۢ before بِمَا: iqlab
    expect(alim.text).toBe('أَلِيمُۢ')
    expect(alim.tajweed.map((s) => s.rule)).toContain('iqlab')
    expect(wordTexts(verse('2:10'))[2]).toContain('\u{06ED}') // Tanzil: tanween + small meem
  })

  it('keeps ۞ in the word text, colours the right letters and splits the printed QPC mark (2:26)', () => {
    const { words, alignmentFailed } = build('2:26')
    expect(alignmentFailed).toBe(false)
    expect(words[0].text.startsWith('۞ ')).toBe(true)
    expect(words[0].tajweed.map((s) => [words[0].text.slice(s.start, s.end), s.rule])).toEqual([['\u{0646}\u{0651}', 'ghunnah']]) // noon + shadda, as the markup colours it
    expect(words[10]).toMatchObject({ text: 'فَوۡقَهَا', waqf: 'jaiz', waqfChar: '\u{06DA}' })
  })

  it('takes the guard from Tanzil and the printed mark from QPC (D1): 2:25 ۙ is guarded but not printed', () => {
    const w = word('2:25', 18)
    expect(wordTexts(verse('2:25'))[17]).toContain('\u{06D9}')
    expect(w).toMatchObject({ waqf: 'mamnu', waqfChar: null })
    expect(w.text).toBe(qpcToStandard(wordsOf(verse('2:25'))[17].text_qpc_hafs))
  })

  it('handles the special words: 36:52 two marks, 18:1 saktah, 27:26 ۩, inner ۜ (2:245, 52:37), 37:130, 8:6', () => {
    expect(word('36:52', 6)).toMatchObject({ waqfChar: '\u{06DC} \u{06D7}', waqf: 'waqf_awla' })
    expect(word('36:52', 6).text.endsWith('نَا')).toBe(true)
    expect(word('18:1', 11)).toMatchObject({ text: 'عِوَجَا', waqf: 'saktah', waqfChar: '\u{06DC}' })
    expect(word('27:26', 8).text).toBe('ٱلۡعَظِيمِ ۩')
    expect(word('2:245', 14)).toMatchObject({ waqf: null, waqfChar: null })
    expect(word('2:245', 14).text).toContain('\u{06DC}')
    expect(word('52:37', 7).text).toContain('\u{06DC}')
    expect(word('52:37', 7).waqfChar).toBeNull()
    expect(word('37:130', 3).text).toBe('إِلۡ يَاسِينَ')
    expect(word('8:6', 4).text).toBe('بَعۡدَ مَا')
  })

  it('loses one class in the whole Quran: madda_normal of 17:7:12 (QPC does not write the small waw)', () => {
    const b = build('17:7').built[11]
    expect(b.lostClasses).toEqual(['madda_normal'])
    expect(build('17:7').built.filter((x) => x.lostClasses.length).length).toBe(1)
  })

  it('aligns every special verse: spans inside their word, no class on a space, display words clean', () => {
    for (const key of Object.keys(special)) {
      const { words, alignmentFailed } = build(key)
      expect(alignmentFailed, key).toBe(false)
      for (const w of words) {
        expect(w.text, key).toBe(w.text.trim())
        expect(/[\u{06D6}-\u{06DC}]$/u.test(w.text), key).toBe(false)
        expect(hasTanweenMeem(w.text), key).toBe(false)
        for (const s of w.tajweed) {
          expect(s.start, key).toBeGreaterThanOrEqual(0)
          expect(s.end, key).toBeLessThanOrEqual(w.text.length)
          expect(w.text.slice(s.start, s.end).includes(' '), key).toBe(false)
        }
      }
    }
  })

  it('displays the Tanzil text mapped when there is no QPC text (fallback), with Tanzil marks printed', () => {
    const v = verse('2:25')
    const { words } = buildWords(
      wordTexts(v).map((t) => ({ tanzil: t, qpc: null })),
      parseQuranComTajweed(v.text_uthmani_tajweed),
    )
    expect(words.some((w) => hasTanweenMeem(w.text))).toBe(false)
    expect(words[17]).toMatchObject({ waqf: 'mamnu', waqfChar: '\u{06D9}' })
  })

  it('degrades to no tajweed (never throws) when the markup does not match the words', () => {
    const r = buildWords(
      [
        { tanzil: 'قُلْ', qpc: 'قُلۡ' },
        { tanzil: 'هُوَ', qpc: 'هُوَ' },
      ],
      parseQuranComTajweed('قُلْ'),
    )
    expect(r.alignmentFailed).toBe(true)
    expect(r.words.map((w) => w.tajweed)).toEqual([[], []])
  })
})

describe('parseTajweedVerse (public token parser)', () => {
  it('returns tokens with spans and ZWNJ-glued pause marks split off', () => {
    const toks = parseTajweedVerse(verse('2:26').text_uthmani_tajweed)
    expect(toks[0]).toEqual({ text: '۞', spans: [], waqfChar: null })
    expect(toks[1]).toEqual({ text: wordTexts(verse('2:26'))[0].slice(2), spans: [{ start: 2, end: 4, rule: 'ghunnah' }], waqfChar: null })
    expect(toks[11]).toEqual({ text: 'فَوْقَهَا', spans: [], waqfChar: '\u{06DA}' })
  })
})
