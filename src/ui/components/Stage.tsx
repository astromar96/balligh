// Preview stage — native placeholder. The web version (Stage.web.tsx) draws the scene on a <canvas>;
// on native it will draw through the Skia Painter once render/platform.ts is implemented.
import { StyleSheet, Text, View } from 'react-native'
import { useT } from '../hooks'
import { useTheme } from '../theme'
import { RADIUS, SPACE, TYPE } from '../tokens'
import { Icon } from './Icon'

export interface StageProps {
  /** tallest the preview may be, in layout px */
  maxHeight: number
  /**
   * the Stage's own width when the parent knows it before layout (the step flow mounts a Stage each time a step
   * opens): the first frame is drawn at that size instead of a placeholder, and the layout corrects it if it is off
   */
  widthHint?: number
  /**
   * the narrow step flow: always maxHeight + STAGE_CHROME tall (components/stageLayout.ts). The notes under the
   * controls are left to the step (StageNotes), and the still image's pager takes the controls' row while there is
   * no recitation to play.
   */
  compact?: boolean
}

export function Stage(_props: StageProps) {
  const th = useTheme()
  const { t } = useT()
  return (
    <View style={[styles.mat, { backgroundColor: th.stage }]} testID="stage">
      <Icon name="video" size={28} color={th.onStageMuted} />
      <Text style={[TYPE.body, { color: th.onStage, textAlign: 'center' }]}>{t('previewNative')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  mat: { borderRadius: RADIUS.control, padding: SPACE.xl, alignItems: 'center', justifyContent: 'center', gap: SPACE.md, minHeight: 220 },
})
