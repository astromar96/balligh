// Media test bench (dev only, web only), driven by src/app/lab/media.tsx and by headless Chrome / WebKit
// (scratchpad harness/media-lab*.mjs). The media-only steps build AudioPlans by hand from LIVE api.quran.com /
// mp3quran data, run assembleAudio + exportVideo + exportImage(s), and check the Range-sliced audio against a
// whole-file decode of the same file; the integration steps (./integration.web.ts) go through data/, domain/ and
// render/ like the app (isti'adha → basmala → ayahs, trimSilence, still pages). Nothing here runs at import time.
import type { AudioClip, AudioPlan, ClipResult, ExportedFile, Painter, Scene } from '../../core/types'
import { untaggedDecoderSkew } from '../decoderSkew.web'
import {
  AudioSourceError,
  assembleAudio,
  canShareFiles,
  createPreviewPlayer,
  detectVideoSupport,
  exportImage,
  exportImages,
  exportVideo,
  shareFiles,
  type AssembledAudio,
  type VideoSupport,
} from '../index'
import { istiadhaRun, istiadhaVideo, tafsirPages } from './integration.web'
import { decodeWholeRaw, interleave, rmsDb, xcorr } from './signal.web'

export type Log = (line: string) => void

export interface LabOutput {
  results: Record<string, unknown>
  files: Record<string, ExportedFile>
  /** interleaved f32le stereo 48 kHz of selected assembled audios (for ffmpeg cross-checks) */
  pcm: Record<string, Float32Array>
}

const V4 = 'https://api.quran.com/api/v4'
const QDC = 'https://api.quran.com/api/qdc'

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return (await res.json()) as T
}

interface TimedWord {
  word: number
  startMs: number
  endMs: number
}

// ── hand-made plans (a mini version of research/audio-timing.md §8) ──

interface V4File {
  verse_key: string
  url: string
  segments: (number | string)[][]
}

function v4Words(segments: V4File['segments']): TimedWord[] {
  return segments
    .map((s) => s.map(Number))
    .filter((s) => s.length === 4 && s.every(Number.isFinite) && s[1] - s[0] === 1)
    .map((s) => ({ word: s[1], startMs: s[2], endMs: s[3] }))
    .sort((a, b) => a.startMs - b.startMs)
}

/** One per-ayah or chapter cut from word `from` to word `to` (planner rules: lead 120, tail 350, fades 8/20 in, 25/60 out). */
function cut(o: {
  url: string
  fileKind: 'per_ayah' | 'chapter'
  bitrateKbps: number | null
  ayah: number
  words: TimedWord[]
  from: number
  to: number
  windowStartMs: number
  windowEndMs: number | null
}): AudioClip {
  const iS = o.words.findIndex((w) => w.word === o.from)
  const iE = o.words.findIndex((w) => w.word === o.to)
  const s = o.words[iS].startMs
  const e = o.words[iE].endMs
  const prevEnd = iS > 0 ? o.words[iS - 1].endMs : o.windowStartMs
  const gap = s - prevEnd
  const start = gap > 80 ? Math.max(prevEnd, s - 120) : s
  const next = o.words[iE + 1]
  const end = next ? Math.min(e, next.startMs - 5) : o.windowEndMs === null ? e + 350 : Math.min(o.windowEndMs, e + 350)
  return {
    ayah: o.ayah,
    ayahTo: o.ayah,
    url: o.url,
    fileKind: o.fileKind,
    bitrateKbps: o.bitrateKbps,
    srcStartMs: start,
    srcEndMs: end,
    fadeInMs: gap > 80 ? 20 : 8,
    fadeOutMs: next ? 25 : 60,
    snapToPause: false,
    extendToSpeechOnset: o.from === 1,
    trimSilence: false,
    words: o.words.slice(iS, iE + 1).map((w) => ({ ayah: o.ayah, word: w.word, startMs: w.startMs, endMs: w.endMs })),
    ayahs: [{ ayah: o.ayah, startMs: o.fileKind === 'per_ayah' ? 0 : o.windowStartMs, endMs: null }],
  }
}

