// Background preset thumbnail — native placeholder (a quiet swatch). The web version draws the preset
// with preset.draw on a small canvas (PresetThumb.web.tsx).
import { View } from 'react-native'
import type { BackgroundPreset } from '../../render'
import { useTheme } from '../theme'

export interface PresetThumbProps {
  preset: BackgroundPreset
  width: number
  height: number
}

export function PresetThumb({ preset, width, height }: PresetThumbProps) {
  const th = useTheme()
  return <View style={{ width, height, borderRadius: 4, backgroundColor: preset.tone === 'light' ? th.stage : th.page }} />
}
