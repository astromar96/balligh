// UI platform adapter — native (default; also what TypeScript and Vitest resolve).
// Metro picks platform.web.ts on the web. Both export the same `uiPlatform` shape.
// Native RTL is forced by the expo-localization plugin (app.json), so no per-view direction is needed.
import * as Linking from 'expo-linking'
import { AccessibilityInfo, BackHandler } from 'react-native'
import type { Language } from './i18n'

/** Extra props spread onto a View/Text: DOM attributes on the web, nothing on native. */
export type PassThroughProps = { readonly [key: string]: unknown }

/**
 * The session history the narrow-screen step flow lives in (ui/stepper.ts). Web: window.history, same URL, the
 * caller keeps Expo Router's own state in every entry. Native: an in-memory stack, so Android's back button walks
 * the same entries.
 */
export interface StepHistory {
  /** the current entry's state */
  state(): unknown
  /** adds an entry with this state (same URL); false when none was added (web: no user gesture to back it) */
  push(state: unknown): boolean
  /** changes the current entry's state (same URL) */
  replace(state: unknown): void
  /** goes back one entry; false when there is none to go back to (native) */
  back(): boolean
  /**
   * the history moved to another entry (web: popstate); called with that entry's state. `isOwn` tells the step
   * flow's entries (web: a move onto one at the same URL is kept from Expo Router, which has nothing to restore)
   */
  onPop(listener: (state: unknown) => void, isOwn?: (state: unknown) => boolean): () => void
}

export interface UiPlatform {
  readonly os: 'web' | 'native'
  /** writing direction + language for the app root (web: dir/lang attributes) */
  rootProps(lang: Language): PassThroughProps
  /** Quran text is always right-to-left, whatever the UI language */
  quranProps: PassThroughProps
  /** a block that must stay left-to-right (media scrubber, Latin file names) */
  ltrProps: PassThroughProps
  /** an explicit direction for one block of text (e.g. a translation in a RTL or LTR language) */
  dirProps(dir: 'rtl' | 'ltr'): PassThroughProps
  /** style that keeps a box left-to-right on native (the web uses ltrProps; RNW rejects `direction`) */
  ltrStyle: object
  /**
   * The gold selection band behind words. Web: a highlighter stripe over the letter bodies only (Amiri
   * Quran's tall content box would otherwise overlap the neighbouring lines); native: a plain fill.
   */
  bandStyle(color: string): object
  /**
   * UI text that may quote Quranic words (tajweed explanations, tafsir): Readex Pro lacks marks such as
   * U+06E1, so the web adds Amiri Quran as a per-cluster fallback; native returns the family unchanged.
   */
  withQuranFallback(family: string): string
  /**
   * `preferred` (a family loaded at run time, e.g. a translation's Noto font), falling back to `fallback` while it
   * loads (web: a CSS font stack); native uses `fallback` until it can register run-time fonts.
   */
  fontStack(preferred: string, fallback: string): string
  /** web-only style keys (transitions, cursor, env()); {} on native */
  webStyle(style: Record<string, string | number>): object
  /**
   * Space presses a Pressable whose role is not "button" — a switch or a radio (WAI-ARIA: Space toggles a switch
   * and checks a radio). react-native-web maps Space to a press for role="button" only and lets the page scroll
   * instead; Enter already works for every role. Web: an onKeyDown handler; native: nothing. Omit it when disabled.
   */
  spaceToPress(onPress: () => void): PassThroughProps
  /** the page's own URL without query (deep links are built on it) */
  appBaseUrl(): string
  /** the query string the app was opened with (no leading "?"), or null */
  initialQuery(): string | null
  /** keeps <html lang dir> in step with the UI language (web) */
  applyDocumentLanguage(lang: Language): void
  /** a Text that opens an external page: an <a target=_blank> on the web, Linking.openURL on native */
  linkProps(url: string): PassThroughProps
  /** releases an object URL from an earlier photo pick (web) */
  releaseObjectUrl(url: string): void
  /** an object URL for an exported file, to show it in an <Image> (web); null where unsupported */
  objectUrl(blob: Blob): string | null
  /**
   * Where a rendered element (by testID) sits inside a scroll container, in the container's content
   * coordinates, with the container's scroll position and height (web). null when it is not rendered,
   * and always on native (the Mushaf panel then scrolls by page).
   */
  boxWithin(scrollNode: unknown, testId: string): ScrollBox | null
  /** the step flow's history (see StepHistory) */
  history: StepHistory
  /** Android's back button: `handler` returns true when it handled the press (native); never called on the web */
  onHardwareBack(handler: () => boolean): () => void
  /** a mounted step that is not shown: out of the Tab order and the accessibility tree (web: inert + aria-hidden) */
  hiddenProps: PassThroughProps
  /** hides a mounted step but keeps its layout, so its scroll positions survive (web: visibility) */
  hiddenStyle: object
  /** lets a heading take focus from script without joining the Tab order (web: tabindex -1) */
  focusTargetProps: PassThroughProps
  /** moves keyboard and screen-reader focus to an element (a step's heading after a step change) */
  focusElement(node: unknown): void
  /** the element has focus that the browser would draw a ring for (web :focus-visible: keyboard, not touch) */
  isFocusVisible(node: unknown): boolean
  /** focus and blur listeners for a Text that takes focus (web; RN's Text has none); onFocus gets the element */
  focusListeners(onFocus: (element: unknown) => void, onBlur: () => void): PassThroughProps
  /** web: aria-describedby, the id (nativeID) of a text that says more; native: nothing (use accessibilityHint) */
  describedBy(id: string): PassThroughProps
  /** web: aria-level for a heading (h1…h6); native: nothing */
  headingLevel(level: number): PassThroughProps
}