/** Class A (Alafasy, v4 recitation 7): basmala (1:1) + 112:1 + 112:2 whole + 112:3 words 1–2 (mid-ayah cut). */
async function planClassA(): Promise<AudioPlan> {
  const base = 'https://verses.quran.com/'
  const [ch, fat] = await Promise.all([
    json<{ audio_files: V4File[] }>(`${V4}/recitations/7/by_chapter/112?fields=segments&per_page=all`),
    json<{ audio_files: V4File[] }>(`${V4}/recitations/7/by_ayah/1:1?fields=segments`),
  ])
  const f = (k: string) => ch.audio_files.find((a) => a.verse_key === k)!
  const b = fat.audio_files[0]
  const bw = v4Words(b.segments)
  const clips = [
    { ...cut({ url: base + b.url, fileKind: 'per_ayah', bitrateKbps: null, ayah: 0, words: bw, from: 1, to: bw.length, windowStartMs: 0, windowEndMs: null }), extendToSpeechOnset: false },
    cut({ url: base + f('112:1').url, fileKind: 'per_ayah', bitrateKbps: null, ayah: 1, words: v4Words(f('112:1').segments), from: 1, to: 4, windowStartMs: 0, windowEndMs: null }),
    cut({ url: base + f('112:2').url, fileKind: 'per_ayah', bitrateKbps: null, ayah: 2, words: v4Words(f('112:2').segments), from: 1, to: 2, windowStartMs: 0, windowEndMs: null }),
    cut({ url: base + f('112:3').url, fileKind: 'per_ayah', bitrateKbps: null, ayah: 3, words: v4Words(f('112:3').segments), from: 1, to: 2, windowStartMs: 0, windowEndMs: null }),
  ]
  return { reciterId: 'alafasy', clips, wordLevel: true, exact: true, playedSelection: { surah: 112, start: { ayah: 1, word: 1 }, end: { ayah: 3, word: 2 } } }
}

interface QdcFile {
  audio_url: string
  verse_timings: { verse_key: string; timestamp_from: number; timestamp_to: number; segments: unknown[] }[]
}

async function qdcFile(recitation: number, chapter: number): Promise<QdcFile> {
  const r = await json<{ audio_files: QdcFile[] }>(`${QDC}/audio/reciters/${recitation}/audio_files?chapter=${chapter}&segments=true`)
  return r.audio_files[0]
}

function qdcWords(segments: unknown[]): TimedWord[] {
  return segments
    .filter((s): s is unknown[] => Array.isArray(s) && s.length === 3)
    .map((s) => s.map((x) => Math.round(Number(x))))
    .filter((s) => s.every(Number.isFinite))
    .map((s) => ({ word: s[0], startMs: s[1], endMs: s[2] }))
}

/** Class B (Yasser Ad-Dosari, QDC 97): 2:255 words 1–7, ~101 minutes into a 116 MB chapter file (HTTP Range). */
async function planClassB(): Promise<AudioPlan> {
  const file = await qdcFile(97, 2)
  const v = file.verse_timings.find((t) => t.verse_key === '2:255')!
  const words = qdcWords(v.segments)
  const clip = cut({ url: file.audio_url, fileKind: 'chapter', bitrateKbps: 128, ayah: 255, words, from: 1, to: 7, windowStartMs: v.timestamp_from, windowEndMs: v.timestamp_to })
  return { reciterId: 'yasser-dosari', clips: [clip], wordLevel: true, exact: true, playedSelection: { surah: 2, start: { ayah: 255, word: 1 }, end: { ayah: 255, word: 7 } } }
}

/** Class D (Saad Al-Ghamdi, mp3quran read 30): 67:1–2 from ayat_timing, edges snapped into pauses. */
async function planClassD(): Promise<AudioPlan> {
  const rows = await json<{ ayah: number; start_time: number; end_time: number }[]>('https://www.mp3quran.net/api/v3/ayat_timing?surah=67&read=30')
  const a1 = rows.find((r) => r.ayah === 1)!
  const a2 = rows.find((r) => r.ayah === 2)!
  const clip: AudioClip = {
    ayah: 1,
    ayahTo: 2,
    url: 'https://cdn.mp3quran.net/audio/saad-ghamdi/r1/067.mp3',
    fileKind: 'chapter',
    bitrateKbps: 96,
    srcStartMs: a1.start_time,
    srcEndMs: a2.end_time,
    fadeInMs: 20,
    fadeOutMs: 60,
    snapToPause: true,
    extendToSpeechOnset: false,
    trimSilence: false,
    words: [],
    ayahs: [
      { ayah: 1, startMs: a1.start_time, endMs: a1.end_time },
      { ayah: 2, startMs: a2.start_time, endMs: null },
    ],
  }
  return { reciterId: 'saad-ghamdi', clips: [clip], wordLevel: false, exact: false, playedSelection: { surah: 67, start: { ayah: 1, word: 1 }, end: { ayah: 2, word: 13 } } }
}

