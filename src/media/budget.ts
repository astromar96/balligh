// Pure export arithmetic: file names, frame counts, bitrates under the share-size cap, the video length cap.
// No I/O, no DOM. Source: research/media-pipeline.md §0.8, §8 (Chromium share allowlist + 50 MiB cap) and §9.2.
import { MAX_VIDEO_MS } from '../domain'
import { AudioSourceError } from './errors'

/**
 * 00-gaps D3: a video holds at most MAX_VIDEO_MS (300 s) of audio — memory (384 KB/s of PCM, an export peak of 2–3×
 * the file) and the 50 MiB share cap. Throws AudioSourceError 'too-long' beyond it (0.5 ms of float slack).
 */
export function assertVideoLength(durationSec: number): void {
  const ms = durationSec * 1000
  if (!(ms <= MAX_VIDEO_MS + 0.5)) {
    throw new AudioSourceError(
      'too-long',
      '',
      `media: the recitation lasts ${Math.round(ms / 1000)} s; a video holds at most ${MAX_VIDEO_MS / 1000} s — choose a shorter passage`,
    )
  }
}

/** Chromium caps one share at 50 MiB in total (navigator_share.cc kMaxSharedFileBytes); Android's BlobReceiver too. */
export const SHARE_MAX_BYTES = 50 * 1024 * 1024
/** Chromium caps one share at 10 files (navigator_share.cc kMaxSharedFileCount). */
export const SHARE_MAX_FILES = 10
/** Still pages exported by default (00-gaps D3): one share sheet can carry them all. */
export const MAX_IMAGE_PAGES = SHARE_MAX_FILES
/** Chromium's share allowlist checks the extension and the MIME type; these are the ones Balligh writes. */
export const SHAREABLE_TYPES: Readonly<Record<string, string>> = { mp4: 'video/mp4', png: 'image/png', webm: 'video/webm' }

/**
 * What one Web Share call may carry, checked here because canShare() checks neither type nor size (both engines said
 * yes to an .exe): 1–10 files of the allowlisted types, 50 MiB in total.
 */
export function withinShareLimits(files: readonly { blob: { size: number }; extension: string; mimeType: string }[]): boolean {
  if (files.length === 0 || files.length > SHARE_MAX_FILES) return false
  let total = 0
  for (const f of files) {
    if (SHAREABLE_TYPES[f.extension] !== f.mimeType) return false
    total += f.blob.size
  }
  return total <= SHARE_MAX_BYTES
}

export const AUDIO_BITRATE = 128_000
export const DEFAULT_FPS = 30
export const KEYFRAME_INTERVAL_SEC = 2
const VIDEO_720P = 2_500_000
const VIDEO_MAX = 4_500_000
const VIDEO_MIN = 300_000
const REF_PIXELS = 720 * 1280

/**
 * Video bitrate for a size and duration: 2.5 Mbps at 720×1280 scaled by pixel count (1 Mbps floor),
 * at most 4.5 Mbps (1080p), and the whole file kept under 0.9 × 50 MiB:
 * total ≤ 0.9 × 50 MiB × 8 / duration, video = total − 128 kbps audio.
 */
export function videoBitrateFor(width: number, height: number, durationSec: number): number {
  const byPixels = Math.min(VIDEO_MAX, Math.max(1_000_000, (VIDEO_720P * width * height) / REF_PIXELS))
  const cap = durationSec > 0 ? (0.9 * SHARE_MAX_BYTES * 8) / durationSec - AUDIO_BITRATE : Infinity
  return Math.round(Math.max(VIDEO_MIN, Math.min(byPixels, cap)))
}

/** Frames covering the whole audio: ceil(duration × fps), robust to float noise (10.0 s × 30 = 300, not 301). */
export function frameCount(durationSec: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSec * fps - 1e-6))
}

/** H.264 needs even dimensions. */
export function evenSize(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

/**
 * Constrained Baseline codec string with the level Mediabunny would pick for the size (L3.1 up to 720p,
 * L4.0 up to 1080p, L5.0 above) — the fallback when the default AVC config is rejected (media-pipeline §5.1 step 3).
 */
export function constrainedBaselineCodec(width: number, height: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16)
  const level = mbs <= 3600 ? 0x1f : mbs <= 8192 ? 0x28 : 0x32
  return `avc1.4240${level.toString(16)}`
}

/**
 * Safe, share-friendly file name: keeps letters (any script), digits, '-', '_' and '.', turns spaces and
 * everything else into '-', trims separators, caps the length and falls back to "balligh". `part` numbers the
 * pages of one export ("<base>-2.png"); it is added after the cap, so long names never lose it.
 */
export function fileNameFor(base: string, extension: string, part?: number): string {
  const cleaned = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  const capped = Array.from(cleaned).slice(0, 80).join('').replace(/[-.]+$/g, '')
  const suffix = part === undefined ? '' : `-${part}`
  return `${capped || 'balligh'}${suffix}.${extension}`
}
