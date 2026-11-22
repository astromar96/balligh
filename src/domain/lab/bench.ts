// Dev bench for src/domain on the web (/lab/domain): re-runs the key unit-test facts inside the Metro bundle
// (Babel/Hermes-compatible code paths, regexes, Arabic strings) and returns data for the lab page to show.
// Uses the committed test fixtures (real API payloads) in the app's display encoding (contract v2: QPC text
// mapped by qpcToStandard; the guard reads the Tanzil marks) — dev route only, never part of the app.
import type { AudioPlan, Ayah, Selection, Timeline } from '../../core/types'
import {
  AYAH_END_WORD,
  buildTimeline,
  clampSelection,
  decodeShareState,
  DEFAULT_DESIGN,
  describeSelection,
  encodeShareState,
  estimatePlanDurationMs,
  MAX_VIDEO_MS,
  normalizeForSearch,
  planAudio,
  rulesInAyahs,
  ruleInfo,
  selectionWarnings,
  snapToPauses,
  TAJWEED_RULES,
  toArabicDigits,
  WAQF_INFO,
  waqfKindOf,
  warningSeverity,
  type SelectionWarning,
  type ShareState,
} from '../index'
import {
  DISPLAYS,
  everyAyahUrl,
  fixtureAyah,
  fixtureAyahs,
  istiadhaAudio,
  perAyahAudio,
  qdcAudio,
  RECITER_A,
  RECITER_B,
  RECITER_C,
  SURAHS,
  v4Audio,
  type Display,
  type QdcVerseTiming,
} from '../__fixtures__/load'
import v255 from '../__fixtures__/audio/qcom_v4_verse_2_255_audio7.json'
import ch1v4 from '../__fixtures__/audio/qcom_v4_recitations_7_by_chapter_1_segments.json'
import s1121 from '../__fixtures__/audio/qcom_v4_recitations_7_by_ayah_112_1_segments.json'
import qdc7 from '../__fixtures__/audio/qdc_audio_files_7_ch1_segments.json'

export interface LabCheck {
  name: string
  ok: boolean
  detail: string
}

export interface LabWarning {
  kind: SelectionWarning['kind']
  severity: 'warning' | 'info'
  detail: string
}

export interface DomainLabResult {
  checks: LabCheck[]
  labels: { selection: string; ar: string; en: string; warnings: LabWarning[] }[]
  links: { query: string; roundTrip: boolean }[]
  rules: {
    id: string
    nameAr: string
    nameEn: string
    explanationAr: string
    explanationEn: string
    citeAr: string
    color: string
    colorDark: string
    group: string
    examples: string[]
  }[]
  plan: AudioPlan
  timeline: Timeline
  /** isti'adha + basmala + 112:1 (Alafasy): what the media is asked to play, in order */
  preamble: { ayah: number; file: string; window: string; trimSilence: boolean }[]
  estimateMs: number | null
  maxVideoMs: number
}

/** Surahs that have verses in src/domain/__fixtures__/verses.json. */
const FIXTURE_SURAHS = [1, 2, 4, 5, 13, 15, 16, 18, 26, 36, 37, 53, 69, 75, 83, 103, 107, 112]
/** The app's display encoding (contract v2). */
const SHOWN: Display = 'qpc'
const EA = 'Alafasy_128kbps'

const sel = (surah: number, a1: number, w1: number, a2: number, w2: number): Selection => ({
  surah,
  start: { ayah: a1, word: w1 },
  end: { ayah: a2, word: w2 },
})
const A = (key: string) => [fixtureAyah(key, SHOWN)]
const S = (n: number, display: Display = SHOWN) => fixtureAyahs(n, 1, 999, display)
const ref = (r: { ayah: number; word: number }) => `${r.ayah}:${r.word === AYAH_END_WORD ? 'end' : r.word}`

function warningDetail(w: SelectionWarning): string {
  switch (w.kind) {
    case 'starts-after-speech-verb':
      return `at ${ref(w.at)}, verb ${ref(w.verb)}`
    case 'ends-curated':
    case 'next-starts-with-illa':
      return `at ${ref(w.at)} → extend to ${ref(w.extendTo)}`
    case 'pause-hint':
      return `${w.mark === 'muanaqa' ? 'U+06DB' : 'U+06D6'} at ${ref(w.at)}${w.bothStops ? ', both marks of the pair' : ''}`
    case 'long':
      return `${w.count} words`
    default:
      return `at ${ref(w.at)}`
  }
}

