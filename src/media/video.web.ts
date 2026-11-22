// Web video export: Mediabunny 1.66.2 on WebCodecs → MP4 (H.264 + AAC), frames drawn by the platform-neutral
// Scene through render's Canvas 2D Painter. research/media-pipeline.md §4–§5, §9.
// Mediabunny and @mediabunny/aac-encoder are only ever imported dynamically, here: they stay out of the initial
// bundle and are never evaluated during static rendering. Only one copy may exist (§4 pitfall): the encoder
// registers into the 'mediabunny' module it imports itself, which Metro resolves to this same module. A STATIC
// import anywhere (even `import { type X } from 'mediabunny'`, which verbatimModuleSyntax keeps as a side-effect
// import) makes the dev server's static renderer evaluate it on every hot reload, in the same Node global, and
// Mediabunny then logs "Mediabunny was loaded twice" — imports.test.ts guards this.
import type { ExportedFile, ExportProgress, Scene } from '../core/types'
import { createCanvasPainter } from '../render/platform.web'
import {
  AUDIO_BITRATE,
  DEFAULT_FPS,
  KEYFRAME_INTERVAL_SEC,
  assertVideoLength,
  constrainedBaselineCodec,
  evenSize,
  fileNameFor,
  frameCount,
  videoBitrateFor,
} from './budget'
import { context2d, newCanvas, paintFrame, yieldToEventLoop } from './canvas.web'
import type { PcmAudio, VideoSupport, VideoUnsupportedReason } from './index'

interface Unsupported {
  reason: VideoUnsupportedReason
  noteAr: string
  noteEn: string
}

const NO_ENCODER: Unsupported = {
  reason: 'no-video-encoder',
  noteAr: 'هذا المتصفح لا يستطيع إنشاء الفيديو على جهازك. حمّل الصورة بدلًا منه، أو افتح بلّغ في Chrome أو Safari لتصدير الفيديو.',
  noteEn: 'This browser cannot make the video on your device. Download the image instead, or open Balligh in Chrome or Safari to export the video.',
}
const NO_AAC: Unsupported = {
  reason: 'no-audio-encoder',
  noteAr: 'هذا المتصفح لا يستطيع ترميز صوت الفيديو. حمّل الصورة بدلًا منه، أو افتح بلّغ في Chrome أو Safari لتصدير الفيديو.',
  noteEn: "This browser cannot encode the video's sound. Download the image instead, or open Balligh in Chrome or Safari to export the video.",
}

function abortError(): DOMException {
  return new DOMException('Export cancelled', 'AbortError')
}

/**
 * QA override for development builds only: ?aac=polyfill forces the WASM AAC encoder even where a native one
 * exists. Production ignores it (`npx expo export` strips __DEV__ code), so a shared link can never switch a
 * user's export to the slower encoder.
 */
function aacPolyfillForced(): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('aac') === 'polyfill'
  } catch {
    return false
  }
}

type Mediabunny = typeof import('mediabunny')

let mediabunny: Promise<Mediabunny> | null = null
function loadMediabunny(): Promise<Mediabunny> {
  if (!mediabunny) {
    mediabunny = import('mediabunny')
    mediabunny.catch(() => {
      mediabunny = null
    })
  }
  return mediabunny
}

let aacPolyfill: Promise<void> | null = null
/** Lazy-loads @mediabunny/aac-encoder (FFmpeg AAC in WASM, ~284 KiB gzip) and registers it once. */
function loadAacPolyfill(): Promise<void> {
  if (!aacPolyfill) {
    aacPolyfill = import('@mediabunny/aac-encoder').then((m) => m.registerAacEncoder())
    aacPolyfill.catch(() => {
      aacPolyfill = null
    })
  }
  return aacPolyfill
}

interface Negotiated {
  /** undefined → Mediabunny picks the profile/level (High on Chromium, Constrained Baseline on WebKit) */
  fullCodecString: string | undefined
  aac: 'native' | 'polyfill'
}

const negotiations = new Map<string, Promise<Negotiated | Unsupported>>()

/** Codec ladder of media-pipeline §5.1 steps 1–3 (MP4 only; no H.264 → PNG). Memoised per size. */
function negotiate(width: number, height: number, fps: number): Promise<Negotiated | Unsupported> {
  const forced = aacPolyfillForced()
  const key = `${width}x${height}@${fps}${forced ? '+polyfill' : ''}`
  let p = negotiations.get(key)
  if (!p) {
    p = (async () => {
      if (typeof VideoEncoder === 'undefined' || (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined')) {
        return NO_ENCODER
      }
      const { Quality, canEncodeAudio, canEncodeVideo } = await loadMediabunny()
      // Check with the bitrate a 60 s clip would get; the size (portrait, gotcha 6) is what matters.
      const quality = new Quality({ bitrate: videoBitrateFor(width, height, 60) })
      let fullCodecString: string | undefined
      if (!(await canEncodeVideo('avc', { width, height, frameRate: fps, quality }))) {
        const cb = constrainedBaselineCodec(width, height)
        if (!(await canEncodeVideo('avc', { width, height, frameRate: fps, quality, fullCodecString: cb }))) {
          return NO_ENCODER
        }
        fullCodecString = cb
      }
      const audioOpts = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: AUDIO_BITRATE }) }
      if (!forced && (await canEncodeAudio('aac', audioOpts))) return { fullCodecString, aac: 'native' }
      if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') return NO_AAC
      return { fullCodecString, aac: 'polyfill' }
    })()
    negotiations.set(key, p)
    p.catch(() => negotiations.delete(key))
  }
  return p
}