/** 60 s of Yasser 2:255 (chapter Range window) for the speed runs. */
async function plan60s(): Promise<AudioPlan> {
  const file = await qdcFile(97, 2)
  const v = file.verse_timings.find((t) => t.verse_key === '2:255')!
  const clip: AudioClip = {
    ayah: 255,
    ayahTo: 256,
    url: file.audio_url,
    fileKind: 'chapter',
    bitrateKbps: 128,
    srcStartMs: v.timestamp_from,
    srcEndMs: v.timestamp_from + 60_000,
    fadeInMs: 20,
    fadeOutMs: 60,
    snapToPause: false,
    extendToSpeechOnset: false,
    trimSilence: false,
    words: qdcWords(v.segments).map((w) => ({ ayah: 255, ...w })),
    ayahs: [{ ayah: 255, startMs: v.timestamp_from, endMs: null }],
  }
  return { reciterId: 'yasser-dosari', clips: [clip], wordLevel: true, exact: true, playedSelection: { surah: 2, start: { ayah: 255, word: 1 }, end: { ayah: 256, word: 3 } } }
}

// ── synthetic scene (no dependency on render's createScene) ──

interface Mark {
  label: string
  startMs: number
  endMs: number
}

/** Output-time word windows from the plan + what assembleAudio produced (a tiny buildTimeline). */
function marksOf(plan: AudioPlan, results: ClipResult[]): Mark[] {
  const marks: Mark[] = []
  let at = 0
  plan.clips.forEach((c, i) => {
    const r = results[i]
    for (const w of c.words) {
      const s = Math.max(at, at + (w.startMs - r.srcStartMs))
      const e = Math.min(at + r.durationMs, at + (w.endMs - r.srcStartMs))
      if (e > s) marks.push({ label: `${c.ayah === 0 ? 'basmala' : c.ayah === -1 ? 'istiadha' : `${c.ayah}`}:${w.word}`, startMs: s, endMs: e })
    }
    at += r.durationMs
  })
  return marks
}

export function labScene(width: number, height: number, durationMs: number, title: string, marks: Mark[]): Scene {
  const k = width / 720
  const bg = { type: 'linear' as const, x0: 0, y0: 0, x1: 0, y1: height, stops: [{ offset: 0, color: '#16222E' }, { offset: 1, color: '#0B3B30' }] }
  const text = (p: Painter, s: string, y: number, size: number, color: string) =>
    p.fillText(s, width / 2, y, { family: 'ReadexPro', sizePx: size * k, color, align: 'center', direction: 'ltr' })
  const draw = (p: Painter, t: number) => {
    p.fillRect(0, 0, width, height, bg)
    for (let i = 0; i < 12; i++) {
      const r = (60 + i * 24) * k
      p.strokeRoundRect(width / 2 - r, height * 0.45 - r, 2 * r, 2 * r, r, i % 2 ? '#C29A3E55' : '#FBF8F022', 2 * k)
    }
    text(p, title, 140 * k, 40, '#FBF8F0')
    const active = marks.find((m) => t >= m.startMs && t < m.endMs)
    text(p, active ? active.label : '·', height * 0.45 + 30 * k, 96, active ? '#C29A3E' : '#FBF8F088')
    text(p, `${(t / 1000).toFixed(3)} s`, height * 0.72, 44, '#FBF8F0')
    // sync marker: white bar during the first 2 frames of every word
    if (marks.some((m) => t >= m.startMs && t < m.startMs + 66)) p.fillRect(0, height - 40 * k, width, 40 * k, '#FFFFFF')
    p.fillRoundRect(60 * k, height * 0.8, (width - 120 * k) * Math.min(1, t / Math.max(1, durationMs)), 14 * k, 7 * k, '#1D6B57')
  }
  return { width, height, durationMs, pageCount: 1, draw, drawPage: (p) => draw(p, 0) }
}

/** Colour of the full-width band page k of labPagesScene paints at the top (read back from the PNG). */
export function pageColor(k: number): [number, number, number] {
  return [(40 + 53 * k) % 256, (200 - 37 * k + 256 * 4) % 256, (90 + 71 * k) % 256]
}

