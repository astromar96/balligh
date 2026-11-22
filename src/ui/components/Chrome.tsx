// App chrome: the header (name + hadith + sources + language), the step flow's bottom bar (narrow screens) and the
// credits footer. Quiet by design — the Mushaf panel and the stage are the heroes.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useCompose } from '../compose'
import { formatClock } from '../format'
import { useT } from '../hooks'
import { uiPlatform } from '../platform'
import { nextStep, prevStep, STEP_LABEL, type StepKey } from '../stepper'
import { useAppStore } from '../store'
import { useTheme, useWindowSizeSafe } from '../theme'
import { FAMILY, SPACE, TOUCH, TYPE } from '../tokens'
import { primaryWarning, warningCopy } from '../warnings'
import { Icon } from './Icon'
import { Button, IconButton } from './primitives'

/** narrowest window (px) where the compact header has room for the hadith on one line, whole */
const HADITH_MIN_WIDTH = { ar: 340, en: 500 } as const

export function Header({ onOpenAbout, compact = false }: { onOpenAbout: () => void; compact?: boolean }) {
  const th = useTheme()
  const { t, lang } = useT()
  const setLanguage = useAppStore((s) => s.setLanguage)
  const { width } = useWindowSizeSafe()
  // the step flow's header is one row (at most 52 px): the hadith keeps to one line, and gives way where that line
  // would not fit whole beside the name and the actions (the English quotation is about twice as long)
  const hadith = !compact || width >= HADITH_MIN_WIDTH[lang]
  return (
    // a plain row: the name is the page's heading, the buttons beside it are not part of it
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.brandRow}>
        <Text style={[compact ? styles.brandCompact : styles.brand, { color: th.text }]} accessibilityRole="header">
          {t('appName')}
        </Text>
        {hadith ? (
          <>
            <View style={[styles.brandRule, compact && styles.brandRuleCompact, { backgroundColor: th.gold }]} />
            <Text style={[TYPE.small, { color: th.textMuted, flexShrink: 1 }]} numberOfLines={compact ? 1 : undefined}>
              {lang === 'ar' ? `«${t('hadith')}»` : `“${t('hadith')}”`}
            </Text>
          </>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        <IconButton icon="info" label={t('about')} onPress={onOpenAbout} color={th.link} testID="about-open" />
        <Pressable
          testID="language-toggle"
          accessibilityRole="button"
          accessibilityLabel={t('switchLanguageLabel')}
          onPress={() => setLanguage(lang === 'ar' ? 'en' : 'ar')}
          style={({ pressed }) => [styles.lang, pressed && { backgroundColor: th.primaryTint }]}
        >
          <Text style={[TYPE.label, { color: th.link }]}>{t('switchLanguage')}</Text>
        </Pressable>
      </View>
    </View>
  )
}

/**
 * The step flow's bottom bar (narrow screens): Back (not on the first step), what is selected (its length, or the
 * boundary warning with a link to it), and the primary action: Next, or «صدّر المقطع» on the last step.
 */
export function StepBar({
  step,
  landing,
  onBack,
  onNext,
  onExport,
  onReviewWarning,
}: {
  step: StepKey
  /** a shared link is opening: say so instead of asking for a first word */
  landing: boolean
  onBack: () => void
  onNext: () => void
  onExport: () => void
  onReviewWarning: () => void
}) {
  const th = useTheme()
  const { t, lang } = useT()
  const { width } = useWindowSizeSafe()
  const description = useCompose((s) => s.description)
  const audio = useCompose((s) => s.audio)
  const warnings = useCompose((s) => s.warnings)
  const selection = useAppStore((s) => s.selection)
  const pending = useAppStore((s) => s.pending)
  const exact = audio.status === 'ready' && audio.value ? audio.value.timeline.durationMs : null
  const estimate = exact === null && audio.status === 'loading' ? audio.estimateMs : null
  const ready = !!selection && !pending
  const warning = ready ? primaryWarning(warnings) : null
  const short = warning ? t(warningCopy(warning).short) : ''
  const rtl = lang === 'ar'
  const prev = prevStep(step)
  const next = nextStep(step)
  // why Next (and the steps after the verses) cannot be used yet: read with them, and shown here
  const hint = ready ? null : landing ? t('landingClip') : pending ? t('tapEnd') : t('tapFirst')
  const describe = ready ? {} : { describedBy: STEP_BAR_HINT_ID, hint: hint ?? undefined }

  const summary = (
    <>
      {hint === null ? (
        <Text style={[TYPE.label, { color: th.text }]} numberOfLines={1}>
          {description}
        </Text>
      ) : (
        <Text style={[TYPE.caption, { color: th.text }]} numberOfLines={2} nativeID={STEP_BAR_HINT_ID}>
          {hint}
        </Text>
      )}
      {warning ? (
        <View style={styles.barWarning}>
          <Icon name="alert" size={14} color={th.warn} />
          <Text style={[TYPE.caption, { color: th.warn, flexShrink: 1 }]} numberOfLines={1}>
            {short}
          </Text>
          <Text style={[TYPE.caption, { color: th.link, textDecorationLine: 'underline' }]}>{t('reviewWarning')}</Text>
        </View>
      ) : !ready ? null : exact !== null ? (
        <Text style={[TYPE.caption, { color: th.textMuted }]}>{t('durationLabel', { time: formatClock(exact, rtl) })}</Text>
      ) : estimate !== null ? (
        <Text style={[TYPE.caption, { color: th.textMuted }]}>{t('durationAbout', { time: formatClock(estimate, rtl) })}</Text>
      ) : null}
    </>
  )

  return (
    <View
      style={[styles.bar, { backgroundColor: th.surface, borderTopColor: th.hairline }, uiPlatform.webStyle({ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' })]}
      testID="bottom-bar"
    >
      {prev ? (
        <IconButton icon="chevronStart" rtl={rtl} label={t('backStepLabel', { name: t(STEP_LABEL[prev]) })} onPress={onBack} testID="step-back" />
      ) : null}
      {warning ? (
        // the whole summary is the way to the warning and its fixes (a full-height target; hitSlop does nothing on the web)
        <Pressable
          testID="bar-warning"
          accessibilityRole="button"
          accessibilityLabel={`${description}. ${t('reviewWarningLabel', { what: short })}`}
          onPress={onReviewWarning}
          style={({ pressed }) => [styles.barSummary, styles.barSummaryPress, pressed && { backgroundColor: th.skeleton }]}
        >
          {summary}
        </Pressable>
      ) : (
        <View style={styles.barSummary}>{summary}</View>
      )}
      {next ? (
        <Button
          variant="primary"
          label={t('next')}
          iconEnd="chevronEnd"
          rtl={rtl}
          accessibilityLabel={t('nextStepLabel', { name: t(STEP_LABEL[next]) })}
          onPress={onNext}
          disabled={!ready}
          {...describe}
          testID="step-next"
          style={styles.barAction}
        />
      ) : (
        <Button
          variant="primary"
          icon="share"
          // the narrowest phones: a shorter word where the full one would crowd out the passage's name
          label={t(width < 360 ? 'exportClipNarrow' : 'exportClip')}
          accessibilityLabel={t('exportClip')}
          onPress={onExport}
          disabled={!ready}
          {...describe}
          testID="export-open"
          style={styles.barAction}
        />
      )}
    </View>
  )
}

/** the bar's line that says why Next is not open yet (aria-describedby of Next and of the closed steps) */
export const STEP_BAR_HINT_ID = 'step-bar-hint'

export function Credits({ onOpenAbout }: { onOpenAbout: () => void }) {
  const th = useTheme()
  const { t, lang } = useT()
  const text =
    lang === 'ar'
      ? 'النص والتفاسير والترجمات والتلاوات من Quran.com (Quran Foundation) وEveryAyah وQuranEnc وغيرها، ويُذكر المصدر في كل مقطع. كل مقطع يُصنع على جهازك ولا يُرفع شيء.'
      : 'Text, tafsir, translations and recitations come from Quran.com (Quran Foundation), EveryAyah, QuranEnc and others, credited in every clip. Every clip is made on your device; nothing is uploaded.'
  return (
    <View style={styles.credits}>
      <Text style={[TYPE.caption, { color: th.textFaint }]}>{text}</Text>
      <Pressable accessibilityRole="button" onPress={onOpenAbout} style={styles.creditsLink} testID="about-open-footer">
        <Icon name="book" size={16} color={th.link} />
        <Text style={[TYPE.label, { color: th.link }]}>{t('about')}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, paddingVertical: SPACE.sm },
  headerCompact: { paddingVertical: SPACE.xxs, gap: SPACE.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, flexShrink: 1 },
  brand: { fontFamily: FAMILY.displaySemiBold, fontSize: 34, lineHeight: 46 },
  brandCompact: { fontFamily: FAMILY.displaySemiBold, fontSize: 26, lineHeight: 36 },
  brandRule: { width: 1.5, height: 26, opacity: 0.8 },
  brandRuleCompact: { height: 18 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xxs },
  lang: { minHeight: TOUCH, paddingHorizontal: SPACE.md, justifyContent: 'center', borderRadius: 8 },
  barWarning: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  barSummary: { flex: 1, minWidth: 0 },
  barSummaryPress: { minHeight: TOUCH, justifyContent: 'center', borderRadius: 6 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm + 2,
    paddingBottom: SPACE.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barAction: { paddingHorizontal: SPACE.md },
  credits: { paddingVertical: SPACE.lg, gap: SPACE.sm },
  creditsLink: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, alignSelf: 'flex-start', minHeight: TOUCH },
})
