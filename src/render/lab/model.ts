// Lab only (route /lab/render and the LIVE test): RenderModels through the app's data module — exactly what the
// compose screen gets (QPC display text, printed pause marks, projected tajweed, the tafsir credit of the provider
// that answered) — plus a plausible fake recitation. Not used by the app.
import type { RenderModel, Timeline, TranslationSource } from '../../core/types'
import * as data from '../../data'

export interface PassageSpec {
  id: string
  surah: number
  from: number
  to: number
  /** word range inside the LAST ayah (inclusive), for partial selections */
  lastWordTo?: number
  /** draw the basmala line (timeline ayah 0 on a video) */
  basmala?: boolean
  /** draw the isti'adha line (timeline ayah -1 on a video) */
  istiadha?: boolean
}

/** Contact-sheet passages: open tanween and iqlab (2:2, 2:10, 2:19), pause marks, a partial ayah, a long ayah. */
export const PASSAGES: PassageSpec[] = [
  { id: '1:1-7', surah: 1, from: 1, to: 7, istiadha: true },
  { id: '2:2', surah: 2, from: 2, to: 2 },
  { id: '2:10', surah: 2, from: 10, to: 10 },
  { id: '2:19', surah: 2, from: 19, to: 19 },
  { id: '2:255', surah: 2, from: 255, to: 255 },
  { id: '2:282', surah: 2, from: 282, to: 282 },
  { id: '112:1-4', surah: 112, from: 1, to: 4, basmala: true, istiadha: true },
  { id: '4:43:1-7', surah: 4, from: 43, to: 43, lastWordTo: 7 },
]

/**
 * Translations of the lab: Saheeh International (default) and one per non-Latin script the renderer must draw
 * with its own Noto family (00-gaps §6.4). Names, directions and scripts checked against api.quran.com
 * /resources/translations and the texts on 2026-11-21. data.TRANSLATIONS wins where it lists the edition.
 */
const LAB_TRANSLATIONS: TranslationSource[] = [
  { id: 20, lang: 'en', langName: 'English', name: 'Saheeh International', dir: 'ltr', script: 'Latn' },
  { id: 54, lang: 'ur', langName: 'اردو', name: 'Maulana Muhammad Junagarhi', dir: 'rtl', script: 'Arab' },
  { id: 45, lang: 'ru', langName: 'Русский', name: 'Эльмир Кулиев', dir: 'ltr', script: 'Cyrl' },
  { id: 86, lang: 'dv', langName: 'ދިވެހި', name: 'Office of the President of Maldives', dir: 'rtl', script: 'Thaa' },
  { id: 161, lang: 'bn', langName: 'বাংলা', name: 'Taisirul Quran', dir: 'ltr', script: 'Beng' },
]

export const DEFAULT_TRANSLATION = 20
/** Urdu, Russian, Dhivehi, Bengali */
export const SCRIPT_TRANSLATIONS = [54, 45, 86, 161]

export function translationSource(id: number): TranslationSource {
  const lab = LAB_TRANSLATIONS.find((t) => t.id === id)
  const listed = data.TRANSLATIONS.find((t) => t.id === id) as (TranslationSource & { script?: string }) | undefined
  if (listed) return { ...listed, script: listed.script || lab?.script || 'Latn' }
  if (lab) return lab
  throw new Error(`lab: unknown translation ${id}`)
}

const warn = (what: string) => (e: unknown) => {
  console.warn(`lab: ${what}`, e)
  return null
}

/** The passage through src/data, with one translation (QF id) and the default tafsir. */
export async function modelFromData(spec: PassageSpec, translationId = DEFAULT_TRANSLATION): Promise<RenderModel> {
  const [surahs, all] = await Promise.all([data.fetchSurahs(), data.fetchAyahs(spec.surah)])
  const surah = surahs.find((x) => x.number === spec.surah)
  if (!surah) throw new Error(`lab: no surah ${spec.surah}`)
  const ayahs = all.filter((a) => a.number >= spec.from && a.number <= spec.to)
  if (spec.lastWordTo) {
    const last = ayahs[ayahs.length - 1]
    ayahs[ayahs.length - 1] = { ...last, words: last.words.filter((w) => w.position <= spec.lastWordTo!) }
  }
  const trSource = translationSource(translationId)
  const tafsirSource = data.TAFSIRS.find((t) => t.id === data.DEFAULT_TAFSIR_ID) ?? null
  const [translation, tafsir] = await Promise.all([
    data.fetchTranslation(trSource.id, spec.surah, spec.from, spec.to).catch(warn(`translation ${trSource.id}`)),
    tafsirSource ? data.fetchTafsirResult(tafsirSource.id, spec.surah, spec.from, spec.to).catch(warn('tafsir')) : null,
  ])
  const rules: RenderModel['rules'] = []
  for (const a of ayahs) for (const w of a.words) for (const s of w.tajweed) if (!rules.includes(s.rule)) rules.push(s.rule)
  return {
    surah,
    ayahs,
    partialStart: false,
    partialEnd: !!spec.lastWordTo,
    translation,
    translationSource: translation ? trSource : null,
    tafsir: tafsir?.entries ?? null,
    tafsirSource: tafsir ? tafsirSource : null,
    rules,
    reciter: data.getReciter(data.DEFAULT_RECITER_ID) ?? null,
    timeline: null,
    basmala: !!spec.basmala,
    istiadha: !!spec.istiadha,
    tafsirCreditAr: tafsir?.creditAr ?? null,
  }
}

/** A plausible fake recitation: [isti'adha 4.2 s] [basmala 3.2 s] then ~230 ms + 60 ms per letter per word. */
export function fakeTimeline(model: RenderModel, opts: { words: boolean }): Timeline {
  let t = 0
  const ayahs: Timeline['ayahs'] = []
  const words: Timeline['words'] = []
  if (model.istiadha) {
    ayahs.push({ ayah: -1, startMs: 0, endMs: 4200 })
    t = 4800
  }
  if (model.basmala) {
    ayahs.push({ ayah: 0, startMs: t, endMs: t + 3200 })
    t += 3800
  }
  for (const a of model.ayahs) {
    const start = t
    for (const w of a.words) {
      const letters = w.text.replace(/\p{M}/gu, '').length
      const d = 230 + 60 * letters
      words.push({ ayah: a.number, word: w.position, startMs: t, endMs: t + d - 30 })
      t += d
    }
    ayahs.push({ ayah: a.number, startMs: start, endMs: t + 250 })
    t += 600
  }
  return { durationMs: t, ayahs, words: opts.words ? words : [] }
}
