// Native media platform — interface-ready stub. Metro picks platform.web.ts on the web.
//
// Porting notes (what the web build proved, research/media-pipeline.md + its Independent verification):
// - Reuse the pure modules unchanged: mp3.ts (frame sync, Info frame, CRC re-sign, Range slice plans),
//   clips.ts (stale timings, snapping, onset, sample-exact cut/fade/mix), envelope.ts, budget.ts, lru.ts.
//   Only fetching, decoding, playing, encoding and sharing are platform work.
// - Audio: fetch with the same stall timeout + one retry, Range windows for chapter files, whole files
//   for per-ayah files. Decode to 48 kHz stereo (react-native-audio-api's decodeAudioData, or
//   AVAudioFile / MediaCodec). The timings' reference timeline is ffmpeg's decode: tagged files trimmed
//   by encoder delay + 529, untagged files raw. WebKit decodes through AudioToolbox and there untagged
//   files come out 529 samples early and a LAME tag with a bad CRC is ignored; iOS AVFoundation probably
//   does the same (UNVERIFIED), so run decoderSkew.web.ts's probe against the native decoder too and
//   re-sign LAME CRCs before decoding (mp3.ts resignLameCrc).
// - Preview: one AudioBufferSourceNode-like player whose position comes from the audio clock, never
//   from a JS timer (player.web.ts).
// - Video: H.264 + AAC-LC MP4 with even dimensions, 30 fps, keyframe every 2 s, bitrates and the
//   0.9 × 50 MiB size cap from budget.ts (AVAssetWriter on iOS, Media3 Transformer / MediaCodec +
//   MediaMuxer on Android), frames from Skia snapshots of the same Scene (preview == export), audio
//   priming written as an edit list so A/V stays at 0 samples.
// - Image: Skia surface → PNG, one per Scene page (scene.drawPage, ≤ 10, names from budget.ts fileNameFor with
//   `part`). Share: expo-file-system + expo-sharing (no 50 MiB Web Share cap). SDK 58's Sharing.shareAsync(url,
//   { mimeType, UTI, dialogTitle, anchor }) shares ONE local file and no text (docs checked 2026-11-21), so
//   shareFiles needs one share per page there (or another module), and the credits/text go in the file itself.
// - QF Terms: exports stay in memory/the cache directory only for the share, never kept by the app (00-gaps §2.9).
import type { MediaPlatform } from './index'

const notYet = (what: string) => Promise.reject(new Error(`media: ${what} is not implemented on native yet (web only for now)`))

export const mediaPlatform: MediaPlatform = {
  assembleAudio: () => notYet('assembleAudio'),
  createPreviewPlayer: () => {
    throw new Error('media: createPreviewPlayer is not implemented on native yet')
  },
  detectVideoSupport: () =>
    Promise.resolve({
      method: 'none',
      container: null,
      reason: 'native-app',
      noteAr: 'تصدير الفيديو متاح حاليًا من المتصفح فقط.',
      noteEn: 'Video export is available in the browser only for now.',
    }),
  exportVideo: () => notYet('exportVideo'),
  exportImage: () => notYet('exportImage'),
  exportImages: () => notYet('exportImages'),
  canShareFile: () => false,
  canShareFiles: () => false,
  shareFile: () => Promise.resolve('unsupported'),
  shareFiles: () => Promise.resolve('unsupported'),
  downloadFile: () => {
    throw new Error('media: downloadFile is not implemented on native yet')
  },
  shareLink: () => notYet('shareLink'),
}