/** A still with `pages` pages: page k says "page k+1 / n" and paints pageColor(k) in a band at the top. */
export function labPagesScene(width: number, height: number, pages: number): Scene {
  const k = width / 720
  const page = (p: Painter, n: number) => {
    const [r, g, b] = pageColor(n)
    p.fillRect(0, 0, width, height, '#16222E')
    p.fillRect(0, 0, width, 120 * k, `rgb(${r}, ${g}, ${b})`)
    p.fillText(`page ${n + 1} / ${pages}`, width / 2, height / 2, { family: 'ReadexPro', sizePx: 72 * k, color: '#FBF8F0', align: 'center', direction: 'ltr' })
  }
  return { width, height, durationMs: 0, pageCount: pages, draw: (p) => page(p, 0), drawPage: page }
}

/** RGB of pixel (x, y) of a PNG blob. */
async function pixelOf(blob: Blob, x: number, y: number): Promise<[number, number, number]> {
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(1, 1)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(bmp, x, y, 1, 1, 0, 0, 1, 1)
  bmp.close()
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

const sameColor = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 2)

// ── checks ──

const SELECTION = { surah: 1, start: { ayah: 1, word: 1 }, end: { ayah: 1, word: 1 } }

function bareClip(url: string, fileKind: AudioClip['fileKind'], bitrateKbps: number | null, srcStartMs: number, srcEndMs: number | null, trimSilence = false): AudioClip {
  return {
    ayah: 1, ayahTo: 1, url, fileKind, bitrateKbps, srcStartMs, srcEndMs,
    fadeInMs: 0, fadeOutMs: 0, snapToPause: false, extendToSpeechOnset: false, trimSilence, words: [], ayahs: [],
  }
}

/**
 * Range-sliced chapter clip vs the same (small) file decoded whole by the production per-ayah path (LAME
 * CRC repaired, untagged skew compensated: the reference timeline). The slice must sit at exactly
 * ClipResult.srcStartMs of the whole decode (lag 0, correlation ≈ 1). The lag against the engine's raw,
 * uncorrected decode is reported too (WebKit, untagged: −576 at 48 kHz = 529 samples at 44.1 kHz, −1152
 * for 22.05 kHz files).
 */
