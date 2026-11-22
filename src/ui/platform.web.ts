// UI platform adapter — web. Same shape as platform.ts.
// react-native-web resolves logical styles (marginStart, start/end…) from the nearest `dir`, and its
// default context is LTR whatever <html dir> says — so the app root carries dir/lang explicitly.
import type { UiPlatform } from './platform'

export type { PassThroughProps, ScrollBox, UiPlatform } from './platform'

/** Expo Router's entry id in a history.state ({ id }), or null */
function routerEntryId(state: unknown): string | null {
  const id = state && typeof state === 'object' ? (state as { id?: unknown }).id : undefined
  return typeof id === 'string' ? id : null
}

/**
 * The router entry the browser is on (id and URL), as last seen by the step flow. Its entries are copies of the
 * router's current entry (same id, same URL), so a popstate between two of them is a move inside one router entry.
 */
let routerEntry: { id: string; href: string } | null = null
const routerEntryAt = (state: unknown) => {
  const id = routerEntryId(state)
  return id === null ? null : { id, href: window.location.href }
}
/** the URL of the entry the browser was on before a popstate (the screen Expo Router shows) */
let shownHref: string | null = null

export const uiPlatform: UiPlatform = {
  os: 'web',
  rootProps: (lang) => ({ dir: lang === 'ar' ? 'rtl' : 'ltr', lang }),
  quranProps: { dir: 'rtl', lang: 'ar' },
  ltrProps: { dir: 'ltr' },
  dirProps: (dir) => ({ dir }),
  ltrStyle: {},
  // Amiri Quran's content box is 1.815em above / 0.634em below the baseline (hhea); the stripe covers
  // ~0.8em above to ~0.35em below the baseline — the letter bodies — and leaves the marks clear.
  bandStyle: (color) => ({
    backgroundImage: `linear-gradient(to bottom, transparent 41%, ${color} 41%, ${color} 89%, transparent 89%)`,
  }),
  withQuranFallback: (family) => `${family}, AmiriQuran`,
  fontStack: (preferred, fallback) => `"${preferred.replace(/"/g, '')}", ${fallback}`,
  webStyle: (style) => style,
  spaceToPress: (onPress) => ({
    onKeyDown: (e: { key?: string; repeat?: boolean; preventDefault?: () => void }) => {
      if (e.key !== ' ' && e.key !== 'Spacebar') return
      e.preventDefault?.() // no page scroll
      if (!e.repeat) onPress()
    },
  }),
  appBaseUrl: () => {
    if (typeof window === 'undefined') return ''
    return window.location.origin + window.location.pathname
  },
  initialQuery: () => {
    if (typeof window === 'undefined') return null
    const q = window.location.search.replace(/^\?/, '')
    return q.length > 0 ? q : null
  },
  applyDocumentLanguage: (lang) => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  },
  linkProps: (url) => ({ href: url, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } }),
  objectUrl: (blob) => {
    try {
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  },
  boxWithin: (scrollNode, testId) => {
    if (typeof HTMLElement === 'undefined' || !(scrollNode instanceof HTMLElement)) return null
    const el = scrollNode.querySelector(`[data-testid="${testId.replace(/"/g, '')}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const n = scrollNode.getBoundingClientRect()
    const top = r.top - n.top + scrollNode.scrollTop
    return { top, bottom: top + r.height, scrollTop: scrollNode.scrollTop, height: scrollNode.clientHeight }
  },
  releaseObjectUrl: (url) => {
    if (url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // already released
      }
    }
  },
  // The step flow's entries: same URL (no url argument), the caller keeps Expo Router's own state ({ id }) in each.
  history: {
    state: () => (typeof window === 'undefined' ? null : window.history.state),
    push: (state) => {
      if (typeof window === 'undefined') return false
      // Chrome's history intervention lets Back skip entries a page adds without a user gesture: add none then
      const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
      if (activation && !activation.isActive) return false
      try {
        window.history.pushState(state, '')
        routerEntry = routerEntryAt(state)
        shownHref = window.location.href
        return true
      } catch {
        return false
      }
    },
    replace: (state) => {
      if (typeof window === 'undefined') return
      try {
        window.history.replaceState(state, '')
      } catch {
        // a state the browser cannot store: the entry keeps the one it had
      }
    },
    back: () => {
      if (typeof window === 'undefined') return false
      window.history.back()
      return true
    },
    onPop: (listener, isOwn) => {
      if (typeof window === 'undefined') return () => {}
      shownHref = window.location.href
      // Capture: at the window, capturing listeners run before Expo Router's own popstate listener. A move onto one
      // of the step flow's entries at the URL already shown, or between copies of one router entry, has nothing for
      // the router to restore (it would only reset its navigation state to the same snapshot), so the router does not
      // see it. That includes the step flow's entries of an earlier page load (after a reload): the router would
      // start tracking such an entry afresh and rewrite its state to { id }, dropping the step it holds. Any other
      // popstate (another URL, an entry the router made) reaches the router as usual.
      const onPop = (e: PopStateEvent) => {
        const href = window.location.href
        const at = routerEntryAt(e.state)
        const sameRouterEntry = !!at && !!routerEntry && at.id === routerEntry.id && at.href === routerEntry.href
        const ownAtShownUrl = !!isOwn?.(e.state) && href === shownHref
        if (sameRouterEntry || ownAtShownUrl) e.stopImmediatePropagation()
        routerEntry = at
        shownHref = href
        listener(e.state)
      }
      window.addEventListener('popstate', onPop, { capture: true })
      return () => window.removeEventListener('popstate', onPop, { capture: true })
    },
  },
  onHardwareBack: () => () => {},
  hiddenProps: { inert: true, 'aria-hidden': true },
  hiddenStyle: { visibility: 'hidden', pointerEvents: 'none' },
  focusTargetProps: { tabIndex: -1 },
  focusElement: (node) => {
    if (typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return
    node.focus({ preventScroll: true })
  },
  isFocusVisible: (node) => {
    if (typeof Element === 'undefined' || !(node instanceof Element)) return false
    try {
      return node.matches(':focus-visible')
    } catch {
      return false
    }
  },
  focusListeners: (onFocus, onBlur) => ({
    onFocus: (e: { target?: unknown; nativeEvent?: { target?: unknown } }) => onFocus(e?.nativeEvent?.target ?? e?.target ?? null),
    onBlur,
  }),
  describedBy: (id) => ({ 'aria-describedby': id }),
  headingLevel: (level) => ({ 'aria-level': level }),
}
