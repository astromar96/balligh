// The single screen. Narrow (< 1024): the step flow (components/Stepper.tsx), five screens with the page itself never
// scrolling. Wide: the Mushaf panel on the reading side (first child = right in RTL), then the stage and options;
// from 1200 px the stage gets its own sticky pane so design changes stay in view.
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useEffectEvent, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { decodeQuery, openInitialPassage } from './bootstrap'
import { useComposeEngine } from './compose'
import { AboutSheet } from './components/About'
import { Credits, Header } from './components/Chrome'
import { ContentSection } from './components/Content'
import { DesignSection } from './components/Design'
import { ExportSheet } from './components/ExportSheet'
import { MushafPanel } from './components/MushafPanel'
import { PassageBar } from './components/PassageBar'
import { Button, Hairline } from './components/primitives'
import { ReciterPicker, ReciterSection } from './components/Reciters'
import { SelectionStatus } from './components/SelectionStatus'
import { Stage } from './components/Stage'
import { StepFlow } from './components/Stepper'
import { SurahPicker } from './components/SurahPicker'
import { useT } from './hooks'
import { uiPlatform } from './platform'
import { createStepNavigator, type StepNavigator } from './stepNav'
import { landingStep } from './stepper'
import { useTheme, useWindowSizeSafe } from './theme'
import { SPACE, WIDE_BREAKPOINT } from './tokens'

type SheetName = 'surah' | 'reciter' | 'export' | 'about' | null

/** Rebuilds a query string from expo-router params (native deep links); the web reads location.search. */
function queryFromParams(params: Record<string, string | string[] | undefined>): string | null {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') q.append(k, v)
    else if (Array.isArray(v)) v.forEach((x) => q.append(k, x))
  }
  const s = q.toString()
  return s.length > 0 ? s : null
}

let booted = false

/**
 * Once per app start: the opening passage (bootstrap.ts) — a deep link when the URL holds one, else Al-Fatiha. A deep
 * link opens the step flow on the preview once its passage has loaded (the first render is always the verses).
 */
function useBootstrap(nav: StepNavigator) {
  const params = useLocalSearchParams()
  // reads the route params of the first render only; later param changes are in-app navigation, not a new start
  const boot = useEffectEvent(() => {
    const decoded = decodeQuery(uiPlatform.initialQuery() ?? queryFromParams(params as Record<string, string | string[] | undefined>))
    openInitialPassage(decoded)
    nav.expectLanding(landingStep(!!decoded))
  })
  useEffect(() => {
    if (booted) return
    booted = true
    boot()
  }, [])
}

export function BallighApp() {
  useComposeEngine()
  // the step flow's state lives here, so it survives switching between the narrow and the wide layout
  const [nav] = useState(createStepNavigator)
  useBootstrap(nav)
  const th = useTheme()
  const { lang, t } = useT()
  const { width, height } = useWindowSizeSafe()
  const [sheet, setSheet] = useState<SheetName>(null)
  const open = (s: SheetName) => () => setSheet(s)
  const close = () => setSheet(null)

  useEffect(() => {
    uiPlatform.applyDocumentLanguage(lang)
  }, [lang])

  // browser Back/Forward (web) and Android's back button walk the steps
  useEffect(() => nav.connect(), [nav])

  const wide = width >= WIDE_BREAKPOINT
  const threePane = width >= 1200

  const sheets = (
    <>
      <SurahPicker visible={sheet === 'surah'} onClose={close} />
      <ReciterPicker visible={sheet === 'reciter'} onClose={close} />
      <ExportSheet visible={sheet === 'export'} onClose={close} />
      <AboutSheet visible={sheet === 'about'} onClose={close} />
    </>
  )

  const options = (
    <>
      <ReciterSection onOpen={open('reciter')} />
      <Hairline />
      <ContentSection />
      <Hairline />
      <DesignSection />
      <Credits onOpenAbout={open('about')} />
    </>
  )

  if (!wide) {
    return <StepFlow nav={nav} onOpenSurah={open('surah')} onOpenExport={open('export')} onOpenAbout={open('about')} sheets={sheets} />
  }

  const exportButton = <Button variant="primary" icon="share" label={t('exportClip')} onPress={open('export')} testID="export-open" />

  return (
    <View style={[styles.root, { backgroundColor: th.bg }]} {...uiPlatform.rootProps(lang)} testID="app-root">
      <View style={styles.wideFrame}>
        <View style={styles.wideHeader}>
          <Header onOpenAbout={open('about')} />
        </View>
        <View style={styles.wideBody}>
          <View style={styles.readingPane}>
            <PassageBar onOpenPicker={open('surah')} />
            <MushafPanel fill />
            <ScrollView style={{ flexGrow: 0, maxHeight: Math.round(height * 0.34) }} contentContainerStyle={{ paddingBottom: SPACE.sm }}>
              <SelectionStatus />
            </ScrollView>
          </View>
          {threePane ? (
            <>
              <View style={styles.stagePane}>
                {/* the Stage's notes (a tafsir that turns too fast, the platforms' length limits) can make it taller
                    than the window: it then scrolls inside its pane, and the export button stays in view. (A plain
                    overflow box, not a ScrollView: that one's own compositing layer re-draws the Stage's corners.) */}
                <View style={[styles.stageScroll, uiPlatform.webStyle({ overflowY: 'auto' })]}>
                  <Stage maxHeight={Math.round(height - 230)} />
                </View>
                {exportButton}
              </View>
              <ScrollView style={styles.optionsPane} contentContainerStyle={styles.optionsContent}>
                {options}
              </ScrollView>
            </>
          ) : (
            <ScrollView style={styles.stackPane} contentContainerStyle={styles.optionsContent}>
              <Stage maxHeight={Math.round(height * 0.6)} />
              {exportButton}
              <Hairline />
              {options}
            </ScrollView>
          )}
        </View>
      </View>
      {sheets}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  wideFrame: { flex: 1, width: '100%', maxWidth: 1600, alignSelf: 'center', paddingHorizontal: SPACE.xl },
  wideHeader: { paddingTop: SPACE.sm },
  wideBody: { flex: 1, flexDirection: 'row', gap: SPACE.xl, minHeight: 0, paddingBottom: SPACE.lg },
  readingPane: { flex: 1, minWidth: 0, gap: SPACE.md },
  stagePane: { width: 360, gap: SPACE.md },
  stageScroll: { flexShrink: 1, minHeight: 0 },
  optionsPane: { width: 380, flexGrow: 0 },
  stackPane: { width: 420, flexGrow: 0 },
  optionsContent: { gap: SPACE.xl, paddingBottom: SPACE.xxl },
})
