// Whole-Quran checks on the local crawl research/fixtures/quran-text-api/all-verses.json (api.quran.com v4, all
// 6,236 verses with text_uthmani, text_qpc_hafs and the tajweed markup per word; ~23 MB, gitignored). They back
// the corpus facts the domain relies on, in both display encodings, against the committed research fixtures
// (research/fixtures/features/next_ayah_starts_with_illa.json, pause_mark_stats.json). No network. Off by default:
//   CORPUS=1 npx vitest run src/domain/corpus.test.ts
import { beforeAll, describe, expect, it } from 'vitest'
import type { Ayah, Selection } from '../core/types'
import { AYAH_END_WORD, normalizeForSearch, selectionWarnings, snapToPauses } from './index'
import { isIlla, isSpeechVerb } from './guard'
import { DISPLAYS, toAyah, type ApiWord, type Display } from './__fixtures__/load'

type Fs = { existsSync(p: URL): boolean; readFileSync(p: URL, enc: 'utf8'): string }
interface CorpusVerse {
  key: string
  page_number: number
  juz_number: number
  sajdah_number: number | null
  words: ApiWord[]
}
const ROOT = new URL('../../', import.meta.url)

let verses: CorpusVerse[] = []
const bySurah: Record<Display, Map<number, Ayah[]>> = { uthmani: new Map(), qpc: new Map() }
let illaEndsAt: string[] = []
let muanaqaAyahs: string[] = []

beforeAll(async () => {
  if (!process.env.CORPUS) return
  const fs = (await import('node:fs' as string)) as Fs
  const file = new URL('research/fixtures/quran-text-api/all-verses.json', ROOT)
  if (!fs.existsSync(file)) throw new Error(`CORPUS=1 needs ${file.pathname} (the local api.quran.com crawl)`)
  verses = (JSON.parse(fs.readFileSync(file, 'utf8')) as { verses: CorpusVerse[] }).verses
  for (const d of DISPLAYS) {
    for (const v of verses) {
      const [s, n] = v.key.split(':').map(Number)
      const ayah = toAyah({ verse_key: v.key, verse_number: n, juz_number: v.juz_number, page_number: v.page_number, sajdah_number: v.sajdah_number, words: v.words }, d)
      const list = bySurah[d].get(s) ?? []
      list[n - 1] = ayah
      bySurah[d].set(s, list)
    }
  }
  const illa = JSON.parse(fs.readFileSync(new URL('research/fixtures/features/next_ayah_starts_with_illa.json', ROOT), 'utf8')) as {
    hits: { ends_at: string }[]
  }
  illaEndsAt = illa.hits.map((h) => h.ends_at)
  const stats = JSON.parse(fs.readFileSync(new URL('research/fixtures/features/pause_mark_stats.json', ROOT), 'utf8')) as {
    marks: { char: string; occurrences: number; ayahs: number; examples: string[] }[]
  }
  const m = stats.marks.find((x) => x.char === 'ۛ')!
  expect([m.occurrences, m.ayahs]).toEqual([12, 6])
  muanaqaAyahs = m.examples
}, 60_000)

const all = (d: Display) => [...bySurah[d].values()].flat()
const sel = (surah: number, a1: number, w1: number, a2: number, w2: number): Selection => ({ surah, start: { ayah: a1, word: w1 }, end: { ayah: a2, word: w2 } })
/** The ayahs the guard reads for a selection inside ayah n: the ayah and the next one. */
const around = (d: Display, surah: number, n: number) => (bySurah[d].get(surah) ?? []).slice(n - 1, n + 1)

