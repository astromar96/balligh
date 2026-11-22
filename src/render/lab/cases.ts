// Lab case description shared by bench.web.ts and its native counterpart bench.ts.
import type { Aspect, DesignOptions } from '../../core/types'

export type Variant = 'plain' | 'tajweed' | 'translation' | 'tafsir' | 'image' | 'all'
export const VARIANTS: Variant[] = ['plain', 'tajweed', 'translation', 'tafsir', 'image']
export const ASPECTS: Aspect[] = ['9:16', '4:5', '1:1', '16:9']

export interface LabCase {
  /** PASSAGES id (lab/model.ts) */
  passage: string
  variant: Variant
  aspect: Aspect
  /** 'still' = no timeline; otherwise a time on a fake recitation */
  t: 'still' | 'start' | 'mid' | 'end' | number
  /** still page to draw (default 0) */
  page?: number
  /** QF translation id (default Saheeh International); its script picks the Noto family */
  translation?: number
  /** fake timeline with word timings (default) or ayah timings only */
  words?: boolean
  width?: number
  height?: number
  preset?: string
  design?: Partial<DesignOptions>
}

export interface RenderedCase {
  canvas: HTMLCanvasElement
  buildMs: number
  drawMs: number
  tMs: number
  durationMs: number
  /** Quran text size, reference px */
  quranPx: number | undefined
  /** Quran pages (a video switches them in time; a still puts each on its own still page) */
  pages: number | undefined
  /** still pages (scene.pageCount; 1 on a video) */
  pageCount: number
  /** how a still was planned (scene layout), 'video' on a video */
  plan: string | undefined
  /** the Noto family of a shown translation and its loaded faces (0: the browser fell back to system fonts) */
  translationFont: { family: string; loadedFaces: number } | null
}
