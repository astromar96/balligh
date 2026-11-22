// Under the Mushaf panel: what is selected, the boundary guard (never blocking, one-tap fixes; warnings in rubric,
// hints quiet), and how taps behave (words / whole ayahs, follow the places to stop).
// `compact` (the narrow step flow's band under the Mushaf, a few lines tall): the warnings come first with their
// fixes, then the controls; what is selected is said to screen readers only (the step bar shows it), and the
// switch's hint is left out.
import { StyleSheet, Text, View } from 'react-native'
import * as domain from '../../domain'
import type { SelectionWarning } from '../../domain'
import { findReciter, hasAyahLevelFallback, useCompose } from '../compose'
import { useT } from '../hooks'
import { sameSelection } from '../selection'
import { currentSurah, useAppStore } from '../store'
import { useTheme } from '../theme'
import { SPACE, TYPE } from '../tokens'
import { warningCopy, type SelectionFix } from '../warnings'
import { Icon } from './Icon'
import { Button, Chip, ChipRow, ToggleRow, visuallyHidden } from './primitives'

/** `onWarningsLayout`: where the warnings sit inside the status, so the step flow can size its band and reveal them. */
export function SelectionStatus({ onWarningsLayout, compact = false }: { onWarningsLayout?: (box: { y: number; height: number }) => void; compact?: boolean } = {}) {
  const th = useTheme()
  const { t, count, lang } = useT()
  const selection = useAppStore((s) => s.selection)
  const pending = useAppStore((s) => s.pending)
  const ayahs = useAppStore((s) => s.ayahs)
  const surah = useAppStore((s) => currentSurah(s))
  const mode = useAppStore((s) => s.selectionMode)
  const snap = useAppStore((s) => s.snapToPauses)
  const setMode = useAppStore((s) => s.setSelectionMode)
  const setSnap = useAppStore((s) => s.setSnapToPauses)
  const applyFix = useAppStore((s) => s.applyFix)
  const reciterId = useAppStore((s) => s.reciterId)
  const description = useCompose((s) => s.description)
  const wordCount = useCompose((s) => s.wordCount)
  const warnings = useCompose((s) => s.warnings)
  const played = useCompose((s) => s.playedSelection)
  const audio = useCompose((s) => s.audio)

  const reciter = findReciter(reciterId)
  const widened = !!played && !!selection && !pending && !sameSelection(played, selection)
  // a word-timing reciter whose data has no reliable timings for some ayah of this passage (D4)
  const fallback = !pending && audio.status === 'ready' && !!audio.value && hasAyahLevelFallback(audio.value.timeline, reciter)

  const status = !ayahs ? null : pending ? (
    <Text style={[TYPE.body, { color: th.text }]}>{t('tapEnd')}</Text>
  ) : !selection ? (
    <Text style={[TYPE.body, { color: th.text }]}>{t('tapFirst')}</Text>
  ) : (
    <View style={styles.summaryRow}>
      <View style={[styles.goldTick, { backgroundColor: th.gold }]} />
      <Text style={[TYPE.bodyMedium, { color: th.text, flexShrink: 1 }]} testID="selection-description">
        {description}
      </Text>
      <Text style={[TYPE.small, { color: th.textMuted }]}>{count(wordCount, 'word')}</Text>
    </View>
  )
  const note =
    widened && played && ayahs ? (
      <View style={styles.inline}>
        <Icon name="info" size={16} color={th.textMuted} />
        <Text style={[TYPE.caption, { color: th.textMuted, flex: 1 }]}>{t('reciterWidened', { desc: domain.describeSelection(played, surah, ayahs, lang) })}</Text>
      </View>
    ) : reciter && !reciter.wordTimings && selection && !pending ? (
      <Text style={[TYPE.caption, { color: th.textMuted }]}>{t('ayahLevel')}</Text>
    ) : fallback ? (
      <View style={styles.inline} testID="ayah-fallback-note">
        <Icon name="info" size={16} color={th.textMuted} />
        <Text style={[TYPE.caption, { color: th.textMuted, flex: 1 }]}>{t('passageAyahFallback')}</Text>
      </View>
    ) : null
  const warningRows =
    warnings.length > 0 && selection && !pending ? (
      <View
        style={{ gap: SPACE.sm }}
        testID="selection-warnings"
        onLayout={onWarningsLayout ? (e) => onWarningsLayout({ y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }) : undefined}
      >
        {warnings.map((w, i) => (
          <WarningRow key={`${w.kind}-${i}`} warning={w} onFix={applyFix} />
        ))}
      </View>
    ) : null
  const controls = (
    <>
      <View style={styles.optionsRow}>
        <ChipRow label={t('selectionModeLabel')}>
          <Chip label={t('modeWords')} selected={mode === 'words'} onPress={() => setMode('words')} testID="mode-words" />
          <Chip label={t('modeAyahs')} selected={mode === 'ayahs'} onPress={() => setMode('ayahs')} testID="mode-ayahs" />
        </ChipRow>
      </View>
      {mode === 'words' ? <ToggleRow label={t('snapToPauses')} hint={t('snapToPausesHint')} hideHint={compact} value={snap} onChange={setSnap} testID="snap-toggle" /> : null}
    </>
  )

  if (compact)
    return (
      <View style={[styles.wrap, styles.wrapCompact]} testID="selection-status">
        {warningRows}
        {controls}
        {/* one live region, as in the full layout: the selection read out (shown in the step bar), the note shown */}
        <View aria-live="polite" style={note ? null : styles.outOfFlow}>
          <View style={visuallyHidden}>{status}</View>
          {note}
        </View>
      </View>
    )

  return (
    <View style={styles.wrap} testID="selection-status">
      <View aria-live="polite" style={{ gap: SPACE.xs }}>
        {status}
        {note}
      </View>
      {warningRows}
      {controls}
    </View>
  )
}

/** A warning in rubric (alert role), or a quiet hint: no tint, a hairline edge, an info glyph. */
function WarningRow({ warning, onFix }: { warning: SelectionWarning; onFix: (fix: SelectionFix) => void }) {
  const th = useTheme()
  const { t } = useT()
  const copy = warningCopy(warning)
  const info = copy.severity === 'info'
  return (
    <View
      accessibilityRole={info ? undefined : 'alert'}
      style={[styles.warning, info ? { borderStartColor: th.hairline, paddingVertical: SPACE.sm } : { backgroundColor: th.warnTint, borderStartColor: th.warn }]}
      testID={`warning-${warning.kind}`}
    >
      <View style={styles.inline}>
        <Icon name={info ? 'info' : 'alert'} size={18} color={info ? th.textMuted : th.warn} />
        <Text style={[TYPE.small, { color: info ? th.textMuted : th.text, flex: 1 }]}>{t(copy.message, copy.params)}</Text>
      </View>
      {copy.fixes.length > 0 ? (
        <View style={styles.fixes}>
          {copy.fixes.map((f) => (
            <Button
              key={f.fix.kind}
              compact
              variant={info ? 'quiet' : 'secondary'}
              label={t(f.label, f.params)}
              onPress={() => onFix(f.fix)}
              testID={`fix-${f.fix.kind}-${warning.kind}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE.md },
  wrapCompact: { gap: SPACE.sm },
  // a live region with nothing to show takes no room (it still holds the text read out)
  outOfFlow: { position: 'absolute' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  goldTick: { width: 14, height: 8, borderRadius: 3 },
  inline: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  warning: { borderStartWidth: 3, borderRadius: 6, padding: SPACE.md, gap: SPACE.sm },
  fixes: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.md },
})
