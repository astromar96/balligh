// What the preview stage says under its controls: the recitation loading (with its progress), a recitation that
// failed or runs too long for a video, a tafsir whose pages would turn too fast, and the platforms' length limits.
// Drawn on the stage's dark mat (`onStage`, the wide layout), or by the narrow step flow on the page under the Stage,
// so the pinned preview keeps one height whatever there is to say.
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { tafsirTooFast, useCompose } from '../compose'
import { formatClock } from '../format'
import { useT } from '../hooks'
import { durationWarningKeys } from '../options'
import { describeError } from '../safe'
import { useAppStore } from '../store'
import { useTheme } from '../theme'
import { SPACE, TYPE } from '../tokens'
import { DurationWarnings } from './DurationWarnings'
import { Icon } from './Icon'
import { ProgressBar } from './primitives'

/**
 * `onStage`: the rows go straight into the Stage's mat (its gap spaces them). Otherwise they come in their own View
 * (`style`), and nothing at all is rendered while there is nothing to say.
 */
export function StageNotes({ onStage = false, style }: { onStage?: boolean; style?: StyleProp<ViewStyle> }) {
  const th = useTheme()
  const { t, lang } = useT()
  const showTafsir = useAppStore((s) => s.design.showTafsir)
  const model = useCompose((s) => s.model)
  const audio = useCompose((s) => s.audio)
  const retryAudio = useCompose((s) => s.retryAudio)
  const arabic = lang === 'ar'
  const timed = audio.status === 'ready' && !!model?.timeline
  const lengthMs = audio.status === 'ready' && audio.value ? audio.value.timeline.durationMs : audio.status === 'loading' ? audio.estimateMs : null
  const fastTafsir = timed && showTafsir && tafsirTooFast(model)
  const any = audio.status === 'loading' || audio.status === 'error' || audio.status === 'too-long' || fastTafsir || (lengthMs !== null && durationWarningKeys(lengthMs).length > 0)
  const c = onStage
    ? { text: th.onStage, muted: th.onStageMuted, alert: '#E9B6AE', link: '#BFD2F2', track: 'rgba(236,230,216,0.14)' }
    : { text: th.text, muted: th.textMuted, alert: th.warn, link: th.link, track: th.hairline }

  if (!onStage && !any) return null
  const rows = (
    <>
      {audio.status === 'loading' ? (
        <View style={{ gap: SPACE.xs }}>
          <Text style={[TYPE.caption, { color: c.muted }]}>{t('loadingAudio')}</Text>
          <ProgressBar ratio={audio.progress} color={th.gold} track={c.track} />
        </View>
      ) : audio.status === 'error' ? (
        <View style={styles.audioNote} testID="audio-error">
          <Icon name="alert" size={16} color={c.alert} />
          <Text style={[TYPE.caption, { color: c.text, flex: 1 }]}>
            {describeError(lang, 'whatAudio', audio.error)} {t('previewSilent')}
          </Text>
          <Pressable accessibilityRole="button" onPress={retryAudio} style={styles.retry}>
            <Text style={[TYPE.label, { color: c.link }]}>{t('retry')}</Text>
          </Pressable>
        </View>
      ) : audio.status === 'too-long' ? (
        <View style={styles.audioNote} testID="audio-too-long">
          <Icon name="alert" size={16} color={c.alert} />
          <Text style={[TYPE.caption, { color: c.text, flex: 1 }]}>
            {audio.estimateMs !== null ? t('tooLongVideoAbout', { time: formatClock(audio.estimateMs, arabic) }) : t('tooLongVideo')}
          </Text>
        </View>
      ) : null}

      {fastTafsir ? (
        <View style={styles.audioNote} testID="tafsir-fast">
          <Icon name="info" size={16} color={c.muted} />
          <Text style={[TYPE.caption, { color: c.muted, flex: 1 }]}>{t('tafsirFastPages')}</Text>
        </View>
      ) : null}

      <DurationWarnings durationMs={lengthMs} onStage={onStage} />
    </>
  )
  return onStage ? rows : <View style={[styles.offStage, style]}>{rows}</View>
}

const styles = StyleSheet.create({
  offStage: { gap: SPACE.sm },
  audioNote: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  retry: { minHeight: 28, justifyContent: 'center' },
})
