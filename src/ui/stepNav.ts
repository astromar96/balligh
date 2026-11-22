// The narrow layout's step flow at run time: which step is shown, and the history entries behind it. The rules live
// in ui/stepper.ts (pure, unit-tested); this applies them to uiPlatform.history (web: window.history) and the stores.
// One per app (BallighApp keeps it across layout switches). React reads it through useSyncExternalStore, so the first
// render (and the static HTML) is always the verses, and nothing touches window or history before connect().
import { useCompose } from './compose'
import { uiPlatform } from './platform'
import type { SheetHistory } from './sheetHistory'
import {
  canOpenStep,
  currentEntry,
  isOwnEntry,
  planBack,
  planPop,
  planSheetClosed,
  pushEntry,
  replaceStep,
  showsStage,
  slideDirection,
  startNav,
  withEntry,
  type Nav,
  type NavEntry,
  type StepGate,
  type StepKey,
} from './stepper'
import { useAppStore } from './store'

export interface StepView {
  step: StepKey
  /** where the step came in from: 1 = the next step's side, -1 = the previous step's side, 0 = no slide */
  enter: -1 | 0 | 1
  /** grows on every step change the user or the browser makes (not on load): the new step's heading takes focus */
  focusSeq: number
  /** grows when the bar's warning link asks the verses step to bring the selection warnings into view */
  revealSeq: number
  /** a shared link is opening: the app moves to its step once the passage has loaded (the bar says so meanwhile) */
  landing: boolean
}

export interface StepNavigator extends SheetHistory {
  subscribe(listener: () => void): () => void
  getSnapshot(): StepView
  /** Next, a jump with the step indicator, a row of the preview's summary: adds a history entry (call it in the tap) */
  go(step: StepKey): void
  /** the on-screen Back: the previous step, never out of the app */
  back(): void
  /** the bar's warning link: the verses step, with the warnings in view */
  reviewWarnings(): void
  /** a shared link opens on `step` once its passage has loaded, unless the user has moved by then */
  expectLanding(step: StepKey): void
  /** listens to the browser's Back/Forward, Android's back button and the selection; returns the cleanup */
  connect(): () => void
}

/** what the first render (and the static HTML) shows */
export const FIRST_VIEW: StepView = { step: 'verses', enter: 0, focusSeq: 0, revealSeq: 0, landing: false }

