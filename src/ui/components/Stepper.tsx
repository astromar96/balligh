// The narrow layout (< 1024 px): the app as five steps, one screen each (verses → reciter → extras → design →
// preview), under a one-row header and the step indicator, over the step bar (Back · what is selected · Next, or
// «صدّر المقطع» on the last step). The page never scrolls: a long step scrolls inside its own body.
// The verses step stays mounted while hidden, so the Mushaf panel keeps its scroll position and laid-out pages; every
// other step is mounted only while it is shown: one Stage (canvas + animation loop) at a time, and the reciter
// preview stops when its step goes. A step slides in from the side it lies on in the reading direction.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { findReciter, findTafsir, findTranslation, useCompose } from '../compose'
import { useT } from '../hooks'
import { uiPlatform } from '../platform'
import { SheetHistoryContext } from '../sheetHistory'
import { FIRST_VIEW, type StepNavigator, type StepView } from '../stepNav'
import { canOpenStep, nextStep, showsStage, slideOffset, STEP_LABEL, STEP_TITLE, stepIndex, STEPS, type StepKey } from '../stepper'
import { useAppStore } from '../store'
import { useReducedMotion, useTheme, useWindowSizeSafe } from '../theme'
import { FAMILY, RADIUS, SPACE, TYPE } from '../tokens'
import { Credits, Header, STEP_BAR_HINT_ID, StepBar } from './Chrome'
import { ContentSection } from './Content'
import { DesignSection } from './Design'
import { MushafPanel } from './MushafPanel'
import { PassageBar } from './PassageBar'
import { visuallyHidden } from './primitives'
import { ReciterList, useReciterPreview } from './Reciters'
import { SelectionStatus } from './SelectionStatus'
import { Stage } from './Stage'
import { STAGE_CHROME } from './stageLayout'
import { StageNotes } from './StageNotes'

/** how far a step travels as it slides in (px) */
const SLIDE = 28
const SLIDE_MS = 200
/** the chrome around a step (compact header, indicator, bar), for the screens too short to pin things in place */
const CHROME_EST = 160
/** the Mushaf panel's least useful fitted height: its surah cartouche and a line or two of text */
const MUSHAF_MIN = 160
/** below this window height the design step scrolls its preview away with the options instead of pinning it */
const PIN_STAGE_MIN_HEIGHT = 500

/** where the view's counters stood when the flow appeared: only changes after that move focus or reveal warnings */
type Baseline = Pick<StepView, 'focusSeq' | 'revealSeq'>

export function StepFlow({
  nav,
  onOpenSurah,
  onOpenExport,
  onOpenAbout,
  sheets,
}: {
  nav: StepNavigator
  onOpenSurah: () => void
  onOpenExport: () => void
  onOpenAbout: () => void
  /** the app's sheets: inside the flow, so they get their history entries */
  sheets: ReactNode
}) {
  const th = useTheme()
  const { lang } = useT()
  const view = useSyncExternalStore(nav.subscribe, nav.getSnapshot, () => FIRST_VIEW)
  // the navigator outlives the flow (a switch to the wide layout and back): what it counted before is not news
  const [baseline] = useState<Baseline>(() => nav.getSnapshot())
  // the flow appearing on a step without the Stage (e.g. the window narrowed while the wide layout's clip played):
  // nothing goes on playing out of sight, as when such a step is opened
  useEffect(() => {
    if (!showsStage(nav.getSnapshot().step)) useCompose.getState().player?.pause()
  }, [nav])
  const next = () => {
    const step = nextStep(view.step)
    if (step) nav.go(step)
  }
  return (
    <SheetHistoryContext value={nav}>
      <View style={[styles.root, { backgroundColor: th.bg }]} {...uiPlatform.rootProps(lang)} testID="app-root">
        <View style={styles.header}>
          <Header compact onOpenAbout={onOpenAbout} />
        </View>
        <StepIndicator step={view.step} landing={view.landing} onJump={nav.go} />
        <View style={styles.deck}>
          <StepPane step="verses" view={view}>
            <VersesStep view={view} baseline={baseline} onOpenSurah={onOpenSurah} />
          </StepPane>
          {view.step === 'verses' ? null : (
            <StepPane key={view.step} step={view.step} view={view}>
              {view.step === 'reciter' ? (
                <ReciterStep view={view} baseline={baseline} />
              ) : view.step === 'extras' ? (
                <ExtrasStep view={view} baseline={baseline} />
              ) : view.step === 'design' ? (
                <DesignStep view={view} baseline={baseline} />
              ) : (
                <PreviewStep view={view} baseline={baseline} onJump={nav.go} onOpenAbout={onOpenAbout} />
              )}
            </StepPane>
          )}
        </View>
        <StepBar step={view.step} landing={view.landing} onBack={nav.back} onNext={next} onExport={onOpenExport} onReviewWarning={nav.reviewWarnings} />
        {sheets}
      </View>
    </SheetHistoryContext>
  )
}