export interface ScrollBox {
  top: number
  bottom: number
  scrollTop: number
  height: number
}

// native history: entries the app added, newest last; index 0 is the app's start
const nativeStack: unknown[] = [null]
let nativeIndex = 0
const popListeners = new Set<(state: unknown) => void>()

export const uiPlatform: UiPlatform = {
  os: 'native',
  rootProps: () => ({}),
  quranProps: {},
  ltrProps: {},
  dirProps: () => ({}),
  ltrStyle: { direction: 'ltr' },
  bandStyle: (color) => ({ backgroundColor: color }),
  withQuranFallback: (family) => family,
  fontStack: (_preferred, fallback) => fallback,
  webStyle: () => ({}),
  spaceToPress: () => ({}),
  appBaseUrl: () => Linking.createURL('/'),
  initialQuery: () => null,
  applyDocumentLanguage: () => {},
  linkProps: (url) => ({
    accessibilityRole: 'link',
    onPress: () => {
      Linking.openURL(url).catch(() => {})
    },
  }),
  releaseObjectUrl: () => {},
  objectUrl: () => null,
  boxWithin: () => null,
  history: {
    state: () => nativeStack[nativeIndex] ?? null,
    push: (state) => {
      nativeStack.length = nativeIndex + 1
      nativeStack.push(state)
      nativeIndex += 1
      return true
    },
    replace: (state) => {
      nativeStack[nativeIndex] = state
    },
    back: () => {
      if (nativeIndex === 0) return false
      nativeIndex -= 1
      const state = nativeStack[nativeIndex]
      // like popstate: after the call that asked for it has returned
      setTimeout(() => popListeners.forEach((listener) => listener(state)), 0)
      return true
    },
    onPop: (listener) => {
      popListeners.add(listener)
      return () => {
        popListeners.delete(listener)
      }
    },
  },
  onHardwareBack: (handler) => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => handler())
    return () => sub.remove()
  },
  hiddenProps: { importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true },
  hiddenStyle: { opacity: 0, pointerEvents: 'none' },
  focusTargetProps: {},
  focusElement: (node) => {
    if (!node) return
    try {
      AccessibilityInfo.sendAccessibilityEvent(node as Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0], 'focus')
    } catch {
      // not a host view
    }
  },
  isFocusVisible: () => false,
  focusListeners: () => ({}),
  describedBy: () => ({}),
  headingLevel: () => ({}),
}