export function createStepNavigator(): StepNavigator {
  // entry keys: unique per page load, so entries of an earlier load (still in the browser's history) never collide
  const pageId = Math.random().toString(36).slice(2, 10)
  let seq = 0
  const newKey = () => `${pageId}:${++seq}`

  let nav: Nav = startNav(`${pageId}:0`, 'verses')
  let view: StepView = FIRST_VIEW
  /** the sheet that is open (in the narrow layout): its entry, and how to close it */
  let sheet: { key: string; hasEntry: boolean; close: () => void } | null = null
  let landing: StepKey | null = null
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  /** the step a shared link waits for, or null; the view's `landing` follows it */
  const setLanding = (step: StepKey | null) => {
    landing = step
    if (view.landing === (step !== null)) return
    view = { ...view, landing: step !== null }
    notify()
  }

  const gate = (): StepGate => {
    const s = useAppStore.getState()
    return { hasSelection: !!s.selection, pending: !!s.pending }
  }

  /** shows `step`; `focus` moves focus to its heading (any change the user or the browser makes) */
  const show = (step: StepKey, enter: -1 | 0 | 1, focus: boolean) => {
    if (step === view.step) return
    // the Stage leaves with its step: nothing keeps playing out of sight (the next step's Stage starts paused)
    if (showsStage(view.step)) useCompose.getState().player?.pause()
    view = { ...view, step, enter, focusSeq: focus ? view.focusSeq + 1 : view.focusSeq }
    notify()
  }

  const write = (kind: 'push' | 'replace', entry: NavEntry): boolean => {
    const state = withEntry(uiPlatform.history.state(), entry)
    if (kind === 'push') return uiPlatform.history.push(state)
    uiPlatform.history.replace(state)
    return true
  }

  const tryLanding = () => {
    if (!landing) return
    const s = useAppStore.getState()
    if (s.ayahsStatus === 'error') {
      setLanding(null) // the verses step shows the error and its retry
      return
    }
    if (s.ayahsStatus !== 'ready' || !canOpenStep(landing, gate())) return
    const step = landing
    setLanding(null)
    if (nav.current !== nav.base || view.step !== 'verses' || sheet) return // the user has moved first
    nav = replaceStep(nav, step).nav // the page's first entry: the router's own, no marker needed
    show(step, 0, false)
  }

  const onPop = (state: unknown) => {
    const plan = planPop(nav, state, sheet && { key: sheet.key, hasEntry: sheet.hasEntry }, gate())
    nav = plan.nav
    setLanding(null)
    if (plan.closeSheet && sheet) {
      const closing = sheet
      sheet = null
      closing.close()
    }
    if (plan.skipBack) {
      // the entry of a sheet that is closed: nothing to show here, the popstate of the entry below decides
      uiPlatform.history.back()
      return
    }
    // a step the selection does not open (Forward while the end is pending): the verses, and the entry says so
    if (plan.replace) write('replace', plan.replace)
    show(plan.step, slideDirection(view.step, plan.step), true)
  }

  const onStore = () => {
    tryLanding()
    // a later step without a finished selection (should not happen: only the verses step changes it)
    if (view.step !== 'verses' && !canOpenStep(view.step, gate())) {
      const r = replaceStep(nav, 'verses')
      nav = r.nav
      write('replace', r.entry)
      show('verses', -1, false)
    }
  }

  const go = (step: StepKey) => {
    if (step === view.step || sheet || !canOpenStep(step, gate())) return
    const from = view.step
    const pushed = pushEntry(nav, newKey(), step)
    if (write('push', pushed.entry)) nav = pushed.nav
    else {
      // no entry could be added (no user gesture): show the step in place
      const r = replaceStep(nav, step)
      nav = r.nav
      write('replace', r.entry)
    }
    setLanding(null)
    show(step, slideDirection(from, step), true)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getSnapshot: () => view,

    go,

    back() {
      if (sheet) return
      const plan = planBack(nav)
      if (!plan) return
      nav = plan.nav
      if (plan.kind === 'history') uiPlatform.history.back()
      else write('replace', plan.entry)
      setLanding(null)
      // shown now; the popstate that follows a browser Back lands on this same step and changes nothing
      show(plan.step, -1, true)
    },

    reviewWarnings() {
      go('verses')
      if (view.step !== 'verses') return
      view = { ...view, revealSeq: view.revealSeq + 1 }
      notify()
    },

    expectLanding(step) {
      setLanding(step === 'verses' ? null : step)
      tryLanding()
    },

    connect() {
      // entries with our marker (of this page load or an earlier one) are moves inside this one screen
      const offPop = uiPlatform.history.onPop(onPop, isOwnEntry)
      const offBack = uiPlatform.onHardwareBack(() => {
        // a sheet is a Modal: Android gives it the press (onRequestClose), not BackHandler
        if (currentEntry(nav).prev === null) return false // the app's first entry: leave the app
        return uiPlatform.history.back()
      })
      const offStore = useAppStore.subscribe(onStore)
      tryLanding()
      return () => {
        offPop()
        offBack()
        offStore()
      }
    },

    opened(close) {
      const key = newKey()
      const pushed = pushEntry(nav, key, currentEntry(nav).step, true)
      const hasEntry = write('push', pushed.entry)
      if (hasEntry) nav = pushed.nav
      sheet = { key, hasEntry, close }
      return key
    },

    closed(token) {
      if (sheet?.key === token) sheet = null
      const plan = planSheetClosed(nav, token)
      if (!plan.goBack) return
      nav = plan.nav
      uiPlatform.history.back()
    },
  }
}
