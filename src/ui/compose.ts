// Orchestration: turns what the user chose (store.ts) into what the stage and the export need.
//   selection/reciter (+ basmala, isti'adha) → fetchAyahAudio → planAudio → duration estimate (D3: 300 s cap)
//     → assembleAudio → buildTimeline → player
//   played ayah range → fetchTafsirResult / fetchTranslation (+ the translation script's Noto font, before any scene)
//   trimmed ayahs → rulesInAyahs; everything → two RenderModels: `model` (preview + video, timed by the
//   recitation) and `stillModel` (images: the user's exact words, no recitation)
// Every change aborts the stale work (AbortController per run) and is debounced. Each stage fails on
// its own: a missing recitation still leaves a still preview; a missing tafsir leaves the rest.
import { useEffect, useEffectEvent } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  AudioPlan,
  Ayah,
  AyahAudio,
  ClipResult,
  ImageHandle,
  Reciter,
  RenderModel,
  Selection,
  Surah,
  TafsirResult,
  TafsirSource,
  Timeline,
  TranslationEntry,
  TranslationSource,
} from '../core/types'
import * as data from '../data'
import * as domain from '../domain'
import type { PlanOptions, SelectionWarning, TajweedRuleInfo } from '../domain'
import * as media from '../media'
import type { AssembledAudio, PreviewPlayer } from '../media'
import * as render from '../render'
import type { QuranFont } from '../render'
import { isAbortError, throwIfAborted } from './safe'
import { findAyah, firstWordOf, normalizeLocal, sameSelection } from './selection'
import { currentSurah, useAppStore } from './store'

export type SlotStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Slot<T> {
  status: SlotStatus
  error: unknown
  value: T | null
}

const idle = <T>(): Slot<T> => ({ status: 'idle', error: null, value: null })

export interface AudioResult {
  plan: AudioPlan
  assembled: AssembledAudio
  timeline: Timeline
}

/** The recitation of the current passage. 'too-long': it would pass domain.MAX_VIDEO_MS (D3), so nothing was
 * assembled and video export is off; images still work. */
export interface AudioSlot {
  status: SlotStatus | 'too-long'
  error: unknown
  value: AudioResult | null
  progress: number
  key: string | null
  /**
   * How long the clip will be: the plan's estimate as soon as it is planned (before any audio is fetched), then the
   * real length; for 'too-long' the estimate that passed the cap. null while unknown (a plan of whole per-ayah files
   * has no estimate before decoding) or when only a lower bound is known.
   */
  estimateMs: number | null
}

const idleAudio = (): AudioSlot => ({ ...idle<AudioResult>(), progress: 0, key: null, estimateMs: null })

export interface ComposeState {
  font: Slot<QuranFont>
  textFonts: Slot<true>
  audio: AudioSlot
  player: PreviewPlayer | null
  tafsir: Slot<TafsirResult> & { key: string | null }
  translation: Slot<TranslationEntry[]> & { key: string | null }
  bgImage: Slot<ImageHandle> & { src: string | null }
  /** what will be heard and drawn: the selection, or the selection widened to whole ayahs (classes C/D) */
  playedSelection: Selection | null
  /** preview + video: the played passage, timed by the recitation once it is ready */
  model: RenderModel | null
  /** still images: exactly the selected words, never a recitation (no timeline, no isti'adha) */
  stillModel: RenderModel | null
  modelError: unknown
  rules: { rule: TajweedRuleInfo; examples: string[] }[]
  warnings: SelectionWarning[]
  description: string
  wordCount: number
  /** bumped by retryAudio() so the engine runs the audio pipeline again with the same inputs */
  audioNonce: number
  retryAudio(): void
  /** bumped by retryContent() to fetch tafsir/translation again */
  contentNonce: number
  retryContent(): void
}

export const useCompose = create<ComposeState>()((set) => ({
  font: idle(),
  textFonts: idle(),
  audio: idleAudio(),
  player: null,
  tafsir: { ...idle<TafsirResult>(), key: null },
  translation: { ...idle<TranslationEntry[]>(), key: null },
  bgImage: { ...idle<ImageHandle>(), src: null },
  playedSelection: null,
  model: null,
  stillModel: null,
  modelError: null,
  rules: [],
  warnings: [],
  description: '',
  wordCount: 0,
  audioNonce: 0,
  retryAudio: () => set((s) => ({ audioNonce: s.audioNonce + 1 })),
  contentNonce: 0,
  retryContent: () => set((s) => ({ contentNonce: s.contentNonce + 1 })),
}))

