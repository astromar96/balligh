// Platform cliffs before export (research/features.md §4.3): 60 s Instagram Stories / Shorts claims,
// 90 s WhatsApp Status, 180 s Shorts. Information, never a block.
import { StyleSheet, Text, View } from 'react-native'
import { useT } from '../hooks'
import { durationWarningKeys } from '../options'
import { useTheme } from '../theme'
import { SPACE, TYPE } from '../tokens'
import { Icon } from './Icon'

export function DurationWarnings({ durationMs, onStage }: { durationMs: number | null; onStage?: boolean }) {
  const th = useTheme()
  const { t } = useT()
  if (durationMs === null) return null
  const keys = durationWarningKeys(durationMs)
  if (keys.length === 0) return null
  const color = onStage ? th.onStage : th.text
  return (
    <View style={styles.wrap} testID="duration-warnings">
      {keys.map((k) => (
        <View key={k} style={styles.row}>
          <Icon name="alert" size={16} color={onStage ? '#E9B6AE' : th.warn} />
          <Text style={[TYPE.caption, { color, flex: 1 }]}>{t(k)}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
})