export function runDomainLab(): DomainLabResult {
  const checks: LabCheck[] = []
  const check = (name: string, actual: unknown, expected: unknown) => {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    checks.push({ name, ok: a === e, detail: a === e ? a : `got ${a}, want ${e}` })
  }

  // ── audio planner on real payloads (research/fixtures/audio-timing/cut_planner_test_output.txt) ──
  const a255 = v4Audio('2:255', everyAyahUrl(EA, 2, 255), v255.verse.audio.segments)
  const p1 = planAudio(sel(2, 255, 3, 255, 5), A('2:255'), [a255], RECITER_A, { basmala: null })
  check('plan 2:255 w3–w5 (Alafasy v4)', p1.clips.map((c) => [c.srcStartMs, c.srcEndMs, c.trimSilence]), [[1050, 4580, false]])
  const f = qdc7.audio_files[0] as { audio_url: string; verse_timings: QdcVerseTiming[] }
  const qdc = ['1:2', '1:3', '1:4'].map((k) => qdcAudio(f.verse_timings.find((v) => v.verse_key === k)!, f.audio_url)!)
  const plan = planAudio(sel(1, 2, 2, 4, 2), S(1), qdc, RECITER_B, { basmala: null })
  check('plan QDC 1:2 w2 → 1:4 w2 merged', plan.clips.map((c) => [c.srcStartMs, c.srcEndMs, c.ayah, c.ayahTo]), [[7025, 17660, 2, 4]])
  const timeline = buildTimeline(plan, [{ srcStartMs: 7025, durationMs: 10635, wordTimingsValid: true }])
  check(
    'timeline highlights = reference',
    timeline.words.map((w) => [w.ayah, w.word, w.startMs, w.endMs]),
    [
      [2, 2, 0, 860],
      [2, 3, 860, 1490],
      [2, 4, 1490, 4525],
      [3, 1, 4590, 5830],
      [3, 2, 5830, 9155],
      [4, 1, 9220, 10040],
      [4, 2, 10040, 10635],
    ],
  )
  const estimateMs = estimatePlanDurationMs(plan)
  check('estimatePlanDurationMs(merged QDC clip)', estimateMs, 10635)
  check('MAX_VIDEO_MS (00-gaps D3)', MAX_VIDEO_MS, 300_000)

  // isti'adha (own audhubillah.mp3) → basmala (001001.mp3 cut by its segments) → 112:1
  const bas = v4Audio('1:1', everyAyahUrl(EA, 1, 1), ch1v4.audio_files.find((x) => x.verse_key === '1:1')!.segments, 6031)
  const a1121 = v4Audio('112:1', everyAyahUrl(EA, 112, 1), s1121.audio_files[0].segments)
  const pre = planAudio(sel(112, 1, 1, 1, 4), A('112:1'), [a1121, istiadhaAudio(EA)], RECITER_A, { basmala: bas, istiadha: true })
  const preamble = pre.clips.map((c) => ({
    ayah: c.ayah,
    file: c.url.split('/').pop() ?? '',
    window: `${c.srcStartMs}–${c.srcEndMs ?? 'end'} ms`,
    trimSilence: c.trimSilence,
  }))
  check("isti'adha, basmala, ayah: clip order", pre.clips.map((c) => c.ayah), [-1, 0, 1])
  check("trimSilence: only the untimed isti'adha file", pre.clips.map((c) => c.trimSilence), [true, false, false])
  const preTl = buildTimeline(pre, [
    { srcStartMs: 300, durationMs: 6200, wordTimingsValid: true },
    { srcStartMs: 60, durationMs: 5971, wordTimingsValid: true },
    { srcStartMs: 30, durationMs: 2620, wordTimingsValid: true },
  ])
  check('timeline ayahs -1, 0, 1', preTl.ayahs.map((a) => [a.ayah, a.startMs, a.endMs]), [
    [-1, 0, 6200],
    [0, 6200, 12171],
    [1, 12171, 14791],
  ])
  check("estimate is null with an untimed whole file (the isti'adha)", estimatePlanDurationMs(pre), null)
  check("no isti'adha unless asked for", planAudio(sel(112, 1, 1, 1, 4), A('112:1'), [a1121, istiadhaAudio(EA)], RECITER_A, { basmala: bas }).clips.map((c) => c.ayah), [0, 1])
  const maher = (k: string) => perAyahAudio(k, everyAyahUrl('MaherAlMuaiqly128kbps', 112, Number(k.split(':')[1])))
  const classC = planAudio(sel(112, 2, 2, 3, 2), S(112), [maher('112:2'), maher('112:3')], RECITER_C, { basmala: null })
  check('class C whole files: trimSilence', classC.clips.map((c) => [c.ayah, c.trimSilence]), [
    [2, true],
    [3, true],
  ])

  // ── selection integrity on real pause marks (named by code point: UI fonts have no glyphs for lone marks) ──
  check('snapToPauses 4:43 w1–w6 → w19 (U+06DA jaiz)', snapToPauses(sel(4, 43, 1, 43, 6), A('4:43')).end, { ayah: 43, word: 19 })
  check('16:57 w1–w4 ends on U+06D9 (Tanzil; QPC prints none)', selectionWarnings(sel(16, 57, 1, 57, 4), A('16:57')).map((w) => w.kind), ['ends-on-mamnu'])
  check('26:59 w1: QPC prints U+06D6, Tanzil has no mark → mid-phrase', selectionWarnings(sel(26, 59, 1, 59, 1), A('26:59')).map((w) => w.kind), ['ends-mid-phrase'])
  check('5:73 w5–w8 starts after «قالوا»', selectionWarnings(sel(5, 73, 5, 73, 8), A('5:73'))[0], {
    kind: 'starts-after-speech-verb',
    at: { ayah: 73, word: 5 },
    verb: { ayah: 73, word: 4 },
  })
  check('107:4 ends on the curated list → extend to 107:5', selectionWarnings(sel(107, 4, 1, 4, AYAH_END_WORD), S(107)), [
    { kind: 'ends-curated', at: { ayah: 4, word: 2 }, extendTo: { ayah: 5, word: 5 } },
  ])
  check('103:2 → 103:3 starts with «إلا»', selectionWarnings(sel(103, 2, 1, 2, 4), S(103)), [
    { kind: 'next-starts-with-illa', at: { ayah: 2, word: 4 }, extendTo: { ayah: 3, word: 9 } },
  ])
  check('no illa warning before 2:12 «ألا» (2:11 w1–w11)', selectionWarnings(sel(2, 11, 1, 11, 11), S(2)), [])
  const hint = selectionWarnings(sel(2, 2, 1, 2, 4), A('2:2'))
  check('2:2 w1–w4 ends on U+06DB: info', hint.map((w) => [w.kind, warningSeverity(w)]), [['pause-hint', 'info']])
  const both = selectionWarnings(sel(2, 2, 5, 2, 5), A('2:2'))
  check('2:2 w5 alone stops at both U+06DB: warning', both.map((w) => [w.kind, warningSeverity(w)]), [['pause-hint', 'warning']])
  check('snapToPauses 2:2 w5–w5 → w7 (past the pair)', snapToPauses(sel(2, 2, 5, 2, 5), A('2:2')).end, { ayah: 2, word: 7 })
  check('waqfKindOf 36:52 «U+06DC U+06D7» → waqf_awla', waqfKindOf('مَّرْقَدِنَا ۜ ۗ'), 'waqf_awla')
  check('WAQF_INFO kinds', Object.keys(WAQF_INFO).length, 7)

  // the same answers whatever the display encoding (every word of every fixture ayah, both directions)
  let cases = 0
  let mismatches = 0
  for (const n of FIXTURE_SURAHS) {
    const [u, q] = DISPLAYS.map((d) => S(n, d))
    for (const a of u) {
      for (const w of a.words) {
        for (const s of [sel(n, a.number, w.position, a.number, AYAH_END_WORD), sel(n, a.number, 1, a.number, w.position)]) {
          cases++
          const same =
            JSON.stringify(snapToPauses(s, u)) === JSON.stringify(snapToPauses(s, q)) &&
            JSON.stringify(selectionWarnings(s, u)) === JSON.stringify(selectionWarnings(s, q))
          if (!same) mismatches++
        }
      }
    }
  }
  check(`snap + warnings equal on Tanzil and QPC text (${cases} selections)`, mismatches, 0)

  // ── Arabic helpers ──
  check('toArabicDigits(255)', toArabicDigits(255), '٢٥٥')
  check('normalizeForSearch(ٱلْكِتَـٰبُ)', normalizeForSearch('ٱلْكِتَـٰبُ'), 'الكتب')
  check('normalizeForSearch(يا أيها الذين آمنوا)', normalizeForSearch('يا أيها الذين آمنوا'), 'يا ايها الذين امنوا')
  check('normalizeForSearch: QPC open tanween = Tanzil', normalizeForSearch(fixtureAyah('5:73', 'qpc').words[7].text), normalizeForSearch(fixtureAyah('5:73').words[7].text))

  // ── tajweed catalogue ──
  const all = Object.values(TAJWEED_RULES)
  check('TAJWEED_RULES count', all.length, 19)
  check('ruleInfo(unknown) is a fallback', ruleInfo('izhar').fallback, true)
  check('D10: madda_permissible / madda_obligatory names', [TAJWEED_RULES.madda_permissible.nameAr, TAJWEED_RULES.madda_obligatory.nameAr], [
    'المد العارض للسكون',
    'المد المتصل والمنفصل',
  ])
  check('every rule has an English explanation and a citation', all.filter((r) => !r.explanationEn || !r.citeAr).map((r) => r.id), [])
  check(
    'citations: Tuhfat al-Atfal or the general Hafs reference',
    all.filter((r) => !/^تحفة الأطفال — /.test(r.citeAr) && r.citeAr !== 'أحكام التجويد برواية حفص عن عاصم').map((r) => r.id),
    [],
  )
  const fatihaRules = rulesInAyahs(S(1))
  check('rulesInAyahs(Al-Fatiha) first rules', fatihaRules.slice(0, 4).map((r) => r.rule.id), ['ham_wasl', 'laam_shamsiyah', 'madda_normal', 'madda_permissible'])

  // ── share links ──
  const baqarah = S(2)
  const states: ShareState[] = [
    { selection: sel(2, 255, 1, 257, AYAH_END_WORD), reciterId: 'alafasy', istiadha: true, tafsirId: 'mukhtasar', translationId: 20, design: {} },
    { selection: sel(2, 255, 3, 257, 5), reciterId: 'yasser-dosari', tafsirId: null, translationId: null, design: { aspect: '1:1', overlay: 0.5, showTajweed: true } },
    { selection: sel(112, 1, 1, 4, AYAH_END_WORD), reciterId: '', tafsirId: null, translationId: null, design: { textTone: 'dark', showWatermark: false } },
  ]
  const links = states.map((s) => {
    const query = encodeShareState(s)
    return { query, roundTrip: JSON.stringify(decodeShareState(query)) === JSON.stringify(s) }
  })
  check('share links round-trip', links.every((l) => l.roundTrip), true)
  check("share link carries the isti'adha as i=1", links[0].query, 'v=1&s=2&a=255-257&r=alafasy&i=1&tf=mukhtasar&tr=20')
  check('decode(a=255-257) + clampSelection', clampSelection(decodeShareState('v=1&s=2&a=255-257')!.selection, baqarah), sel(2, 255, 1, 257, 24))
  check('DEFAULT_DESIGN frozen', Object.isFrozen(DEFAULT_DESIGN), true)

  // ── labels and warnings shown under a selection ──
  const labelCases: [Selection, Ayah[]][] = [
    [sel(2, 255, 1, 255, 50), baqarah],
    [sel(2, 255, 1, 257, 24), baqarah],
    [sel(2, 255, 1, 255, 7), baqarah],
    [sel(2, 255, 3, 257, 5), baqarah],
    [sel(4, 43, 1, 43, 6), A('4:43')],
    [sel(5, 73, 5, 73, 8), A('5:73')],
    [sel(107, 4, 1, 4, AYAH_END_WORD), S(107)],
    [sel(103, 2, 1, 2, 4), S(103)],
    [sel(2, 2, 1, 2, 4), baqarah],
    [sel(2, 2, 5, 2, 5), baqarah],
    [sel(2, 255, 1, 255, 32), baqarah],
    [sel(112, 1, 1, 4, 5), S(112)],
  ]
  const labels = labelCases.map(([s, ayahs]) => ({
    selection: `${s.surah}:${s.start.ayah}.${s.start.word}–${s.end.ayah}.${s.end.word === AYAH_END_WORD ? 'end' : s.end.word}`,
    ar: describeSelection(s, SURAHS[s.surah] ?? null, ayahs),
    en: describeSelection(s, SURAHS[s.surah] ?? null, ayahs, 'en'),
    warnings: selectionWarnings(s, ayahs).map((w) => ({ kind: w.kind, severity: warningSeverity(w), detail: warningDetail(w) })),
  }))
  check('describeSelection(2:255 w1–w7)', labels[2].ar, 'البقرة ٢٥٥ (الكلمات ١–٧)')
  check("describeSelection(2:255 w1–w7, 'en')", labels[2].en, 'Al-Baqarah 255 (words 1–7)')
  check("describeSelection(2:255 w3 → 257 w5, 'en')", labels[3].en, 'Al-Baqarah 255–257 (from word 3 to word 5)')

  // swatch examples: real words from every fixture verse, so (almost) every rule shows Quran text in its colour
  const found = rulesInAyahs(FIXTURE_SURAHS.flatMap((n) => S(n)))
  const rules = all.map((r) => ({
    id: r.id,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    explanationAr: r.explanationAr,
    explanationEn: r.explanationEn,
    citeAr: r.citeAr,
    color: r.color,
    colorDark: r.colorDark ?? r.color,
    group: r.group ?? '',
    examples: found.find((x) => x.rule.id === r.id)?.examples ?? [],
  }))
  return { checks, labels, links, rules, plan, timeline, preamble, estimateMs, maxVideoMs: MAX_VIDEO_MS }
}