async function sliceVsWhole(label: string, url: string, bitrateKbps: number, fromMs: number, toMs: number) {
  const t0 = performance.now()
  const got = await assembleAudio({ reciterId: label, clips: [bareClip(url, 'chapter', bitrateKbps, fromMs, toMs)], wordLevel: false, exact: true, playedSelection: SELECTION })
  const assembleMs = Math.round(performance.now() - t0)
  const whole = await assembleAudio({ reciterId: label, clips: [bareClip(url, 'per_ayah', null, 0, null)], wordLevel: false, exact: true, playedSelection: SELECTION })
  const out = (got.audio as AudioBuffer).getChannelData(0)
  const ref = (whole.audio as AudioBuffer).getChannelData(0)
  const wholeStartMs = whole.clips[0].srcStartMs
  const r = got.clips[0]
  const exact = (r.srcStartMs - wholeStartMs) * 48
  const center = Math.round(exact)
  const n = Math.min(out.length - 2000, 48_000)
  const m = xcorr(out, 1000, n, ref, center + 1000, 400)
  // Sub-sample check: the reference is compared at whole samples, but srcStartMs sits between two of them.
  // A parabola through the correlation at lags −1, 0, +1 estimates the true fractional offset.
  const c = [-1, 0, 1].map((l) => xcorr(out, 1000, n, ref, center + 1000 + m.lag + l, 0).corr)
  const fracMeasured = m.lag + (c[0] - c[2]) / (2 * (c[0] - 2 * c[1] + c[2]))
  const raw = (await decodeWholeRaw(url)).getChannelData(0)
  const rawCenter = Math.round(r.srcStartMs * 48)
  const mr = xcorr(out, 1000, n, raw, rawCenter + 1000, 1400) // 22.05 kHz untagged in WebKit: −1152
  return {
    label, url, plannedMs: [fromMs, toMs], srcStartMs: +r.srcStartMs.toFixed(3), durationMs: +r.durationMs.toFixed(3), assembleMs,
    wholeStartMs: +wholeStartMs.toFixed(3),
    lagSamples: m.lag, corr: m.corr, subSampleLagMeasured: +fracMeasured.toFixed(3), subSampleLagExpected: +(exact - center).toFixed(3),
    rawDecodeLag: mr.lag, rawDecodeCorr: mr.corr,
    pcm: interleave(got.audio as AudioBuffer),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function playerCheck(audio: AssembledAudio['audio']) {
  const p = createPreviewPlayer(audio)
  const out: Record<string, number | boolean> = { durationMs: Math.round(p.durationMs()) }
  await p.play(0)
  await sleep(1200)
  out.afterPlay1200 = Math.round(p.currentMs())
  p.pause()
  const paused = p.currentMs()
  await sleep(300)
  out.pausedStable = p.currentMs() === paused
  p.seek(400)
  out.afterSeek400 = Math.round(p.currentMs())
  await p.play()
  await sleep(500)
  out.resumeFrom400Plus500 = Math.round(p.currentMs())
  const ended = new Promise<boolean>((resolve) => p.onEnded(() => resolve(true)))
  p.seek(p.durationMs() - 400)
  out.endedFired = await Promise.race([ended, sleep(2500).then(() => false)])
  out.isPlayingAfterEnd = p.isPlaying()
  out.positionAfterEnd = Math.round(p.currentMs())
  p.dispose()
  return out
}

async function timedExport(name: string, plan: AudioPlan, size: { width: number; height: number }, log: Log, files: LabOutput['files'], fps = 30) {
  const t0 = performance.now()
  const assembled = await assembleAudio(plan, { onProgress: () => {} })
  const audioMs = performance.now() - t0
  const audio = assembled.audio as AudioBuffer
  const scene = labScene(size.width, size.height, audio.duration * 1000, `${name} ${size.width}x${size.height}`, marksOf(plan, assembled.clips))
  const t1 = performance.now()
  let lastPct = -1
  const file = await exportVideo({
    scene, audio, fps, fileBase: `balligh-lab-${name}-${size.width}x${size.height}`,
    onProgress: (p) => {
      const pct = Math.floor(p.ratio * 10)
      if (p.phase === 'frames' && pct !== lastPct) {
        lastPct = pct
        log(`  ${name}: frames ${pct * 10}%`)
      }
    },
  })
  const encodeMs = performance.now() - t1
  files[`${name}-${size.width}x${size.height}`] = file
  const durationSec = audio.duration
  return {
    durationSec: +durationSec.toFixed(4),
    samples: audio.length,
    frames: Math.ceil(durationSec * fps - 1e-6),
    clips: assembled.clips.map((c) => ({ srcStartMs: +c.srcStartMs.toFixed(2), durationMs: +c.durationMs.toFixed(2), wordTimingsValid: c.wordTimingsValid })),
    audioMs: Math.round(audioMs),
    encodeMs: Math.round(encodeMs),
    speed: +(durationSec / (encodeMs / 1000)).toFixed(2),
    bytes: file.blob.size,
    fileName: file.fileName,
    assembled,
  }
}

export async function runMediaLab(only: string[] | null, log: Log): Promise<LabOutput> {
  const want = (k: string) => !only || only.includes(k) || only.includes('all')
  const results: Record<string, unknown> = {}
  const files: LabOutput['files'] = {}
  const pcm: LabOutput['pcm'] = {}
  const step = async (name: string, fn: () => Promise<unknown>) => {
    if (!want(name)) return
    log(`▶ ${name}`)
    const t0 = performance.now()
    try {
      const r = await fn()
      results[name] = r
      log(`✓ ${name} (${Math.round(performance.now() - t0)} ms) ${JSON.stringify(r, (k, v) => (k === 'assembled' ? undefined : v)).slice(0, 600)}`)
    } catch (e) {
      results[name] = { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
      log(`✗ ${name}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
    }
  }

  await step('detect', async () => {
    const out: Record<string, VideoSupport> = {}
    for (const [w, h] of [[720, 1280], [1080, 1920], [1080, 1350]]) out[`${w}x${h}`] = await detectVideoSupport(w, h)
    return {
      query: typeof location !== 'undefined' ? location.search : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      untaggedDecoderSkewSamples: await untaggedDecoderSkew(),
      ...out,
    }
  })

  await step('slices', async () => {
    const cases: [string, string, number][] = [
      ['yasser-97 untagged 128k', 'https://download.quranicaudio.com/quran/yasser_ad-dussary//112.mp3', 128],
      ['shatri-4 Lavc Info 64k+128k', 'https://download.quranicaudio.com/qdc/abu_bakr_shatri/murattal/112.mp3', 128],
      ['jalil-170 Lavc Info 96k', 'https://download.quranicaudio.com/qdc/khalid_jalil/murattal/mp3/112.mp3', 96],
      ['khalifa-161 Lavf MPEG-2', 'https://download.quranicaudio.com/qdc/khalifah_taniji/murattal/112.mp3', 64],
      ['husary-6 LAME MPEG-2', 'https://download.quranicaudio.com/qdc/khalil_al_husary/murattal/112.mp3', 64],
      ['alafasy-7 LAME Info 128k', 'https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/112.mp3', 128],
      ['ghamdi mp3quran untagged MPEG-2', 'https://cdn.mp3quran.net/audio/saad-ghamdi/r1/112.mp3', 96],
    ]
    const rows = []
    for (const [i, [label, url, kbps]] of cases.entries()) {
      try {
        const { pcm: slicePcm, ...row } = await sliceVsWhole(label, url, kbps, 3000, 6500)
        pcm[`slice${i}`] = slicePcm
        rows.push(row)
      } catch (e) {
        rows.push({ label, url, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return rows
  })

  // Per-ayah files from the catalogue host (EveryAyah), decoded whole: tagged and untagged. The harness
  // compares each with ffmpeg's decode (the reference timeline) at ClipResult.srcStartMs.
  await step('everyayah', async () => {
    const files = [
      ['husary untagged (ID3)', 'https://everyayah.com/data/Husary_128kbps/112001.mp3'],
      ['alafasy LAME Info', 'https://everyayah.com/data/Alafasy_128kbps/112001.mp3'],
    ]
    const rows = []
    for (const [i, [label, url]] of files.entries()) {
      const a = await assembleAudio({ reciterId: label, clips: [bareClip(url, 'per_ayah', null, 0, null)], wordLevel: false, exact: true, playedSelection: SELECTION })
      pcm[`everyayah${i}`] = interleave(a.audio as AudioBuffer)
      rows.push({ label, url, srcStartMs: +a.clips[0].srcStartMs.toFixed(3), durationMs: +a.clips[0].durationMs.toFixed(3) })
    }
    return rows
  })

  await step('vbr-refused', async () => {
    const clip: AudioClip = {
      ayah: 1, ayahTo: 1, url: 'https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/1.mp3', fileKind: 'chapter', bitrateKbps: 128,
      srcStartMs: 7000, srcEndMs: 9000, fadeInMs: 20, fadeOutMs: 60, snapToPause: false, extendToSpeechOnset: false, trimSilence: false, words: [], ayahs: [],
    }
    try {
      await assembleAudio({ reciterId: 'x', clips: [clip], wordLevel: false, exact: true, playedSelection: { surah: 1, start: { ayah: 2, word: 1 }, end: { ayah: 2, word: 4 } } })
      return { refused: false }
    } catch (e) {
      return { refused: true, name: (e as Error).name, code: (e as { code?: string }).code, message: (e as Error).message }
    }
  })

  await step('abort', async () => {
    const ac = new AbortController()
    const p = assembleAudio(await planClassB(), { signal: ac.signal })
    ac.abort()
    try {
      await p
      return { aborted: false }
    } catch (e) {
      return { aborted: (e as Error).name === 'AbortError', name: (e as Error).name }
    }
  })

  let planA: AudioPlan | null = null
  await step('classA', async () => {
    planA = await planClassA()
    const r = await timedExport('classA', planA, { width: 720, height: 1280 }, log, files)
    pcm.classA = interleave(r.assembled.audio as AudioBuffer)
    const { assembled, ...rest } = r
    void assembled
    return { planned: planA.clips.map((c) => [c.url.split('/').pop(), c.srcStartMs, c.srcEndMs]), ...rest }
  })

  await step('classB', async () => {
    const plan = await planClassB()
    const r = await timedExport('classB', plan, { width: 720, height: 1280 }, log, files)
    pcm.classB = interleave(r.assembled.audio as AudioBuffer)
    const { assembled, ...rest } = r
    void assembled
    return { planned: plan.clips.map((c) => [c.srcStartMs, c.srcEndMs]), ...rest }
  })

  await step('classD', async () => {
    const plan = await planClassD()
    const r = await timedExport('classD', plan, { width: 720, height: 1280 }, log, files)
    const a = r.assembled.audio as AudioBuffer
    const ch = a.getChannelData(0)
    const { assembled, ...rest } = r
    void assembled
    return {
      plannedMs: [plan.clips[0].srcStartMs, plan.clips[0].srcEndMs],
      snappedStartMs: rest.clips[0].srcStartMs,
      snappedEndMs: +(rest.clips[0].srcStartMs + rest.clips[0].durationMs).toFixed(2),
      firstAndLast100msDb: [rmsDb(ch, 0, 4800), rmsDb(ch, ch.length - 4800, ch.length)],
      wholeDb: rmsDb(ch, 0, ch.length),
      ...rest,
    }
  })

  await step('image', async () => {
    const scene = labScene(1080, 1920, 0, 'PNG 1080x1920', [])
    const t0 = performance.now()
    const f = await exportImage({ scene, fileBase: 'balligh-lab-image', tMs: 0 })
    files.image = f
    return { ms: Math.round(performance.now() - t0), bytes: f.blob.size, mimeType: f.mimeType, fileName: f.fileName }
  })

  // Still pages: one PNG per page in page order (each page paints its own colour band, read back from the PNG),
  // "<base>-k.png" names, progress, the maxPages cap (default 10) and the share limits of one share sheet.
  await step('pages', async () => {
    const scene = labPagesScene(1080, 1920, 3)
    const progress: number[] = []
    const t0 = performance.now()
    const pages = await exportImages({ scene, fileBase: 'balligh-lab-pages', onProgress: (r) => progress.push(+r.toFixed(3)) })
    const ms = Math.round(performance.now() - t0)
    pages.forEach((f, i) => (files[`page${i + 1}`] = f))
    const colors = await Promise.all(pages.map((f) => pixelOf(f.blob, 540, 60)))
    const one = await exportImage({ scene, fileBase: 'balligh-lab-page', page: 1 })
    const twelve = await exportImages({ scene: labPagesScene(720, 1280, 12), fileBase: 'cap' })
    const two = await exportImages({ scene, fileBase: 'two', maxPages: 2 })
    let pageOutOfRange: string | null = null
    try {
      await exportImage({ scene, fileBase: 'x', page: 3 })
    } catch (e) {
      pageOutOfRange = (e as Error).name
    }
    // Without transient activation the share must be refused (NotAllowedError → 'unsupported'). Automation can grant
    // activation behind our back (puppeteer's page.evaluate runs with userGesture: true); a share started then stays
    // pending in headless Chrome and blocks every later one (InvalidStateError), so only try when there is none.
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
    const shareWithoutGesture =
      activation && !activation.isActive
        ? await Promise.race([shareFiles(pages, { title: 'بلّغ', text: 'lab' }), sleep(5000).then(() => 'no answer in 5 s' as const)])
        : `skipped: transient activation ${activation ? 'present (automation)' : 'not observable'}`
    return {
      ms,
      names: pages.map((f) => f.fileName),
      kb: pages.map((f) => Math.round(f.blob.size / 1024)),
      types: [...new Set(pages.map((f) => f.blob.type))],
      progress,
      pageOrderOk: colors.every((c, k) => sameColor(c, pageColor(k))),
      exportImagePage1: { ok: sameColor(await pixelOf(one.blob, 540, 60), pageColor(1)), fileName: one.fileName },
      twelvePagesExported: twelve.length,
      twelveLastName: twelve[twelve.length - 1].fileName,
      maxPages2: two.map((f) => f.fileName),
      pageOutOfRange,
      canShareFiles: {
        navigatorShare: typeof navigator.share === 'function',
        none: canShareFiles([]),
        three: canShareFiles(pages),
        eleven: canShareFiles([...twelve.slice(0, 10), one]),
      },
      shareFiles: { withoutGesture: shareWithoutGesture, none: await shareFiles([], { title: '', text: '' }) },
    }
  })

  // 00-gaps D3: a video over 300 s is refused before anything is encoded (no progress, a few ms).
  await step('tooLong', async () => {
    const audio = new AudioBuffer({ numberOfChannels: 1, length: 301 * 8000, sampleRate: 8000 })
    let progressCalls = 0
    const t0 = performance.now()
    try {
      await exportVideo({ scene: labScene(720, 1280, 301_000, 'too long', []), audio, fileBase: 'too-long', onProgress: () => progressCalls++ })
      return { refused: false }
    } catch (e) {
      return {
        refused: e instanceof AudioSourceError && e.code === 'too-long',
        name: (e as Error).name,
        code: (e as { code?: string }).code,
        message: (e as Error).message,
        ms: Math.round(performance.now() - t0),
        progressCalls,
      }
    }
  })

  // trimSilence on a whole file with 4 s of leading quiet (Husary Mujawwad 1:1, EveryAyah); the harness checks the
  // trimmed PCM against ffmpeg's decode of the file at the srcStartMs ClipResult reports.
  await step('trim', async () => {
    const url = 'https://everyayah.com/data/Husary_128kbps_Mujawwad/001001.mp3'
    const planOf = (trim: boolean): AudioPlan => ({
      reciterId: 'husary-mujawwad',
      clips: [{ ...bareClip(url, 'per_ayah', null, 0, null, trim), fadeInMs: 8, fadeOutMs: 60 }],
      wordLevel: false,
      exact: true,
      playedSelection: SELECTION,
    })
    const whole = await assembleAudio(planOf(false))
    const trimmed = await assembleAudio(planOf(true))
    const buf = trimmed.audio as AudioBuffer
    pcm.trim = interleave(buf)
    const ch = buf.getChannelData(0)
    return {
      url,
      wholeMs: +whole.clips[0].durationMs.toFixed(2),
      srcStartMs: +trimmed.clips[0].srcStartMs.toFixed(2),
      durationMs: +trimmed.clips[0].durationMs.toFixed(2),
      removedLeadMs: +trimmed.clips[0].srcStartMs.toFixed(1),
      removedTailMs: +(whole.clips[0].durationMs - trimmed.clips[0].srcStartMs - trimmed.clips[0].durationMs).toFixed(1),
      levelsDb: { first80ms: rmsDb(ch, 0, 3840), next300ms: rmsDb(ch, 3840, 3840 + 14_400), last80ms: rmsDb(ch, ch.length - 3840, ch.length) },
    }
  })

  // isti'adha → basmala → ayahs, planned by domain from data's real sources (class A: Alafasy; class C: Hudhaify,
  // every clip a whole file with trimSilence), checked on the audio itself; the class A run is also exported as a
  // real render scene (the harness grabs a frame inside each timeline window).
  await step('istiadha', async () => {
    const run = await istiadhaRun('alafasy', 112, 1, 2)
    pcm.istiadha = interleave(run.assembled.audio as AudioBuffer)
    const v = await istiadhaVideo(run, 'balligh-lab-istiadha')
    files.istiadha = v.file
    return { ...run.report, windows: run.windows, video: { fileName: v.file.fileName, bytes: v.file.blob.size, encodeMs: v.encodeMs } }
  })

  await step('istiadhaC', async () => {
    const run = await istiadhaRun('hudhaifi', 112, 1, 2)
    pcm.istiadhaC = interleave(run.assembled.audio as AudioBuffer)
    return { ...run.report, windows: run.windows }
  })

  // Real still scenes whose tafsir runs over several pages (render pages it, never truncates): Sa'di on 2:255, and
  // Ibn Kathir on 2:255, long enough to hit the 10-page cap.
  await step('pagesReal', async () => {
    const saadi = await tafsirPages('saadi', 2, 255, 'balligh-lab-2-255-saadi')
    saadi.files.forEach((f, i) => (files[`saadi${i + 1}`] = f))
    const ibnKathir = await tafsirPages('ibnkathir', 2, 255, 'balligh-lab-2-255-ibnkathir')
    ibnKathir.files.slice(0, 1).forEach((f) => (files.ibnkathir1 = f))
    return { saadi: saadi.report, ibnKathir: ibnKathir.report }
  })

  await step('player', async () => {
    const plan = planA ?? (await planClassA())
    const a = await assembleAudio(plan)
    return playerCheck(a.audio)
  })

  await step('speed', async () => {
    const plan = await plan60s()
    const out: Record<string, unknown> = {}
    for (const size of [{ width: 720, height: 1280 }, { width: 1080, height: 1920 }]) {
      const r = await timedExport('speed60', plan, size, log, files)
      const { assembled, ...rest } = r
      void assembled
      out[`${size.width}x${size.height}`] = rest
    }
    return out
  })

  return { results, files, pcm }
}
