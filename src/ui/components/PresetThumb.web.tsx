// Background preset thumbnail — web: the preset's own draw() on a small DPR-aware canvas, so the
// thumbnail is exactly the background the export will use. A quiet swatch sits behind the canvas and
// shows through when drawing fails (the canvas is cleared), so no React state is needed for it.
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { getGraphics } from '../../render'
import { createCanvasPainter } from '../../render/platform.web'
import { useTheme } from '../theme'
import type { PresetThumbProps } from './PresetThumb'

export type { PresetThumbProps } from './PresetThumb'

export function PresetThumb({ preset, width, height }: PresetThumbProps) {
  const th = useTheme()
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    const w = Math.max(2, Math.round(width * dpr))
    const h = Math.max(2, Math.round(height * dpr))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      preset.draw(createCanvasPainter(ctx, w, h), getGraphics(), w, h)
    } catch {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
    }
  }, [preset, width, height])
  return (
    <View style={{ width, height, borderRadius: 4, overflow: 'hidden', backgroundColor: th.skeleton }}>
      <canvas ref={ref} aria-hidden="true" style={{ width, height, display: 'block' }} />
      {/* a hairline edge so a dark preset on the dark page (or a light one on the light page) keeps its shape */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, borderRadius: 4, borderWidth: 1, borderColor: th.hairline }} />
    </View>
  )
}
