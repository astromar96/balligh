import { useSyncExternalStore } from 'react'
import { AccessibilityInfo, Appearance, Dimensions } from 'react-native'
import { DARK, LIGHT, WIDE_BREAKPOINT, type Theme } from './tokens'

type Scheme = 'light' | 'dark'

function subscribeScheme(onChange: () => void): () => void {
  const sub = Appearance.addChangeListener(onChange)
  return () => sub.remove()
}

const clientScheme = (): Scheme => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light')
const serverScheme = (): Scheme => 'light'

/**
 * The OS colour scheme, safe to hydrate. react-native-web's useColorScheme seeds its state with the browser's
 * value, so a statically rendered page (always 'light' on the server) hydrated with dark styles that React never
 * applied: in dark mode the panels stayed light while the text turned light — the Quran text was barely visible.
 * useSyncExternalStore renders the server value while hydrating, then re-renders with the real scheme.
 */
export function useColorSchemeSafe(): Scheme {
  return useSyncExternalStore(subscribeScheme, clientScheme, serverScheme)
}

export function useTheme(): Theme {
  return useColorSchemeSafe() === 'dark' ? DARK : LIGHT
}

export interface WindowSize {
  width: number
  height: number
}

/** The static HTML is laid out for a phone: the size every render uses on the server and while hydrating. */
const SERVER_SIZE: WindowSize = { width: 390, height: 844 }
let lastSize: WindowSize = SERVER_SIZE

function subscribeSize(onChange: () => void): () => void {
  const sub = Dimensions.addEventListener('change', onChange)
  return () => sub?.remove()
}

function clientSize(): WindowSize {
  const { width, height } = Dimensions.get('window')
  // useSyncExternalStore needs the same object while nothing changed
  if (width !== lastSize.width || height !== lastSize.height) lastSize = { width, height }
  return lastSize
}

/**
 * The window size, safe to hydrate (same reason as useColorSchemeSafe): useWindowDimensions seeds its state with
 * the real size, so a desktop browser hydrated the phone-sized static HTML with the wide layout and React threw
 * away the server HTML (React error #418) on every load.
 */
export function useWindowSizeSafe(): WindowSize {
  return useSyncExternalStore(subscribeSize, clientSize, () => SERVER_SIZE)
}

/** true on screens ≥ 1024 px wide: two columns, Mushaf panel on the reading side. */
export function useIsWide(): boolean {
  return useWindowSizeSafe().width >= WIDE_BREAKPOINT
}

// The OS "reduce motion" setting, asked once and shared: a component that mounts later (a step of the narrow flow,
// a sheet's progress bar) knows it from its first frame instead of animating until its own answer comes back.
let reducedMotion = false
let reducedAsked = false
const reducedListeners = new Set<() => void>()

function setReducedMotion(value: boolean) {
  if (value === reducedMotion) return
  reducedMotion = value
  reducedListeners.forEach((l) => l())
}

function subscribeReducedMotion(onChange: () => void): () => void {
  reducedListeners.add(onChange)
  if (!reducedAsked) {
    reducedAsked = true
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion, () => {})
    AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => setReducedMotion(v))
  }
  return () => {
    reducedListeners.delete(onChange)
  }
}

/** Follows the OS "reduce motion" setting (web: prefers-reduced-motion). false while hydrating (the static HTML). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => reducedMotion, () => false)
}