// ───────────────────────── indicator ─────────────────────────

const CURRENT_STEP = { 'aria-current': 'step' } as object

/**
 * The five steps by their short names. The current one: its number inked in a disc (like a chosen chip), its name
 * in ink over the gold mark. Every open step is a jump; a closed one says why (the bar's line).
 */
function StepIndicator({ step, landing, onJump }: { step: StepKey; landing: boolean; onJump: (step: StepKey) => void }) {
  const th = useTheme()
  const { t, n } = useT()
  const hasSelection = useAppStore((s) => !!s.selection)
  const pending = useAppStore((s) => !!s.pending)
  const why = landing ? t('landingClip') : pending ? t('tapEnd') : t('tapFirst')
  return (
    <View role="navigation" aria-label={t('stepsLabel')} testID="stepper" style={[styles.indicator, { borderBottomColor: th.hairline }]}>
      {STEPS.map((key, i) => {
        const current = key === step
        const open = canOpenStep(key, { hasSelection, pending })
        const color = current ? th.text : open ? th.textMuted : th.textFaint
        return (
          <Pressable
            key={key}
            testID={`stepper-${key}`}
            accessibilityRole="button"
            accessibilityLabel={t('stepOf', { k: i + 1, n: STEPS.length, name: t(STEP_LABEL[key]) })}
            accessibilityHint={open ? undefined : why}
            {...(current ? CURRENT_STEP : {})}
            {...(open ? {} : uiPlatform.describedBy(STEP_BAR_HINT_ID))}
            aria-disabled={!open}
            disabled={!open}
            onPress={() => onJump(key)}
            style={({ pressed }) => [styles.indItem, pressed && !current && { backgroundColor: th.skeleton }]}
          >
            <View style={[styles.indDisc, current && { backgroundColor: th.text }]}>
              <Text style={[styles.indNum, { color: current ? th.bg : color }]}>{n(i + 1)}</Text>
            </View>
            <Text style={[current ? styles.indLabelCurrent : styles.indLabel, { color }]} numberOfLines={1}>
              {t(STEP_LABEL[key])}
            </Text>
            <View style={[styles.indMark, { backgroundColor: current ? th.gold : 'transparent' }]} />
          </Pressable>
        )
      })}
    </View>
  )
}

// ───────────────────────── step frame ─────────────────────────

/**
 * One step's screen. Shown: slides in from the side it lies on (none with reduced motion). Hidden (the verses step
 * only; the others unmount): not drawn, out of the Tab order and the accessibility tree, layout kept.
 */
function StepPane({ step, view, children }: { step: StepKey; view: StepView; children: ReactNode }) {
  const { lang } = useT()
  const reduced = useReducedMotion()
  const active = view.step === step
  const [progress] = useState(() => new Animated.Value(1))
  const offset = slideOffset(active ? view.enter : 0, lang === 'ar', SLIDE)

  const slideIn = useEffectEvent(() => {
    if (offset === 0 || reduced) {
      progress.setValue(1)
      return undefined
    }
    progress.setValue(0)
    const anim = Animated.timing(progress, { toValue: 1, duration: SLIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: uiPlatform.os !== 'web' })
    anim.start()
    return () => anim.stop()
  })
  // before the first paint of the step, so it never shows in place and then jumps to the start of the slide
  useLayoutEffect(() => {
    if (!active) return
    return slideIn()
  }, [active])

  return (
    <Animated.View
      testID={`step-${step}`}
      {...(active ? {} : uiPlatform.hiddenProps)}
      style={[
        StyleSheet.absoluteFill,
        { opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }] },
        active ? null : uiPlatform.hiddenStyle,
      ]}
    >
      {children}
    </Animated.View>
  )
}

/**
 * The step's heading: what to do here, read out with its place in the flow («الخطوة ٢ من ٥: اختر القارئ»). After a
 * step change (not on load, nor when the flow reappears after the wide layout) it takes focus, so a screen reader
 * reads it. `srOnly`: not drawn (the verses step gives its height to the Mushaf), except while it holds keyboard
 * focus, when it floats over the top of the step so the focus can be seen.
 */
