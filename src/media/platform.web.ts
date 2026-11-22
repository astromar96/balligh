// Web media platform: Web Audio (decode/cut/play) + Mediabunny on WebCodecs (+ lazy
// @mediabunny/aac-encoder) + Web Share. Exports the same `mediaPlatform` shape as platform.ts.
// Nothing here touches the DOM at import time (Expo Router also renders routes on the server).
import { assembleAudioWeb } from './audio.web'
import { exportImageWeb, exportImagesWeb } from './image.web'
import type { MediaPlatform } from './index'
import { createPreviewPlayerWeb } from './player.web'
import { canShareFilesWeb, canShareFileWeb, downloadFileWeb, shareFilesWeb, shareFileWeb, shareLinkWeb } from './share.web'
import { detectVideoSupportWeb, exportVideoWeb } from './video.web'

export const mediaPlatform: MediaPlatform = {
  assembleAudio: (plan, opts) => assembleAudioWeb(plan, opts),
  createPreviewPlayer: (audio) => createPreviewPlayerWeb(audio),
  detectVideoSupport: (w, h) => detectVideoSupportWeb(w, h),
  exportVideo: (opts) => exportVideoWeb(opts),
  exportImage: (opts) => exportImageWeb(opts),
  exportImages: (opts) => exportImagesWeb(opts),
  canShareFile: (file) => canShareFileWeb(file),
  canShareFiles: (files) => canShareFilesWeb(files),
  shareFile: (file, meta) => shareFileWeb(file, meta),
  shareFiles: (files, meta) => shareFilesWeb(files, meta),
  downloadFile: (file) => downloadFileWeb(file),
  shareLink: (url, title) => shareLinkWeb(url, title),
}