export async function detectVideoSupportWeb(width: number, height: number): Promise<VideoSupport> {
  const n = await negotiate(evenSize(width), evenSize(height), DEFAULT_FPS).catch((): Unsupported => NO_ENCODER)
  if ('reason' in n) return { method: 'none', container: null, ...n }
  if (n.aac === 'polyfill') loadAacPolyfill().catch(() => {}) // warm the chunk; registered before encoding
  return { method: n.aac === 'native' ? 'native' : 'aac-polyfill', container: 'mp4', reason: null, noteAr: null, noteEn: null }
}

interface WakeLockLike {
  release(): Promise<void>
}

async function keepScreenOn(): Promise<WakeLockLike | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && nav.wakeLock) {
      return await nav.wakeLock.request('screen')
    }
  } catch {
    // not allowed here (e.g. iOS < 18.4 home-screen apps)
  }
  return null
}

function asAudioBuffer(audio: PcmAudio): AudioBuffer {
  if (typeof AudioBuffer !== 'undefined' && audio instanceof AudioBuffer) return audio
  throw new TypeError('media: exportVideo needs the AudioBuffer returned by assembleAudio')
}

export async function exportVideoWeb(opts: {
  scene: Scene
  audio: PcmAudio
  fps?: number
  fileBase: string
  signal?: AbortSignal
  onProgress?: (p: ExportProgress) => void
}): Promise<ExportedFile> {
  const { scene, signal, onProgress } = opts
  const fps = opts.fps ?? DEFAULT_FPS
  if (signal?.aborted) throw abortError()
  assertVideoLength(opts.audio.duration) // before anything is encoded (00-gaps D3: AudioSourceError 'too-long')
  const audio = asAudioBuffer(opts.audio)
  const width = evenSize(scene.width)
  const height = evenSize(scene.height)
  const durationSec = audio.duration
  const n = await negotiate(width, height, fps)
  if ('reason' in n) throw new Error(`media: no H.264/AAC encoder in this browser (${n.reason}) — ${n.noteEn}`)
  if (n.aac === 'polyfill') await loadAacPolyfill()
  const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } = await loadMediabunny()
  if (signal?.aborted) throw abortError()

  const canvas = newCanvas(width, height)
  const ctx = context2d(canvas)
  const painter = createCanvasPainter(ctx, width, height)
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const video = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new Quality({ bitrate: videoBitrateFor(width, height, durationSec) }),
    keyFrameInterval: KEYFRAME_INTERVAL_SEC,
    fullCodecString: n.fullCodecString,
    latencyMode: 'quality',
  })
  output.addVideoTrack(video, { frameRate: fps })
  const sound = new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: AUDIO_BITRATE }) })
  output.addAudioTrack(sound)

  const wake = await keepScreenOn()
  try {
    await output.start()
    // The audio is small: encode it all first and close its source, so the muxer never waits on it.
    onProgress?.({ phase: 'audio', ratio: 0 })
    await sound.add(audio)
    sound.close()
    onProgress?.({ phase: 'audio', ratio: 1 })

    const frames = frameCount(durationSec, fps)
    let lastYield = performance.now()
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw abortError()
      const tMs = (i / fps) * 1000
      paintFrame(ctx, painter, width, height, (p) => scene.draw(p, tMs))
      await video.add(i / fps, 1 / fps) // captures the canvas now; resolves when the encoder has room
      onProgress?.({ phase: 'frames', ratio: (i + 1) / frames })
      if (performance.now() - lastYield > 30) {
        await yieldToEventLoop()
        lastYield = performance.now()
      }
    }
    video.close()
    onProgress?.({ phase: 'finalizing', ratio: 0 })
    await output.finalize()
    onProgress?.({ phase: 'finalizing', ratio: 1 })
  } catch (e) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {})
    if (signal?.aborted) throw abortError()
    throw e
  } finally {
    wake?.release().catch(() => {})
  }
  const data = output.target.buffer
  if (!data) throw new Error('media: the encoder produced no data')
  // In memory only: the app never stores an export (QF Terms, 00-gaps §2.9); the user shares or downloads it.
  return { blob: new Blob([data], { type: 'video/mp4' }), mimeType: 'video/mp4', extension: 'mp4', fileName: fileNameFor(opts.fileBase, 'mp4') }
}