// ───────────────────────── lookups ─────────────────────────

export function findReciter(id: string): Reciter | null {
  return data.getReciter(id) ?? null
}

export function findTafsir(id: string | null): TafsirSource | null {
  if (!id) return null
  return data.TAFSIRS.find((t) => t.id === id) ?? null
}

export function findTranslation(id: number | null): TranslationSource | null {
  if (id === null) return null
  return data.TRANSLATIONS.find((t) => t.id === id) ?? null
}

export function selectionKey(sel: Selection | null): string {
  if (!sel) return '-'
  const n = normalizeLocal(sel)
  return `${n.surah}:${n.start.ayah}.${n.start.word}-${n.end.ayah}.${n.end.word}`
}

/** The isti'adha opens the clip only when the user asked for it AND the reciter recorded it in their own voice (D7). */
export function istiadhaOn(wanted: boolean, reciter: Reciter | null): boolean {
  return wanted && !!reciter?.istiadha
}

// ───────────────────────── audio pipeline (pure, injectable for tests) ─────────────────────────

export interface AudioDeps {
  fetchAyahAudio(reciterId: string, surah: number, ayahs: number[], signal?: AbortSignal): Promise<AyahAudio[]>
  fetchBasmalaAudio(reciterId: string, signal?: AbortSignal): Promise<AyahAudio>
  fetchIstiadhaAudio(reciterId: string, signal?: AbortSignal): Promise<AyahAudio | null>
  planAudio(sel: Selection, ayahs: Ayah[], audio: AyahAudio[], reciter: Reciter, opts: PlanOptions): AudioPlan
  assembleAudio(plan: AudioPlan, opts?: { signal?: AbortSignal; onProgress?: (ratio: number) => void }): Promise<AssembledAudio>
  buildTimeline(plan: AudioPlan, results: ClipResult[]): Timeline
}

const realAudioDeps: AudioDeps = {
  fetchAyahAudio: (r, s, a, sig) => data.fetchAyahAudio(r, s, a, sig),
  fetchBasmalaAudio: (r, sig) => data.fetchBasmalaAudio(r, sig),
  fetchIstiadhaAudio: (r, sig) => data.fetchIstiadhaAudio(r, sig),
  planAudio: (sel, ayahs, audio, reciter, opts) => domain.planAudio(sel, ayahs, audio, reciter, opts),
  assembleAudio: (plan, opts) => media.assembleAudio(plan, opts),
  buildTimeline: (plan, results) => domain.buildTimeline(plan, results),
}

/** true when the clip should open with the reciter's basmala (PLAN.md: ayah 1 word 1, surah ≠ 1, 9). */
export function needsBasmala(sel: Selection, ayahs: Ayah[]): boolean {
  const n = normalizeLocal(sel)
  return n.surah !== 1 && n.surah !== 9 && n.start.ayah === 1 && n.start.word === firstWordOf(findAyah(ayahs, 1))
}

/** Still images draw the basmala when the selection opens a surah that has one (ayah 1, word 1). */
export function stillBasmala(sel: Selection, surah: Surah | null, ayahs: Ayah[]): boolean {
  const n = normalizeLocal(sel)
  return !!surah?.bismillahPre && n.start.ayah === 1 && n.start.word <= firstWordOf(findAyah(ayahs, 1))
}

/** Upper bound of an own-voice isti'adha recording (00-gaps §2.8: 5.28–7.90 s, before its silence is trimmed). */
export const ISTIADHA_ESTIMATE_MS = 8_000
/**
 * Faster than any catalogue reciter reads (the quickest murattal takes ≈ 0.7 s a word): a floor for a plan whose
 * length is unknown before decoding, so a huge selection of whole per-ayah files is refused before it is fetched.
 */
export const MIN_MS_PER_WORD = 550

/**
 * D3 before any audio is fetched: domain.estimatePlanDurationMs, with the isti'adha (a whole file of unknown length)
 * counted at its upper bound. `ms` is null when a clip's length is unknown (whole per-ayah files: class C and the
 * ayah-level fallbacks); `atLeastMs` is then a floor from the word count.
 */
