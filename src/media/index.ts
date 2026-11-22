// media/ — audio assembly, preview playback, encoding and sharing. Owner: media agent.
// Platform code lives ONLY in ./platform(.web).ts:
//   platform.web.ts — Web Audio + Mediabunny/WebCodecs (+ lazy AAC WASM) + Web Share — implemented now
//   platform.ts     — native stub (later: react-native-audio-api, a native H.264/AAC encoder module, expo-sharing)
import type { AudioPlan, ClipResult, ExportedFile, ExportProgress, Scene } from '../core/types'
import { mediaPlatform } from './platform'

/**
 * Why audio could not be fetched, decoded or exported; `code` picks the UI's Arabic message:
 * 'http' (status set) · 'network' · 'timeout' (no data for 15 s, retried once) · 'vbr' (a variable-bitrate chapter
 * file cannot be windowed — data serves the known ones per ayah, so this is rare) · 'no-sync' / 'decode' (not a
 * usable MP3) · 'range-ignored' (a server sent a whole large file) · 'too-long' (a video over 300 s, 00-gaps D3,
 * or a source too big to decode) · 'empty' (nothing left to play). Platform-neutral (./errors).
 */
export { AudioSourceError, type AudioSourceErrorCode } from './errors'

// ── Audio ──

/** Platform audio buffer: an AudioBuffer on the web (react-native-audio-api's on native later). */
export interface PcmAudio {
  readonly sampleRate: number
  readonly numberOfChannels: number
  /** seconds, like AudioBuffer.duration */
  readonly duration: number
}

export interface AssembledAudio {
  /** 48 kHz stereo, clips concatenated in plan order with their fades applied */
  audio: PcmAudio
  /** per plan clip: the source start actually used (after pause-snapping) and the real duration */
  clips: ClipResult[]
}

// ── Preview playback ──

export interface PreviewPlayer {
  /** Must be called from a user gesture the first time (autoplay policy). */
  play(fromMs?: number): Promise<void>
  pause(): void
  seek(ms: number): void
  isPlaying(): boolean
  /** current position on the audio clock, ms */
  currentMs(): number
  durationMs(): number
  onEnded(cb: () => void): () => void
  dispose(): void
}

// ── Export ──

/**
 * Why no video can be made here: 'no-video-encoder' (no WebCodecs H.264 at this size — Firefox Android),
 * 'no-audio-encoder' (no AAC encoder and no WebAssembly/Worker for the WASM one), 'native-app' (the native app's
 * encoder module does not exist yet).
 */
export type VideoUnsupportedReason = 'no-video-encoder' | 'no-audio-encoder' | 'native-app'

export interface VideoSupport {
  /**
   * 'native' — WebCodecs H.264 + native AAC
   * 'aac-polyfill' — WebCodecs H.264 + @mediabunny/aac-encoder (lazy-loaded WASM, ~284 KiB gzip)
   * 'none' — no video encoder here (Firefox Android; the native app until its encoder module exists): offer PNG only
   * MediaRecorder is deliberately NOT used (research/media-pipeline.md §0.3: VFR, dropped starts, A/V offsets).
   */
  method: 'native' | 'aac-polyfill' | 'none'
  container: 'mp4' | null
  /** why method is 'none'; null otherwise */
  reason: VideoUnsupportedReason | null
  /** Arabic note for the UI when method is 'none' (what happened + what to do) */
  noteAr: string | null
  /** the same note in English, for the English UI */
  noteEn: string | null
}

