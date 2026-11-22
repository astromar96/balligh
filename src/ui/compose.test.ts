import type { AudioClip, AudioPlan, AyahAudio, ClipResult, Reciter, RenderModel, Selection, TafsirSource, Timeline } from '../core/types'
import type { AssembledAudio } from '../media'
import { fixtureAyahs, SURAH_LIST } from './__fixtures__/load'
import {
  buildModel,
  ClipTooLongError,
  estimateClipMs,
  hasAyahLevelFallback,
  ISTIADHA_ESTIMATE_MS,
  istiadhaOn,
  MIN_MS_PER_WORD,
  needsBasmala,
  planOpening,
  runAudioPipeline,
  selectionKey,
  stillBasmala,
  tafsirTooFast,
  type AudioDeps,
} from './compose'

const ikhlas = fixtureAyahs(112)
const fatiha = fixtureAyahs(1)
const baqarah = fixtureAyahs(2)
const surahOf = (n: number) => SURAH_LIST.find((s) => s.number === n) ?? null
const reciter = { id: 'test', nameAr: 'قارئ', nameEn: 'Reciter', wordTimings: true, istiadha: false } as unknown as Reciter
const withIstiadha = { ...reciter, id: 'own-voice', istiadha: true } as Reciter
const sel = (surah: number, a: number, w: number, b: number, x: number): Selection => ({ surah, start: { ayah: a, word: w }, end: { ayah: b, word: x } })

/** a clip of `ms` known length (srcEndMs null = a whole file of unknown length) */
function clip(ayah: number, ms: number | null): AudioClip {
  return {
    ayah,
    ayahTo: Math.max(ayah, 0),
    url: `https://audio.test/${ayah}.mp3`,
    fileKind: 'per_ayah',
    bitrateKbps: null,
    srcStartMs: 0,
    srcEndMs: ms,
    fadeInMs: 0,
    fadeOutMs: 0,
    snapToPause: false,
    extendToSpeechOnset: false,
    trimSilence: ms === null,
    words: [],
    ayahs: [],
  }
}

const planOf = (selection: Selection, clips: AudioClip[]): AudioPlan => ({ reciterId: 'test', clips, wordLevel: false, exact: true, playedSelection: selection })

function fakeDeps(
  log: string[],
  opts: { failBasmala?: boolean; noIstiadha?: boolean; slowAssemble?: boolean; clipMs?: number | null; timelineMs?: number } = {},
): AudioDeps {
  return {
    fetchAyahAudio: async (r, s, ayahs) => {
      log.push(`ayahs ${r} ${s}:${ayahs.join(',')}`)
      return ayahs.map((n) => ({ ayah: n }) as unknown as AyahAudio)
    },
    fetchBasmalaAudio: async (r) => {
      log.push(`basmala ${r}`)
      if (opts.failBasmala) throw new Error('404')
      return { ayah: 0 } as unknown as AyahAudio
    },
    fetchIstiadhaAudio: async (r) => {
      log.push(`istiadha ${r}`)
      return opts.noIstiadha ? null : ({ ayah: -1 } as unknown as AyahAudio)
    },
    planAudio: (s, _ayahs, audio, _r, planOpts) => {
      log.push(`plan ${audio.map((a) => a.ayah).join(',')} basmala=${planOpts.basmala ? 'yes' : 'no'} istiadha=${planOpts.istiadha ? 'yes' : 'no'}`)
      const clipMs = opts.clipMs === undefined ? 1000 : opts.clipMs
      return planOf(s, audio.map((a) => clip(a.ayah, a.ayah === -1 ? null : clipMs)))
    },
    assembleAudio: async (_plan, o) => {
      o?.onProgress?.(0.5)
      if (opts.slowAssemble) await new Promise((r) => setTimeout(r, 20))
      log.push('assemble')
      return { clips: [] as ClipResult[], audio: {} } as unknown as AssembledAudio
    },
    buildTimeline: () => {
      log.push('timeline')
      return { durationMs: opts.timelineMs ?? 1234, ayahs: [], words: [] }
    },
  }
}

const go = (extra: Partial<Parameters<typeof runAudioPipeline>[0]> = {}) => ({
  surah: 2,
  ayahs: baqarah,
  selection: sel(2, 256, 4, 255, 5),
  reciter,
  signal: new AbortController().signal,
  ...extra,
})

describe('needsBasmala', () => {
  it('opens with the basmala only from the first word of a surah other than 1 and 9', () => {
    expect(needsBasmala(sel(112, 1, 1, 4, 4), ikhlas)).toBe(true)
    expect(needsBasmala(sel(112, 1, 2, 4, 4), ikhlas)).toBe(false)
    expect(needsBasmala(sel(112, 2, 1, 4, 4), ikhlas)).toBe(false)
    expect(needsBasmala(sel(1, 1, 1, 7, 6), fatiha)).toBe(false)
    expect(needsBasmala(sel(9, 1, 1, 1, 5), [])).toBe(false)
  })
})

