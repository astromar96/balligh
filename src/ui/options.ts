// Option tables and small rules behind the design panel and the stage (pure, unit-tested).
import type { Aspect, DesignOptions } from '../core/types'
import type { MessageKey } from './i18n'

export const ASPECTS: { aspect: Aspect; key: MessageKey; ratio: number }[] = [
  { aspect: '9:16', key: 'aspectStory', ratio: 9 / 16 },
  { aspect: '4:5', key: 'aspectPortrait', ratio: 4 / 5 },
  { aspect: '1:1', key: 'aspectSquare', ratio: 1 },
  { aspect: '16:9', key: 'aspectWide', ratio: 16 / 9 },
]

export const OVERLAYS: { v: number; key: MessageKey }[] = [
  { v: 0, key: 'none' },
  { v: 0.25, key: 'light' },
  { v: 0.45, key: 'medium' },
  { v: 0.65, key: 'strong' },
]

export const BLURS: { v: number; key: MessageKey }[] = [
  { v: 0, key: 'none' },
  { v: 8, key: 'light' },
  { v: 16, key: 'strong' },
]

/**
 * The switches for what the clip draws. No reciter-name switch: a video always credits the reciter and the riwayah
 * (QF Developer Terms), so render ignores design.showReciterName.
 */
export const ELEMENTS: { field: keyof DesignOptions; key: MessageKey }[] = [
  { field: 'showSurahHeader', key: 'showSurahHeader' },
  { field: 'showAyahNumbers', key: 'showAyahNumbers' },
  { field: 'showWaqfMarks', key: 'showWaqfMarks' },
  { field: 'highlightWords', key: 'highlightWords' },
  { field: 'showWatermark', key: 'showWatermark' },
]

/** index of the option closest to a value (designs from links may carry in-between numbers) */
export function nearestIndex(values: number[], v: number): number {
  let best = 0
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i
  return best
}

/** Platform cliffs before export (research/features.md §4.3): 60 s Instagram Stories / Shorts claims,
 * 90 s WhatsApp Status, 180 s Shorts. Longest first; information, never a block. */
export function durationWarningKeys(durationMs: number): MessageKey[] {
  const s = durationMs / 1000
  const out: MessageKey[] = []
  if (s > 180) out.push('dur180')
  if (s > 90) out.push('dur90')
  if (s > 60) out.push('dur60')
  return out
}