function StepHeading({ step, view, baseline, note, srOnly = false }: { step: StepKey; view: StepView; baseline: Baseline; note?: string; srOnly?: boolean }) {
  const th = useTheme()
  const { t } = useT()
  const ref = useRef<ComponentRef<typeof Text>>(null)
  const [shown, setShown] = useState(false)
  const active = view.step === step
  useEffect(() => {
    if (active && view.focusSeq > baseline.focusSeq) uiPlatform.focusElement(ref.current)
  }, [active, view.focusSeq, baseline.focusSeq])
  const title = t(STEP_TITLE[step])
  // (the browser draws the focus ring on the heading itself)
  const boxStyle = !srOnly ? styles.heading : shown ? [styles.headingFloat, { backgroundColor: th.surface, borderColor: th.hairline }] : visuallyHidden
  return (
    <View style={boxStyle}>
      <Text
        ref={ref}
        accessibilityRole="header"
        {...uiPlatform.headingLevel(2)}
        accessibilityLabel={t('stepOf', { k: stepIndex(step) + 1, n: STEPS.length, name: title })}
        {...uiPlatform.focusTargetProps}
        {...(srOnly ? uiPlatform.focusListeners((el) => setShown(uiPlatform.isFocusVisible(el)), () => setShown(false)) : null)}
        style={[TYPE.title, { color: th.text }]}
      >
        {title}
      </Text>
      {note ? <Text style={[TYPE.caption, { color: th.textMuted }]}>{note}</Text> : null}
    </View>
  )
}

// ───────────────────────── steps ─────────────────────────

/**
 * 1 — the surah and range, the Mushaf panel filling the height, and the selection status in its own scrolling band
 * under it: the controls, or first the boundary warnings with their fixes (the band then grows to show them whole,
 * up to a third of the screen). A screen too short for that (a phone on its side) scrolls the step instead, the
 * Mushaf panel keeping most of a screen's height.
 */
function VersesStep({ view, baseline, onOpenSurah }: { view: StepView; baseline: Baseline; onOpenSurah: () => void }) {
  const { width, height } = useWindowSizeSafe()
  const reduced = useReducedMotion()
  const bodyRef = useRef<ComponentRef<typeof ScrollView>>(null)
  const statusRef = useRef<ComponentRef<typeof ScrollView>>(null)
  const bandY = useRef(0)
  const warningsY = useRef(0)
  const [warningsH, setWarningsH] = useState(0)
  const selection = useAppStore((s) => s.selection)
  const pending = useAppStore((s) => s.pending)
  const warnings = useCompose((s) => s.warnings)
  const warned = warnings.length > 0 && !!selection && !pending
  // the PassageBar is one row from 360 px, two below
  const passageH = width < 360 ? 140 : 74
  const statusMax = Math.round(Math.min(150, Math.max(96, height * 0.15)))
  const short = height - CHROME_EST - passageH - statusMax - SPACE.sm * 3 < MUSHAF_MIN
  /** the warnings into view inside the band; `scrollStep`: and the band into view, when the step scrolls (short) */
  const reveal = useEffectEvent((scrollStep: boolean) => {
    statusRef.current?.scrollTo({ y: Math.max(0, warningsY.current - SPACE.xs), animated: !reduced })
    if (scrollStep && short) bodyRef.current?.scrollTo({ y: Math.max(0, bandY.current - SPACE.sm), animated: !reduced })
  })
  useEffect(() => {
    if (view.revealSeq > baseline.revealSeq) reveal(true)
  }, [view.revealSeq, baseline.revealSeq])
  // a new warning comes into view in the band by itself, its fixes with it (the step itself is not scrolled away
  // from the Mushaf under the reader's finger: on a short screen the bar's link does that)
  useEffect(() => {
    if (warned) reveal(false)
  }, [warned, warnings])

  // the band: the controls (≈ 94 px) up to 15% of the screen; with warnings, as tall as they are (to a third of the
  // screen, and never pressing the panel under its 120 px floor). 390×844: the panel gets 55%+ of the height; 360×640: 40%+
  const roomForBand = height - CHROME_EST - passageH - 120 - SPACE.sm * 4
  const bandMax = warned && warningsH > 0 ? Math.max(statusMax, Math.min(warningsH + SPACE.sm, Math.round(height * 0.32), roomForBand)) : statusMax
  return (
    // A ScrollView in both layouts, so turning the phone never remounts the Mushaf panel (its scroll and pages).
    // Fitted (not short), its content is exactly its height, the panel taking what the rest leaves: nothing to scroll.
    // (Not scrollEnabled={false}: on the web that also sets touch-action: none, which would stop pinch-zoom here.)
    <ScrollView ref={bodyRef} style={styles.fill} contentContainerStyle={[styles.versesContent, !short && styles.fitted]} keyboardShouldPersistTaps="handled">
      <StepHeading step="verses" view={view} baseline={baseline} srOnly />
      <PassageBar onOpenPicker={onOpenSurah} />
      <View style={short ? { height: Math.max(200, height - CHROME_EST - SPACE.lg) } : styles.mushaf}>
        <MushafPanel fill />
      </View>
      <ScrollView
        ref={statusRef}
        style={[styles.statusBand, !short && { maxHeight: bandMax }]}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onLayout={(e) => (bandY.current = e.nativeEvent.layout.y)}
        testID="selection-status-band"
      >
        <SelectionStatus
          compact
          onWarningsLayout={(box) => {
            warningsY.current = box.y
            setWarningsH(Math.round(box.height))
          }}
        />
      </ScrollView>
    </ScrollView>
  )
}