describe('stillBasmala', () => {
  it('draws the basmala on a still that opens a surah which has one', () => {
    expect(stillBasmala(sel(112, 1, 1, 4, 4), surahOf(112), ikhlas)).toBe(true)
    expect(stillBasmala(sel(112, 1, 2, 4, 4), surahOf(112), ikhlas)).toBe(false)
    expect(stillBasmala(sel(112, 2, 1, 4, 4), surahOf(112), ikhlas)).toBe(false)
    // Al-Fatihah's basmala is its first ayah, not a heading
    expect(stillBasmala(sel(1, 1, 1, 7, 6), surahOf(1), fatiha)).toBe(false)
    expect(stillBasmala(sel(112, 1, 1, 4, 4), null, ikhlas)).toBe(false)
  })
})

describe('istiadhaOn', () => {
  it('needs both the wish and a recording in the reciter’s own voice', () => {
    expect(istiadhaOn(true, withIstiadha)).toBe(true)
    expect(istiadhaOn(true, reciter)).toBe(false)
    expect(istiadhaOn(false, withIstiadha)).toBe(false)
    expect(istiadhaOn(true, null)).toBe(false)
  })
})

describe('runAudioPipeline', () => {
  it('fetches the ayahs of the selection, plans, assembles and times them', async () => {
    const log: string[] = []
    const progress: number[] = []
    const estimates: (number | null)[] = []
    const res = await runAudioPipeline(
      go({ onProgress: (r) => progress.push(r), onEstimate: (ms) => estimates.push(ms) }),
      fakeDeps(log),
    )
    expect(log).toEqual(['ayahs test 2:255,256', 'plan 255,256 basmala=no istiadha=no', 'assemble', 'timeline'])
    expect(progress).toEqual([0, 0.5])
    expect(estimates).toEqual([2000])
    expect(res.timeline.durationMs).toBe(1234)
  })

  it('adds the basmala for a surah start, and goes on without it when it cannot be fetched', async () => {
    const log: string[] = []
    await runAudioPipeline(go({ surah: 112, ayahs: ikhlas, selection: sel(112, 1, 1, 4, 4) }), fakeDeps(log))
    expect(log).toContain('basmala test')
    expect(log).toContain('plan 1,2,3,4 basmala=yes istiadha=no')

    const failed: string[] = []
    await runAudioPipeline(go({ surah: 112, ayahs: ikhlas, selection: sel(112, 1, 1, 4, 4) }), fakeDeps(failed, { failBasmala: true }))
    expect(failed).toContain('plan 1,2,3,4 basmala=no istiadha=no')
  })

  it('opens with the isti’adha only for a reciter who recorded it, and goes on without it when there is none', async () => {
    const log: string[] = []
    const res = await runAudioPipeline(go({ reciter: withIstiadha, istiadha: true }), fakeDeps(log))
    expect(log).toContain('istiadha own-voice')
    expect(log).toContain('plan -1,255,256 basmala=no istiadha=yes')
    expect(planOpening(res.plan)).toEqual({ basmala: false, istiadha: true })

    const other: string[] = []
    await runAudioPipeline(go({ istiadha: true }), fakeDeps(other))
    expect(other.some((l) => l.startsWith('istiadha'))).toBe(false)

    const missing: string[] = []
    await runAudioPipeline(go({ reciter: withIstiadha, istiadha: true }), fakeDeps(missing, { noIstiadha: true }))
    expect(missing).toContain('plan 255,256 basmala=no istiadha=no')
  })

  it('refuses a clip over the video cap before fetching any audio file to decode (D3)', async () => {
    const log: string[] = []
    const run = runAudioPipeline(go(), fakeDeps(log, { clipMs: 200_000 }))
    await expect(run).rejects.toBeInstanceOf(ClipTooLongError)
    await expect(run).rejects.toMatchObject({ durationMs: 400_000 })
    expect(log).not.toContain('assemble')
  })

  it('uses a word-count floor when the length is unknown until decoding', async () => {
    const log: string[] = []
    // 255:5 … 256:4 = 46 + 4 words; at the floor of 550 ms a word that is 27.5 s
    const run = runAudioPipeline(go({ capMs: 20_000 }), fakeDeps(log, { clipMs: null }))
    await expect(run).rejects.toMatchObject({ name: 'ClipTooLongError', durationMs: null })
    expect(log).not.toContain('assemble')
    await expect(runAudioPipeline(go({ capMs: 60_000 }), fakeDeps([], { clipMs: null }))).resolves.toBeTruthy()
  })

  it('checks the real length once decoded', async () => {
    const run = runAudioPipeline(go({ capMs: 5_000 }), fakeDeps([], { timelineMs: 6_000 }))
    await expect(run).rejects.toMatchObject({ name: 'ClipTooLongError', durationMs: 6_000 })
  })

  it('stops when the selection changes mid-way (aborted signal)', async () => {
    const log: string[] = []
    const ctrl = new AbortController()
    const run = runAudioPipeline(go({ selection: sel(2, 255, 1, 255, 7), signal: ctrl.signal }), fakeDeps(log, { slowAssemble: true }))
    setTimeout(() => ctrl.abort(), 5)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(log).not.toContain('timeline')
  })
})

