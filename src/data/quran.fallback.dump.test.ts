// Whole-Quran check of the alquran.cloud fallback (Tanzil text) against the primary display, word by word, over
// the research downloads (research/tmp is local scratch; research/fixtures/quran-text-api/all-verses.json is the
// gitignored QF dump). Skipped when they are absent.
import { readJsonIfPresent, repoFile } from './__fixtures__/load'
import { loadAmiriShaper } from './__fixtures__/shaper'
import { meemCounts, trailingMarks } from './audit'
import { ayahFromQuranComVerse, ayahsFromAlquranCloud, textDiagnostics } from './quran'
import type { Ayah } from '../core/types'

type S = { number: number; ayahs: { numberInSurah: number; text: string; juz: number; page: number; sajda: boolean | object }[] }
type QfVerse = {
  key: string
  verse_number?: number
  page_number: number
  juz_number: number
  sajdah_number: number | null
  text_uthmani_tajweed: string
  words: { position: number; char_type_name: string; text_uthmani: string; text_qpc_hafs: string }[]
}
const uJson = await readJsonIfPresent<{ data: { surahs: S[] } }>(repoFile('research/tmp/quran-text-api/aq_quran_uthmani.json'))
const tJson = await readJsonIfPresent<{ data: { surahs: S[] } }>(repoFile('research/tmp/quran-text-api/aq_quran_tajweed.json'))
const qfJson = uJson && tJson ? await readJsonIfPresent<{ verses: QfVerse[] }>(repoFile('research/fixtures/quran-text-api/all-verses.json')) : null

/** the tanween / small-meem marks of a display word (what decides a stray meem) */
const tanweenSignature = (t: string) => [...t].filter((c) => /[\u{064B}-\u{064D}\u{08F0}-\u{08F2}\u{06E2}\u{06ED}]/u.test(c)).join('')
const rules = (a: Ayah) => a.words.map((w) => [...new Set(w.tajweed.map((s) => s.rule))].sort().join())

describe.skipIf(!uJson || !tJson || !qfJson)('alquran.cloud fallback (research downloads)', () => {
  it('rebuilds Quran.com positions and pause marks, and displays like the primary path: no stray meem, same tanween', async () => {
    if (!uJson || !tJson || !qfJson) return
    const u = uJson.data.surahs
    const t = tJson.data.surahs
    const qfByKey = new Map(qfJson.verses.map((v) => [v.key, v]))
    const before = { ...textDiagnostics }
    const shaper = await loadAmiriShaper()
    const c = {
      verses: 0,
      words: 0,
      wordCountMismatch: 0,
      waqfMismatch: 0,
      printedMarkMismatch: 0,
      pageMismatch: 0,
      juzMismatch: 0,
      sajdahMismatch: 0,
      tanweenMismatch: 0,
      sameDisplay: 0,
      sameRules: 0,
      notdef: 0,
    }
    const fallbackWords: string[][] = []
    for (let s = 1; s <= 114; s++) {
      const json = {
        data: [
          { edition: { identifier: 'quran-uthmani' }, ayahs: u[s - 1].ayahs },
          { edition: { identifier: 'quran-tajweed' }, ayahs: t[s - 1].ayahs },
        ],
      }
      for (const a of ayahsFromAlquranCloud(s, json)) {
        c.verses++
        fallbackWords.push(a.words.map((w) => w.text))
        const ref = qfByKey.get(a.key) as QfVerse
        const primary = ayahFromQuranComVerse(s, { ...ref, verse_number: a.number, verse_key: a.key } as never)
        if (primary.words.length !== a.words.length) {
          c.wordCountMismatch++
          continue
        }
        const pr = rules(primary)
        const fr = rules(a)
        a.words.forEach((w, k) => {
          const p = primary.words[k]
          c.words++
          if (w.waqf !== p.waqf) c.waqfMismatch++ // both read the Tanzil marks (the guard)
          // the fallback prints Tanzil's marks (it has no QPC text); marks inside a word stay in its text
          if ((w.waqfChar ?? '').replace(/\s/g, '') !== trailingMarks(ref.words.filter((x) => x.char_type_name === 'word')[k].text_uthmani)) c.printedMarkMismatch++
          if (tanweenSignature(w.text) !== tanweenSignature(p.text)) c.tanweenMismatch++
          if (w.text === p.text) c.sameDisplay++
          if (fr[k] === pr[k]) c.sameRules++
          if (shaper?.glyphs(w.text).includes(0)) c.notdef++
        })
        if (a.page !== ref.page_number) c.pageMismatch++
        if (a.juz !== ref.juz_number) c.juzMismatch++
        if (a.sajdah !== primary.sajdah) c.sajdahMismatch++
      }
    }
    const failures = textDiagnostics.alignmentFailures - before.alignmentFailures
    const meem = meemCounts(fallbackWords)
    console.log('[fallback audit]', JSON.stringify({ ...c, alignmentFailures: failures, meem }))
    expect(c.verses).toBe(6236)
    expect(c.wordCountMismatch).toBe(0)
    expect(c.words).toBe(77429)
    expect(failures).toBe(0)
    expect(c.waqfMismatch).toBe(0)
    expect(c.printedMarkMismatch).toBe(0)
    expect(meem).toEqual({ words: 0, iqlab: 0, spurious: 0 })
    expect(c.tanweenMismatch).toBe(0)
    expect(c.notdef).toBe(0)
    // the rest differs by orthography only (Tanzil's tatweel before ٰ, «ـَٔا» for «أٓ», …): same rules nearly everywhere
    expect(c.sameRules / c.words).toBeGreaterThan(0.99)
    expect(c.pageMismatch).toBeLessThan(100) // 56: alquran.cloud puts some page-boundary verses on the other page
    expect(c.juzMismatch).toBe(0)
    expect(c.sajdahMismatch).toBe(0)
  }, 120_000)
})