/** 2 — the reciters inline, the chosen one in view: choosing only selects; «استمع» stops when the step goes (unmount). */
function ReciterStep({ view, baseline }: { view: StepView; baseline: Baseline }) {
  const setReciter = useAppStore((s) => s.setReciter)
  const preview = useReciterPreview()
  return (
    <View style={styles.fill}>
      <View style={styles.headPad}>
        <StepHeading step="reciter" view={view} baseline={baseline} />
      </View>
      <ReciterList preview={preview} onChoose={setReciter} istiadhaInline revealCurrent style={styles.fill} />
    </View>
  )
}

/** 3 — tafsir, tajweed and translation, all optional. */
function ExtrasStep({ view, baseline }: { view: StepView; baseline: Baseline }) {
  const { t } = useT()
  return (
    <View style={styles.fill}>
      <View style={styles.headPad}>
        <StepHeading step="extras" view={view} baseline={baseline} note={t('stepExtrasNote')} />
      </View>
      <ScrollView style={styles.fill} contentContainerStyle={styles.scrollPad} keyboardShouldPersistTaps="handled">
        <ContentSection hideTitle />
      </ScrollView>
    </View>
  )
}

/**
 * 4 — the live preview pinned on top (38% of the screen, its notes left to the list), the design options scrolling
 * under it behind a hairline once they move. A screen too short to pin it scrolls the preview away with them.
 */
function DesignStep({ view, baseline }: { view: StepView; baseline: Baseline }) {
  const th = useTheme()
  const { width, height } = useWindowSizeSafe()
  const [scrolled, setScrolled] = useState(false)
  const pinned = height >= PIN_STAGE_MIN_HEIGHT
  const stage = (
    <Stage
      compact
      maxHeight={pinned ? Math.max(120, Math.round(height * 0.38) - STAGE_CHROME) : Math.max(160, Math.round(height * 0.6) - STAGE_CHROME)}
      widthHint={width - SPACE.lg * 2}
    />
  )
  return (
    <View style={styles.fill}>
      <View style={styles.headPad}>
        <StepHeading step="design" view={view} baseline={baseline} />
      </View>
      {pinned ? <View style={styles.stagePad}>{stage}</View> : null}
      <View style={[styles.edge, { backgroundColor: pinned && scrolled ? th.hairline : 'transparent' }]} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.scrollPad, { gap: SPACE.lg }]}
        onScroll={pinned ? (e) => setScrolled(e.nativeEvent.contentOffset.y > 0) : undefined}
        scrollEventThrottle={16}
      >
        {pinned ? null : stage}
        <StageNotes />
        <DesignSection hideTitle />
      </ScrollView>
    </View>
  )
}

/** 5 — the clip large with play/scrub, its notes, what was chosen (each row goes back to its step), the credits. */
function PreviewStep({ view, baseline, onJump, onOpenAbout }: { view: StepView; baseline: Baseline; onJump: (step: StepKey) => void; onOpenAbout: () => void }) {
  const { width, height } = useWindowSizeSafe()
  return (
    <View style={styles.fill}>
      <View style={styles.headPad}>
        <StepHeading step="preview" view={view} baseline={baseline} />
      </View>
      <ScrollView style={styles.fill} contentContainerStyle={[styles.scrollPad, { gap: SPACE.lg }]}>
        <Stage compact maxHeight={Math.max(160, Math.round(height * 0.6) - STAGE_CHROME)} widthHint={width - SPACE.lg * 2} />
        <StageNotes />
        <ChoicesSummary onJump={onJump} />
        <Credits onOpenAbout={onOpenAbout} />
      </ScrollView>
    </View>
  )
}