export function estimateClipMs(plan: AudioPlan, ayahs: Ayah[]): { ms: number | null; atLeastMs: number } {
  const istiadha = plan.clips.filter((c) => c.ayah === -1).length
  const rest = istiadha > 0 ? { ...plan, clips: plan.clips.filter((c) => c.ayah !== -1) } : plan
  const known = domain.estimatePlanDurationMs(rest)
  const ms = known === null ? null : known + istiadha * ISTIADHA_ESTIMATE_MS
  const words = plan.playedSelection ? domain.selectedWordCount(plan.playedSelection, ayahs) : 0
  return { ms, atLeastMs: ms ?? words * MIN_MS_PER_WORD }
}

/** The clip would run past domain.MAX_VIDEO_MS (D3). `durationMs`: the estimate or the real length; null when only a floor is known. */
export class ClipTooLongError extends Error {
  readonly durationMs: number | null
  constructor(durationMs: number | null) {
    super('clip longer than the video cap')
    this.name = 'ClipTooLongError'
    this.durationMs = durationMs
  }
}

export async function runAudioPipeline(
  args: {
    surah: number
    ayahs: Ayah[]
    selection: Selection
    reciter: Reciter
    /** open with the reciter's own isti'adha (ignored for reciters without one) */
    istiadha?: boolean
    signal: AbortSignal
    onProgress?: (r: number) => void
    /** the planned length, before any audio is fetched (null: unknown until decoded) */
    onEstimate?: (ms: number | null) => void
    /** the 300 s video cap; the reciter preview passes Infinity */
    capMs?: number
  },
  deps: AudioDeps = realAudioDeps,
): Promise<AudioResult> {
  const { ayahs, reciter, signal } = args
  const cap = args.capMs ?? domain.MAX_VIDEO_MS
  const sel = normalizeLocal(args.selection)
  const numbers: number[] = []
  for (let a = sel.start.ayah; a <= sel.end.ayah; a++) numbers.push(a)
  // a missing basmala or isti'adha never blocks the recitation itself
  const optional = <T>(p: Promise<T>): Promise<T | null> =>
    p.catch((e) => {
      if (isAbortError(e)) throw e
      return null
    })
  const [audio, basmala, istiadha] = await Promise.all([
    deps.fetchAyahAudio(reciter.id, args.surah, numbers, signal),
    needsBasmala(sel, ayahs) ? optional(deps.fetchBasmalaAudio(reciter.id, signal)) : Promise.resolve(null),
    istiadhaOn(!!args.istiadha, reciter) ? optional(deps.fetchIstiadhaAudio(reciter.id, signal)) : Promise.resolve(null),
  ])
  throwIfAborted(signal)
  const plan = deps.planAudio(sel, ayahs, istiadha ? [istiadha, ...audio] : audio, reciter, { basmala, istiadha: istiadha !== null })
  const estimate = estimateClipMs(plan, ayahs)
  args.onEstimate?.(estimate.ms)
  if ((estimate.ms ?? estimate.atLeastMs) > cap) throw new ClipTooLongError(estimate.ms)
  args.onProgress?.(0)
  const assembled = await deps.assembleAudio(plan, { signal, onProgress: args.onProgress })
  throwIfAborted(signal)
  const timeline = deps.buildTimeline(plan, assembled.clips)
  if (timeline.durationMs > cap) throw new ClipTooLongError(timeline.durationMs)
  return { plan, assembled, timeline }
}

/** The plan opens with these (they are only drawn while heard: render times them by timeline ayah 0 / -1). */
export function planOpening(plan: AudioPlan): { basmala: boolean; istiadha: boolean } {
  return { basmala: plan.clips.some((c) => c.ayah === 0), istiadha: plan.clips.some((c) => c.ayah === -1) }
}

/**
 * true when a word-timing reciter's clip still highlights some ayah whole: the data had no reliable word timings
 * for it (class-B corrupt labels, mostly-untimed ayahs — D4/D8) or the decoded file contradicted them (stale timings).
 */
export function hasAyahLevelFallback(timeline: Timeline, reciter: Reciter | null): boolean {
  if (!reciter?.wordTimings) return false
  return timeline.ayahs.some((a) => a.ayah > 0 && !timeline.words.some((w) => w.ayah === a.ayah))
}

// ───────────────────────── model ─────────────────────────