describe('estimateClipMs', () => {
  it('sums known windows and counts the isti’adha at its upper bound', () => {
    const plan = planOf(sel(2, 255, 1, 255, 50), [clip(-1, null), clip(255, 30_000)])
    expect(estimateClipMs(plan, baqarah)).toEqual({ ms: 30_000 + ISTIADHA_ESTIMATE_MS, atLeastMs: 30_000 + ISTIADHA_ESTIMATE_MS })
  })

  it('falls back to a floor from the words heard when a whole file’s length is unknown', () => {
    const plan = planOf(sel(2, 255, 1, 255, 50), [clip(255, null)])
    expect(estimateClipMs(plan, baqarah)).toEqual({ ms: null, atLeastMs: 50 * MIN_MS_PER_WORD })
  })
})

describe('planOpening', () => {
  it('reads the basmala and isti’adha from the plan’s clips', () => {
    expect(planOpening(planOf(sel(112, 1, 1, 4, 4), [clip(-1, null), clip(0, 3000), clip(1, 3000)]))).toEqual({ basmala: true, istiadha: true })
    expect(planOpening(planOf(sel(112, 2, 1, 4, 4), [clip(2, 3000)]))).toEqual({ basmala: false, istiadha: false })
  })
})

describe('hasAyahLevelFallback', () => {
  const timeline = (wordsFor: number[]): Timeline => ({
    durationMs: 9000,
    ayahs: [
      { ayah: 0, startMs: 0, endMs: 3000 },
      { ayah: 255, startMs: 3000, endMs: 6000 },
      { ayah: 256, startMs: 6000, endMs: 9000 },
    ],
    words: wordsFor.map((ayah, i) => ({ ayah, word: 1, startMs: i * 100, endMs: i * 100 + 90 })),
  })

  it('notices an ayah highlighted whole in a word-timed clip (the basmala does not count)', () => {
    expect(hasAyahLevelFallback(timeline([255]), reciter)).toBe(true)
    expect(hasAyahLevelFallback(timeline([255, 256]), reciter)).toBe(false)
    expect(hasAyahLevelFallback(timeline([]), { ...reciter, wordTimings: false } as Reciter)).toBe(false)
  })
})

describe('buildModel', () => {
  const tafsirSource = { id: 'muyassar', nameAr: 'الميسر', nameEn: 'Al-Muyassar', length: 'short', kind: 'tafsir', noteAr: '', creditAr: 'الميسر — مجمع الملك فهد' } as TafsirSource
  const base = {
    surah: surahOf(2),
    ayahs: baqarah,
    selection: sel(2, 255, 1, 255, 50),
    reciter,
    timeline: null,
    basmala: false,
    istiadha: false,
    tafsir: null,
    tafsirSource: null,
    translation: null,
    translationSource: null,
  }

  it('carries the credit of the provider that served the tafsir', () => {
    const served = { entries: [{ ayahFrom: 255, ayahTo: 255, text: 'تفسير' }], providerId: 'quranenc', creditAr: 'QuranEnc v1.2' }
    expect(buildModel({ ...base, tafsir: served, tafsirSource }).model?.tafsirCreditAr).toBe('QuranEnc v1.2')
    expect(buildModel({ ...base, tafsir: { ...served, creditAr: '' }, tafsirSource }).model?.tafsirCreditAr).toBe(tafsirSource.creditAr)
    const none = buildModel({ ...base, tafsir: served, tafsirSource: null }).model
    expect(none?.tafsir).toBeNull()
    expect(none?.tafsirCreditAr).toBeNull()
  })

  it('passes the opening through and trims the ayahs to the selection', () => {
    const { model } = buildModel({ ...base, selection: sel(2, 255, 5, 256, 4), basmala: true, istiadha: true })
    expect(model?.basmala).toBe(true)
    expect(model?.istiadha).toBe(true)
    expect(model?.ayahs.map((a) => a.words.length)).toEqual([46, 4])
    expect(model?.partialStart).toBe(true)
  })

  it('has no model without the surah list', () => {
    expect(buildModel({ ...base, surah: null }).model).toBeNull()
  })
})

describe('tafsirTooFast', () => {
  const model = (text: string, ms: number) =>
    ({
      tafsir: [{ ayahFrom: 255, ayahTo: 255, text }],
      timeline: { durationMs: ms, ayahs: [{ ayah: 255, startMs: 0, endMs: ms }], words: [] },
    }) as unknown as RenderModel

  it('flags a tafsir passage longer than can be read while its ayah is heard', () => {
    expect(tafsirTooFast(model('ا'.repeat(400), 10_000))).toBe(true)
    expect(tafsirTooFast(model('ا'.repeat(200), 10_000))).toBe(false)
    expect(tafsirTooFast({ ...model('ا'.repeat(400), 10_000), timeline: null })).toBe(false)
    expect(tafsirTooFast(null)).toBe(false)
  })
})

describe('selectionKey', () => {
  it('keys a selection so equal ranges share audio', () => {
    expect(selectionKey(sel(2, 255, 5, 256, 4))).toBe(selectionKey(sel(2, 256, 4, 255, 5)))
    expect(selectionKey(null)).toBe('-')
  })
})