export interface MediaPlatform {
  /**
   * Fetches (CORS) and decodes every clip (per-ayah files whole, cached by URL; chapter files as HTTP
   * Range slices — research/audio-timing.md §7 + media-pipeline.md §0.4: skip ID3, find a valid frame
   * sync, refuse VBR, ±1 s margin, prepend the file's Info frame / trim to the first sync, discard the
   * warm-up), trims a whole file's leading/trailing silence when clip.trimSilence (80 ms kept, speech never
   * cut), snaps edges to the quietest point when clip.snapToPause, cuts, fades and concatenates in plan order
   * (isti'adha → basmala → ayahs) into one 48 kHz stereo buffer. ClipResult reports the window actually used.
   * Decoded audio is cached in memory only (≤ 1 day); nothing is written to storage. Rejects with
   * AudioSourceError (see its codes) or an AbortError DOMException.
   */
  assembleAudio(plan: AudioPlan, opts?: { signal?: AbortSignal; onProgress?: (ratio: number) => void }): Promise<AssembledAudio>
  createPreviewPlayer(audio: PcmAudio): PreviewPlayer
  detectVideoSupport(width: number, height: number): Promise<VideoSupport>
  /**
   * Renders scene.draw at `fps` (default 30) for the whole audio and muxes it: Mediabunny
   * Output(Mp4OutputFormat{fastStart:'in-memory'}, BufferTarget), CanvasSource('avc', keyframe 2 s)
   * + AudioBufferSource('aac', 128 kbps). Video bitrate 2.5 Mbps at 720p, ≤ 4.5 Mbps at 1080p, total
   * capped at 0.9 × 50 MiB × 8 / duration. Registers the AAC polyfill first when native AAC is missing.
   * Audio longer than 300 s (domain MAX_VIDEO_MS, 00-gaps D3) is refused before anything is encoded:
   * AudioSourceError 'too-long'. Yields to the event loop; rejects with DOMException 'AbortError' on abort.
   * The caller creates `scene` at the export size (render/exportSize). The file lives in memory only.
   */
  exportVideo(opts: {
    scene: Scene
    audio: PcmAudio
    fps?: number
    fileBase: string
    signal?: AbortSignal
    onProgress?: (p: ExportProgress) => void
  }): Promise<ExportedFile>
  /**
   * One PNG at the scene's size, "<fileBase>.png": still page `page` (scene.drawPage, 0-based; RangeError when it
   * does not exist) when given, else scene.draw(painter, tMs ?? 0) (a still scene: page 0).
   */
  exportImage(opts: { scene: Scene; fileBase: string; tMs?: number; page?: number }): Promise<ExportedFile>
  /**
   * One PNG per still page (scene.drawPage), "<fileBase>-1.png", "<fileBase>-2.png" … (numbered even for a single
   * page — use exportImage for one unnumbered file), at most `maxPages` (default 10 = one share sheet, 00-gaps D3).
   * A scene with more pages gets its first `maxPages` only: check scene.pageCount first and ask for a shorter
   * selection (the text and licensed tafsir must never lose pages). onProgress(0..1) after each page. `signal` is
   * checked before every page: rejects with DOMException 'AbortError' (cancelling the sheet stops the drawing).
   */
  exportImages(opts: {
    scene: Scene
    fileBase: string
    maxPages?: number
    onProgress?: (ratio: number) => void
    signal?: AbortSignal
  }): Promise<ExportedFile[]>
  canShareFile(file: ExportedFile): boolean
  /** Whether ONE share sheet can carry these files: 1–10 files (Chromium), ≤ 50 MiB in total, .mp4/.png only. */
  canShareFiles(files: ExportedFile[]): boolean
  /**
   * Opens the system share sheet with the file. Must run inside a FRESH user gesture (the "Share"
   * button's own handler — transient activation lasts ~5 s). AbortError → 'cancelled';
   * NotAllowedError/TypeError/no API → 'unsupported' (the UI then offers download).
   */
  shareFile(file: ExportedFile, meta: { title: string; text: string }): Promise<'shared' | 'cancelled' | 'unsupported'>
  /**
   * shareFile for several files in one share sheet (the pages of a still): same fresh-gesture rule and results;
   * 'unsupported' at once when canShareFiles(files) is false (more than 10 files or 50 MiB → download instead).
   */
  shareFiles(files: ExportedFile[], meta: { title: string; text: string }): Promise<'shared' | 'cancelled' | 'unsupported'>
  downloadFile(file: ExportedFile): void
  /** Shares a deep link via the share sheet, or copies it to the clipboard. */
  shareLink(url: string, title: string): Promise<'shared' | 'copied' | 'cancelled'>
}

export const assembleAudio: MediaPlatform['assembleAudio'] = (plan, opts) => mediaPlatform.assembleAudio(plan, opts)
export const createPreviewPlayer: MediaPlatform['createPreviewPlayer'] = (audio) => mediaPlatform.createPreviewPlayer(audio)
export const detectVideoSupport: MediaPlatform['detectVideoSupport'] = (w, h) => mediaPlatform.detectVideoSupport(w, h)
export const exportVideo: MediaPlatform['exportVideo'] = (opts) => mediaPlatform.exportVideo(opts)
export const exportImage: MediaPlatform['exportImage'] = (opts) => mediaPlatform.exportImage(opts)
export const exportImages: MediaPlatform['exportImages'] = (opts) => mediaPlatform.exportImages(opts)
export const canShareFile: MediaPlatform['canShareFile'] = (file) => mediaPlatform.canShareFile(file)
export const canShareFiles: MediaPlatform['canShareFiles'] = (files) => mediaPlatform.canShareFiles(files)
export const shareFile: MediaPlatform['shareFile'] = (file, meta) => mediaPlatform.shareFile(file, meta)
export const shareFiles: MediaPlatform['shareFiles'] = (files, meta) => mediaPlatform.shareFiles(files, meta)
export const downloadFile: MediaPlatform['downloadFile'] = (file) => mediaPlatform.downloadFile(file)
export const shareLink: MediaPlatform['shareLink'] = (url, title) => mediaPlatform.shareLink(url, title)

export type { ExportedFile, ExportProgress }