function ChoicesSummary({ onJump }: { onJump: (step: StepKey) => void }) {
  const th = useTheme()
  const { t, lang } = useT()
  const description = useCompose((s) => s.description)
  const reciterId = useAppStore((s) => s.reciterId)
  const istiadha = useAppStore((s) => s.istiadha)
  const tafsirId = useAppStore((s) => s.tafsirId)
  const translationId = useAppStore((s) => s.translationId)
  const tajweed = useAppStore((s) => s.design.showTajweed)
  const arabic = lang === 'ar'
  const reciter = findReciter(reciterId)
  const tafsir = findTafsir(tafsirId)
  const translation = findTranslation(translationId)
  const reciterName = reciter ? (arabic ? reciter.nameAr : reciter.nameEn) : reciterId
  const extras = [tafsir ? (arabic ? tafsir.nameAr : tafsir.nameEn) : null, translation ? `${translation.langName}: ${translation.name}` : null, tajweed ? t('extrasTajweed') : null]
    .filter((x): x is string => !!x)
    .join(arabic ? '، ' : ', ')
  const rows: { step: StepKey; value: string }[] = [
    { step: 'verses', value: description },
    { step: 'reciter', value: istiadha && reciter?.istiadha ? t('reciterWithIstiadha', { name: reciterName }) : reciterName },
    { step: 'extras', value: extras || t('noExtras') },
  ]
  return (
    <View style={[styles.summary, { borderColor: th.hairline, backgroundColor: th.surface }]} testID="step-summary">
      {rows.map((row, i) => (
        <Pressable
          key={row.step}
          testID={`summary-${row.step}`}
          accessibilityRole="button"
          accessibilityLabel={t('summaryChangeLabel', { what: t(STEP_LABEL[row.step]), value: row.value })}
          onPress={() => onJump(row.step)}
          style={({ pressed }) => [styles.summaryRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.hairline }, pressed && { backgroundColor: th.skeleton }]}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[TYPE.caption, { color: th.textMuted }]}>{t(STEP_LABEL[row.step])}</Text>
            <Text style={[TYPE.bodyMedium, { color: th.text }]} numberOfLines={2}>
              {row.value}
            </Text>
          </View>
          <Text style={[TYPE.label, { color: th.link }]}>{t('summaryChange')}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  header: { paddingStart: SPACE.lg, paddingEnd: SPACE.sm },
  indicator: { flexDirection: 'row', paddingHorizontal: SPACE.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  indItem: { flex: 1, minWidth: 0, minHeight: 48, alignItems: 'center', justifyContent: 'flex-end', paddingTop: SPACE.xs, borderRadius: RADIUS.small },
  indDisc: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  indNum: { fontFamily: FAMILY.uiMedium, fontSize: 12, lineHeight: 18 },
  indLabel: { fontFamily: FAMILY.uiMedium, fontSize: 13, lineHeight: 19 },
  indLabelCurrent: { fontFamily: FAMILY.uiSemiBold, fontSize: 13, lineHeight: 19 },
  indMark: { width: 32, height: 4, borderRadius: 2, marginTop: 3 },
  deck: { flex: 1, minHeight: 0 },
  fill: { flex: 1, minHeight: 0 },
  fitted: { height: '100%' },
  versesContent: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, gap: SPACE.sm },
  mushaf: { flex: 1, minHeight: 120 },
  statusBand: { flexGrow: 0, flexShrink: 0 },
  headPad: { paddingHorizontal: SPACE.lg },
  heading: { paddingTop: SPACE.sm, paddingBottom: SPACE.sm, gap: 2 },
  // the verses step's heading while it has keyboard focus: over the top of the step, never moving anything
  headingFloat: { position: 'absolute', top: SPACE.xs, start: SPACE.lg, zIndex: 2, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, borderWidth: 1, borderRadius: RADIUS.small },
  stagePad: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm },
  // the line the options scroll under (drawn once they have moved)
  edge: { height: StyleSheet.hairlineWidth },
  scrollPad: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.xs, paddingBottom: SPACE.xl },
  summary: { borderWidth: 1, borderRadius: RADIUS.control, overflow: 'hidden' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, minHeight: 56 },
})