export interface ModelInputs {
  surah: Surah | null
  ayahs: Ayah[]
  selection: Selection
  reciter: Reciter | null
  timeline: Timeline | null
  basmala: boolean
  istiadha: boolean
  tafsir: TafsirResult | null
  tafsirSource: TafsirSource | null
  translation: TranslationEntry[] | null
  translationSource: TranslationSource | null
}

export function buildModel(inp: ModelInputs): { model: RenderModel | null; rules: ComposeState['rules']; error: unknown } {
  const trimmed = domain.trimToSelection(inp.selection, inp.ayahs)
  const rules = domain.rulesInAyahs(trimmed.ayahs)
  if (!inp.surah) return { model: null, rules, error: new Error('surah list unavailable') }
  const tafsir = inp.tafsirSource && inp.tafsir ? inp.tafsir : null
  const model: RenderModel = {
    surah: inp.surah,
    ayahs: trimmed.ayahs,
    partialStart: trimmed.partialStart,
    partialEnd: trimmed.partialEnd,
    translation: inp.translationSource ? inp.translation : null,
    translationSource: inp.translation ? inp.translationSource : null,
    tafsir: tafsir ? tafsir.entries : null,
    tafsirSource: tafsir ? inp.tafsirSource : null,
    rules: rules.map((r) => r.rule.id),
    reciter: inp.reciter,
    timeline: inp.timeline,
    basmala: inp.basmala,
    istiadha: inp.istiadha,
    // the credit of the provider that actually served the text (QuranEnc: with its live version)
    tafsirCreditAr: tafsir ? tafsir.creditAr || inp.tafsirSource?.creditAr || null : null,
  }
  return { model, rules, error: null }
}

/** Arabic is read at roughly 15–20 characters a second; video tafsir pages faster than this cannot be read. */
export const MAX_TAFSIR_CHARS_PER_SECOND = 30

/**
 * true when the video would turn a tafsir passage's pages faster than it can be read: a long passage over short
 * ayahs (render times a passage's pages across the ayahs it covers). Needs the timeline; false without tafsir.
 */
export function tafsirTooFast(model: RenderModel | null): boolean {
  if (!model?.tafsir || !model.timeline) return false
  for (const e of model.tafsir) {
    let ms = 0
    for (const a of model.timeline.ayahs) if (a.ayah >= e.ayahFrom && a.ayah <= e.ayahTo) ms += Math.max(0, a.endMs - a.startMs)
    if (ms > 0 && e.text.replace(/\s+/g, '').length / (ms / 1000) > MAX_TAFSIR_CHARS_PER_SECOND) return true
  }
  return false
}

// ───────────────────────── the engine (mount once, in the app screen) ─────────────────────────

let fontsRequested = false

function requestFonts() {
  if (fontsRequested) return
  fontsRequested = true
  const set = useCompose.setState
  set({ font: { status: 'loading', error: null, value: null }, textFonts: { status: 'loading', error: null, value: null } })
  Promise.resolve()
    .then(() => render.loadQuranFont())
    .then(
      (value) => set({ font: { status: 'ready', error: null, value } }),
      (error) => {
        fontsRequested = false // allow a retry on the next mount
        set({ font: { status: 'error', error, value: null } })
      },
    )
  // the UI families the scene measures with; a translation's own script is loaded with the translation
  Promise.resolve()
    .then(() => render.ensureTextFonts())
    .then(
      () => set({ textFonts: { status: 'ready', error: null, value: true } }),
      (error) => set({ textFonts: { status: 'error', error, value: null } }),
    )
}

export function retryFonts() {
  fontsRequested = false
  requestFonts()
}

function disposePlayer() {
  const player = useCompose.getState().player
  if (player) {
    try {
      player.pause()
      player.dispose()
    } catch {
      // a half-built player must not break the next run
    }
    useCompose.setState({ player: null })
  }
}