describe.skipIf(!process.env.CORPUS)('whole Quran (CORPUS=1, local crawl)', () => {
  it('has every verse and word in both encodings', () => {
    expect(verses).toHaveLength(6236)
    expect(all('uthmani').reduce((n, a) => n + a.words.length, 0)).toBe(77429)
    expect(all('qpc').reduce((n, a) => n + a.words.length, 0)).toBe(77429)
  })

  it('normalizeForSearch is encoding-independent', () => {
    const qpc = all('qpc')
    const diffs: string[] = []
    all('uthmani').forEach((a, i) => {
      a.words.forEach((w, k) => {
        const q = qpc[i].words[k]
        if (normalizeForSearch(w.text) !== normalizeForSearch(q.text)) diffs.push(`${a.key}:${w.position} ${normalizeForSearch(w.text)} | ${normalizeForSearch(q.text)}`)
      })
    })
    // the only two differences are in the Tanzil text itself, not its encoding: 5:52 w12 is split by a space
    // («دَآئِرَ ةٌۭ»), 11:13 w3 is in imlaʾi spelling («افْتَرَاهُ» for «ٱفْتَرَىٰهُ»)
    expect(diffs).toEqual(['5:52:12 داير ه | دايره', '11:13:3 افتراه | افتريه'])
  })

  it('isSpeechVerb and isIlla agree in both encodings', () => {
    const qpc = all('qpc')
    let verbs = 0
    const illaStarts: string[] = []
    const alaStarts: string[] = [] // «أَلَا» / «أَلَآ» / «أَلَّا»: the same key as «إِلَّا» once normalised
    all('uthmani').forEach((a, i) => {
      a.words.forEach((w, k) => {
        const q = qpc[i].words[k]
        expect(isSpeechVerb(q.text), `${a.key}:${w.position}`).toBe(isSpeechVerb(w.text))
        expect(isIlla(q.text), `${a.key}:${w.position}`).toBe(isIlla(w.text))
        if (isSpeechVerb(w.text)) verbs++
      })
      if (isIlla(a.words[0].text)) illaStarts.push(a.key)
      else if (normalizeForSearch(a.words[0].text) === 'الا') alaStarts.push(a.key)
    })
    expect(verbs).toBe(1120) // features §2.3 list: قال، قالوا، قالت، قالتا، يقول، يقولون، تقول، تقولون، نقول، قيل (+ و/ف)
    expect(illaStarts).toHaveLength(54)
    expect(alaStarts).toEqual(['2:12', '9:13', '10:55', '10:62', '10:66', '11:2', '11:5', '20:93', '24:64', '27:25', '27:31', '37:151', '39:3', '41:54', '53:38', '55:8', '67:14', '83:4'])
  })

  it('warns «next ayah starts with إِلَّا» exactly at the 54 research hits, in both encodings', () => {
    for (const d of DISPLAYS) {
      const found: string[] = []
      for (const [surah, list] of bySurah[d]) {
        for (const a of list) {
          const w = selectionWarnings(sel(surah, a.number, 1, a.number, AYAH_END_WORD), around(d, surah, a.number))
          if (w.some((x) => x.kind === 'next-starts-with-illa')) found.push(a.key)
        }
      }
      expect(found.sort(), d).toEqual([...illaEndsAt].sort())
    }
  })

  it('reads the ۛ pairs of pause_mark_stats.json from Word.waqf, whatever the display prints', () => {
    for (const d of DISPLAYS) {
      const counts = new Map<string, number>()
      for (const a of all(d)) for (const w of a.words) if (w.waqf === 'muanaqa') counts.set(a.key, (counts.get(a.key) ?? 0) + 1)
      expect([...counts.keys()], d).toEqual(muanaqaAyahs)
      expect([...counts.values()], d).toEqual([2, 2, 2, 2, 2, 2])
    }
  })

  it('reads ۙ from the Tanzil mark: the QPC text prints none of the 68', () => {
    const count = (d: Display, f: (w: Ayah['words'][number]) => boolean) => all(d).reduce((n, a) => n + a.words.filter(f).length, 0)
    for (const d of DISPLAYS) expect(count(d, (w) => w.waqf === 'mamnu'), d).toBe(68)
    expect(count('uthmani', (w) => w.waqfChar === 'ۙ')).toBe(68)
    expect(count('qpc', (w) => w.waqfChar === 'ۙ')).toBe(0)
  })

  it('snapToPauses and selectionWarnings give the same result on both encodings for every word', () => {
    let n = 0
    for (const [surah, list] of bySurah.uthmani) {
      for (const a of list) {
        const u = around('uthmani', surah, a.number)
        const q = around('qpc', surah, a.number)
        for (const w of a.words) {
          for (const s of [sel(surah, a.number, w.position, a.number, AYAH_END_WORD), sel(surah, a.number, 1, a.number, w.position)]) {
            expect(snapToPauses(s, q), JSON.stringify(s)).toEqual(snapToPauses(s, u))
            expect(selectionWarnings(s, q), JSON.stringify(s)).toEqual(selectionWarnings(s, u))
            n++
          }
        }
      }
    }
    expect(n).toBe(2 * 77429)
  }, 120_000)

  it('madda_permissible marks only ayah-final words (00-gaps D10: «المد العارض للسكون»)', () => {
    let words = 0
    const inside: string[] = []
    for (const a of all('uthmani')) {
      a.words.forEach((w, k) => {
        if (!w.tajweed.some((s) => s.rule === 'madda_permissible')) return
        words++
        if (k !== a.words.length - 1) inside.push(`${a.key}:${w.position}`)
      })
    }
    expect(words).toBe(4541)
    expect(inside).toEqual([])
  })
})
