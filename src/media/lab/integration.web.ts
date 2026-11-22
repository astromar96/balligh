// Integration checks of the media lab (dev only, web only): REAL plans through data/ and domain/ (the reciter's own
// isti'adha and basmala sources, trimSilence on whole files) assembled by media, and REAL scenes through render/
// (an isti'adha video, a still whose tafsir runs over several pages). Imports other modules through their
// index.ts only. Nothing runs at import time.
import type { AudioPlan, DesignOptions, ExportedFile, RenderModel, Scene } from '../../core/types'
import * as data from '../../data'
import * as domain from '../../domain'
import { createScene, ensureTextFonts, exportSize, getGraphics, loadQuranFont, type QuranFont } from '../../render'
import { assembleAudio, exportImages, exportVideo, type AssembledAudio } from '../index'
import { decodeWholeRaw, xcorr } from './signal.web'

const short = (url: string) => url.replace(/^https?:\/\/[^/]+\//, '')
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

let fontPromise: Promise<QuranFont> | null = null
function fonts(): Promise<QuranFont> {
  fontPromise ??= Promise.all([loadQuranFont(), ensureTextFonts()]).then(([f]) => f)
  return fontPromise
}

export interface IstiadhaRun {
  plan: AudioPlan
  assembled: AssembledAudio
  report: Record<string, unknown>
  /** output-time windows of the timeline ayahs (-1 isti'adha, 0 basmala, then the ayahs) */
  windows: { ayah: number; startMs: number; endMs: number }[]
  model: RenderModel
}

/**
 * Whole ayahs from..to with the reciter's own isti'adha and basmala, planned by domain.planAudio exactly as the app
 * does (istiadha: true), assembled by media. Checks the ORDER isti'adha → basmala → ayahs on the audio itself:
 * an excerpt from the middle of every clip is cross-correlated with every source file decoded whole, at the
 * position ClipResult reports — each excerpt must match its own source (corr ≈ 1, lag 0) and no other.
 */
export async function istiadhaRun(reciterId: string, surah: number, from: number, to: number): Promise<IstiadhaRun> {
  const reciter = data.getReciter(reciterId)
  if (!reciter) throw new Error(`unknown reciter ${reciterId}`)
  const [surahs, ayahs] = await Promise.all([data.fetchSurahs(), data.fetchAyahs(surah)])
  const sel = domain.ayahRangeSelection(surah, from, to, ayahs)
  const [audio, basmala, isti] = await Promise.all([
    data.fetchAyahAudio(reciterId, surah, range(from, to)),
    data.fetchBasmalaAudio(reciterId),
    data.fetchIstiadhaAudio(reciterId),
  ])
  if (!isti) throw new Error(`${reciterId}: no isti'adha in the reciter's own voice (Reciter.istiadha = ${reciter.istiadha})`)
  const plan = domain.planAudio(sel, ayahs, [isti, ...audio], reciter, { basmala, istiadha: true })
  const t0 = performance.now()
  const assembled = await assembleAudio(plan)
  const assembleMs = Math.round(performance.now() - t0)
  const timeline = domain.buildTimeline(plan, assembled.clips)

  const out = (assembled.audio as AudioBuffer).getChannelData(0)
  const urls = [...new Set(plan.clips.map((c) => c.url))]
  const sources = new Map<string, Float32Array>()
  const fileMs = new Map<string, number>()
  for (const url of urls) {
    const b = await decodeWholeRaw(url)
    sources.set(url, b.getChannelData(0))
    fileMs.set(url, +(b.duration * 1000).toFixed(1))
  }
  let at = 0
  const clips = plan.clips.map((c, i) => {
    const r = assembled.clips[i]
    const len = Math.round(r.durationMs * 48)
    const n = Math.min(24_000, Math.floor(len / 2))
    const from0 = at + Math.floor((len - n) / 2) // the middle of the clip: away from fades and edges
    const expect = Math.round(r.srcStartMs * 48) + (from0 - at)
    const scores = urls.map((u) => ({ url: u, ...xcorr(out, from0, n, sources.get(u)!, expect, 1400) }))
    scores.sort((a, b) => b.corr - a.corr)
    at += len
    return {
      ayah: c.ayah,
      source: short(c.url),
      url: c.url,
      trimSilence: c.trimSilence,
      fileMs: fileMs.get(c.url),
      srcStartMs: +r.srcStartMs.toFixed(2),
      durationMs: +r.durationMs.toFixed(2),
      bestMatch: short(scores[0].url),
      matchesOwnSource: scores[0].url === c.url && scores[0].corr > 0.98,
      corr: scores[0].corr,
      lagSamples: scores[0].lag,
      nextBestCorr: scores[1]?.corr ?? null,
    }
  })

  const surahInfo = surahs.find((s) => s.number === surah)
  if (!surahInfo) throw new Error(`no surah ${surah}`)
  const trimmed = domain.trimToSelection(plan.playedSelection, ayahs)
  const model: RenderModel = {
    surah: surahInfo,
    ayahs: trimmed.ayahs,
    partialStart: trimmed.partialStart,
    partialEnd: trimmed.partialEnd,
    translation: null,
    translationSource: null,
    tafsir: null,
    tafsirSource: null,
    rules: [],
    reciter,
    timeline,
    basmala: plan.clips.some((c) => c.ayah === 0),
    istiadha: plan.clips.some((c) => c.ayah === -1),
    tafsirCreditAr: null,
  }
  return {
    plan,
    assembled,
    model,
    windows: timeline.ayahs.map((a) => ({ ayah: a.ayah, startMs: Math.round(a.startMs), endMs: Math.round(a.endMs) })),
    report: {
      reciter: reciterId,
      timingClass: reciter.timingClass,
      selection: plan.playedSelection,
      clipOrder: plan.clips.map((c) => c.ayah),
      timelineOrder: timeline.ayahs.map((a) => a.ayah),
      assembleMs,
      durationSec: +(assembled.audio.duration).toFixed(3),
      clips,
      orderOk: clips.every((c) => c.matchesOwnSource) && plan.clips.map((c) => c.ayah).join() === [-1, 0, ...range(from, to)].join(),
    },
  }
}

const VIDEO_DESIGN: DesignOptions = { ...domain.DEFAULT_DESIGN, aspect: '9:16' }

/** The isti'adha run as a real video: render's scene (isti'adha line while timeline ayah -1 plays) at 720×1280. */
export async function istiadhaVideo(run: IstiadhaRun, fileBase: string): Promise<{ file: ExportedFile; encodeMs: number; scene: Scene }> {
  const font = await fonts()
  const size = exportSize(VIDEO_DESIGN.aspect, 'hd')
  const scene = createScene(run.model, VIDEO_DESIGN, { font, graphics: getGraphics(), backgroundImage: null }, size)
  const t0 = performance.now()
  const file = await exportVideo({ scene, audio: run.assembled.audio, fileBase })
  return { file, encodeMs: Math.round(performance.now() - t0), scene }
}

/**
 * A still whose tafsir does not fit one page (render pages it, never truncates — C13/D6), exported with
 * exportImages: one PNG per page, "<base>-k.png", at most 10.
 */
export async function tafsirPages(tafsirId: string, surah: number, ayah: number, fileBase: string, maxPages?: number) {
  const [surahs, ayahs, tafsir] = await Promise.all([data.fetchSurahs(), data.fetchAyahs(surah), data.fetchTafsirResult(tafsirId, surah, ayah, ayah)])
  const surahInfo = surahs.find((s) => s.number === surah)
  if (!surahInfo) throw new Error(`no surah ${surah}`)
  const sel = domain.ayahRangeSelection(surah, ayah, ayah, ayahs)
  const trimmed = domain.trimToSelection(sel, ayahs)
  const model: RenderModel = {
    surah: surahInfo,
    ayahs: trimmed.ayahs,
    partialStart: false,
    partialEnd: false,
    translation: null,
    translationSource: null,
    tafsir: tafsir.entries,
    tafsirSource: data.TAFSIRS.find((t) => t.id === tafsirId) ?? null,
    rules: [],
    reciter: null,
    timeline: null,
    basmala: false,
    istiadha: false,
    tafsirCreditAr: tafsir.creditAr,
  }
  const design: DesignOptions = { ...domain.DEFAULT_DESIGN, aspect: '9:16', showTafsir: true }
  const font = await fonts()
  const scene = createScene(model, design, { font, graphics: getGraphics(), backgroundImage: null }, exportSize(design.aspect, 'fullhd'))
  const progress: number[] = []
  const t0 = performance.now()
  const files = await exportImages({ scene, fileBase, maxPages, onProgress: (r) => progress.push(+r.toFixed(3)) })
  return {
    files,
    report: {
      tafsir: tafsirId,
      provider: tafsir.providerId,
      chars: tafsir.entries.reduce((n, e) => n + e.text.length, 0),
      pageCount: scene.pageCount,
      exported: files.length,
      names: files.map((f) => f.fileName),
      kb: files.map((f) => Math.round(f.blob.size / 1024)),
      progress,
      ms: Math.round(performance.now() - t0),
    },
  }
}