export function useComposeEngine(): void {
  const { surah, surahs, ayahs, selection, pending, reciterId, istiadha, tafsirId, translationId, background, language } = useAppStore(
    useShallow((s) => ({
      surah: s.surah,
      surahs: s.surahs,
      ayahs: s.ayahs,
      selection: s.selection,
      pending: s.pending,
      reciterId: s.reciterId,
      istiadha: s.istiadha,
      tafsirId: s.tafsirId,
      translationId: s.translationId,
      background: s.design.background,
      language: s.language,
    })),
  )
  const audio = useCompose((s) => s.audio)
  const audioNonce = useCompose((s) => s.audioNonce)
  const contentNonce = useCompose((s) => s.contentNonce)
  const played = useCompose((s) => s.playedSelection)
  const tafsir = useCompose((s) => s.tafsir)
  const translation = useCompose((s) => s.translation)

  // fonts, once
  useEffect(() => {
    requestFonts()
  }, [])

  // dispose the player when the app screen goes away
  useEffect(() => () => disposePlayer(), [])

  // ── audio ──
  const withIstiadha = istiadhaOn(istiadha, findReciter(reciterId))
  // everything the recitation depends on; the run itself reads the latest values through runAudio
  const key = ayahs && selection ? `${selectionKey(selection)}|${reciterId}|${withIstiadha ? 'i' : '-'}|${audioNonce}` : null
  // the first tap of a range waits longer: the second tap usually follows
  const debounceMs = pending ? 900 : 350

  const runAudio = useEffectEvent((runKey: string, ctrl: AbortController) => {
    const live = () => !ctrl.signal.aborted
    const reciter = findReciter(reciterId)
    if (!ayahs || !selection) return
    if (!reciter) {
      useCompose.setState({ audio: { status: 'error', error: new Error(`unknown reciter "${reciterId}"`), value: null, progress: 0, key: runKey, estimateMs: null } })
      return
    }
    runAudioPipeline({
      surah,
      ayahs,
      selection,
      reciter,
      istiadha: withIstiadha,
      signal: ctrl.signal,
      onEstimate: (estimateMs) => {
        if (live()) useCompose.setState((s) => ({ audio: { ...s.audio, estimateMs } }))
      },
      onProgress: (progress) => {
        if (live()) useCompose.setState((s) => ({ audio: { ...s.audio, progress } }))
      },
    }).then(
      (value) => {
        if (!live()) return
        let player: PreviewPlayer | null = null
        try {
          player = media.createPreviewPlayer(value.assembled.audio)
        } catch {
          player = null // the stage still draws; play stays disabled
        }
        disposePlayer()
        useCompose.setState({
          audio: { status: 'ready', error: null, value, progress: 1, key: runKey, estimateMs: value.timeline.durationMs },
          player,
          playedSelection: value.plan.playedSelection ?? selection,
        })
      },
      (error) => {
        if (!live() || isAbortError(error)) return
        if (error instanceof ClipTooLongError) {
          useCompose.setState({ audio: { status: 'too-long', error, value: null, progress: 0, key: runKey, estimateMs: error.durationMs } })
          return
        }
        useCompose.setState({ audio: { status: 'error', error, value: null, progress: 0, key: runKey, estimateMs: null } })
      },
    )
  })

  useEffect(() => {
    const current = useCompose.getState().audio
    if (!key) {
      if (current.key !== null) {
        disposePlayer()
        useCompose.setState({ audio: idleAudio(), playedSelection: null })
      }
      return
    }
    // a run with the same key is only ever in flight here if this effect's cleanup just aborted it,
    // so only a finished result may be reused
    if (current.key === key && (current.status === 'ready' || current.status === 'too-long')) return
    // the selection moved: stale audio must not drive the new picture
    disposePlayer()
    useCompose.setState({ audio: { status: 'loading', error: null, value: null, progress: 0, key, estimateMs: null }, playedSelection: null })
    const ctrl = new AbortController()
    const timer = setTimeout(() => runAudio(key, ctrl), debounceMs)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [key, debounceMs])

  // ── tafsir & translation (for the ayahs actually heard) ──
  const span = played ?? selection
  const spanN = span ? normalizeLocal(span) : null
  const fromAyah = spanN?.start.ayah ?? 0
  const toAyah = spanN?.end.ayah ?? 0

  useEffect(() => {
    if (!tafsirId || fromAyah === 0) {
      useCompose.setState({ tafsir: { ...idle<TafsirResult>(), key: null } })
      return
    }
    const key = `${tafsirId}|${surah}|${fromAyah}-${toAyah}|${contentNonce}`
    const current = useCompose.getState().tafsir
    if (current.key === key && current.status === 'ready') return
    useCompose.setState({ tafsir: { status: 'loading', error: null, value: null, key } })
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => data.fetchTafsirResult(tafsirId, surah, fromAyah, toAyah, ctrl.signal))
        .then(
          (value) => {
            if (!ctrl.signal.aborted) useCompose.setState({ tafsir: { status: 'ready', error: null, value, key } })
          },
          (error) => {
            if (!ctrl.signal.aborted && !isAbortError(error)) useCompose.setState({ tafsir: { status: 'error', error, value: null, key } })
          },
        )
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [tafsirId, surah, fromAyah, toAyah, contentNonce])

  useEffect(() => {
    if (translationId === null || fromAyah === 0) {
      useCompose.setState({ translation: { ...idle<TranslationEntry[]>(), key: null } })
      return
    }
    const key = `${translationId}|${surah}|${fromAyah}-${toAyah}|${contentNonce}`
    const current = useCompose.getState().translation
    if (current.key === key && current.status === 'ready') return
    const script = findTranslation(translationId)?.script
    useCompose.setState({ translation: { status: 'loading', error: null, value: null, key } })
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => data.fetchTranslation(translationId, surah, fromAyah, toAyah, ctrl.signal))
        .then(async (value) => {
          // the Noto family of the translation's script must be loaded before a scene measures the text
          // (Readex Pro has no Urdu/Persian letters, Cyrillic or Thaana — 00-gaps §6.4); never rejects, capped
          if (script) await render.ensureTextFonts([script], value.map((e) => e.text).join(' '))
          return value
        })
        .then(
          (value) => {
            if (!ctrl.signal.aborted) useCompose.setState({ translation: { status: 'ready', error: null, value, key } })
          },
          (error) => {
            if (!ctrl.signal.aborted && !isAbortError(error)) useCompose.setState({ translation: { status: 'error', error, value: null, key } })
          },
        )
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [translationId, surah, fromAyah, toAyah, contentNonce])

  // ── the user's background photo ──
  const bgSrc = background.kind === 'image' ? background.src : null
  useEffect(() => {
    if (!bgSrc) {
      useCompose.setState({ bgImage: { ...idle<ImageHandle>(), src: null } })
      return
    }
    let alive = true
    useCompose.setState({ bgImage: { status: 'loading', error: null, value: null, src: bgSrc } })
    Promise.resolve()
      .then(() => render.getGraphics().loadImage(bgSrc))
      .then(
        (value) => {
          if (alive) useCompose.setState({ bgImage: { status: 'ready', error: null, value, src: bgSrc } })
        },
        (error) => {
          if (alive) useCompose.setState({ bgImage: { status: 'error', error, value: null, src: bgSrc } })
        },
      )
    return () => {
      alive = false
    }
  }, [bgSrc])

  // ── derived: description, warnings, rules, the two models ──
  const ready = audio.status === 'ready' ? audio.value : null
  useEffect(() => {
    if (!ayahs || !selection) {
      useCompose.setState({ model: null, stillModel: null, modelError: null, rules: [], warnings: [], description: '', wordCount: 0 })
      return
    }
    const surahObj = currentSurah({ surahs, surah })
    const reciter = findReciter(reciterId)
    const shown = played && !sameSelection(played, selection) && !pending ? played : selection
    const warnings = pending ? [] : domain.selectionWarnings(selection, ayahs)
    const content = {
      surah: surahObj,
      ayahs,
      reciter,
      tafsir: tafsirId && tafsir.status === 'ready' ? tafsir.value : null,
      tafsirSource: findTafsir(tafsirId),
      translation: translationId !== null && translation.status === 'ready' ? translation.value : null,
      translationSource: findTranslation(translationId),
    }
    // the preview/video model opens with what the plan actually plays; before the recitation is ready it shows
    // what will be asked for (the isti'adha the user turned on, the basmala of a surah start)
    const opening = ready ? planOpening(ready.plan) : { basmala: stillBasmala(shown, surahObj, ayahs), istiadha: withIstiadha }
    const { model, rules, error } = buildModel({ ...content, selection: shown, timeline: ready?.timeline ?? null, ...opening })
    const still = buildModel({ ...content, selection, timeline: null, basmala: stillBasmala(selection, surahObj, ayahs), istiadha: false })
    useCompose.setState({
      model,
      stillModel: still.model,
      modelError: error,
      rules,
      warnings,
      description: domain.describeSelection(selection, surahObj, ayahs, language),
      wordCount: domain.selectedWordCount(selection, ayahs),
    })
  }, [ayahs, selection, pending, surahs, surah, reciterId, tafsirId, translationId, language, withIstiadha, played, ready, tafsir, translation])
}
