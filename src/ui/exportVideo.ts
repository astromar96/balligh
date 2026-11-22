// The video export of the current state, outside React: the export sheet's «فيديو» and the render route (server/)
// both call it. Needs the compose engine's recitation, timeline and font to be ready.
import type { ExportedFile, ExportProgress } from '../core/types'
import * as media from '../media'
import { createScene, exportSize, getGraphics } from '../render'
import { useCompose } from './compose'
import { fileBaseName } from './format'
import { translate, type Language } from './i18n'
import { normalizeLocal } from './selection'
import { currentSurah, useAppStore } from './store'

/** "Al-Baqarah-255" / "Al-Baqarah-255-257": the exported file's name without its extension. */
export function currentFileBase(): string {
  const st = useAppStore.getState()
  const surah = currentSurah(st)
  const sel = st.selection ? normalizeLocal(st.selection) : null
  return fileBaseName(surah?.nameSimple ?? `Surah-${st.surah}`, sel?.start.ayah ?? 1, sel?.end.ayah ?? 1)
}

/** Encodes the current passage as MP4 at the design's aspect and the chosen export quality. */
export async function exportVideoFromState(opts: {
  lang: Language
  signal?: AbortSignal
  onProgress?: (p: ExportProgress) => void
}): Promise<ExportedFile> {
  const comp = useCompose.getState()
  const st = useAppStore.getState()
  const ready = comp.audio.status === 'ready' ? comp.audio.value : null
  if (!comp.model?.timeline || !ready || !comp.font.value) throw new Error(translate(opts.lang, 'videoWaitsAudio'))
  const assets = { font: comp.font.value, graphics: getGraphics(), backgroundImage: comp.bgImage.status === 'ready' ? comp.bgImage.value : null }
  const scene = createScene(comp.model, st.design, assets, exportSize(st.design.aspect, st.exportQuality))
  return media.exportVideo({ scene, audio: ready.assembled.audio, fileBase: currentFileBase(), signal: opts.signal, onProgress: opts.onProgress })
}
