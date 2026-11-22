// Shared by register.web.ts (web) and register.ts (native no-op): the options of registerServiceWorker().

export type PwaLanguage = 'ar' | 'en'

/** Page → worker messages. PURGE = sw-runtime.ts PURGE_MESSAGE; SKIP_WAITING is the message Workbox's generateSW
 * worker (built without skipWaiting) waits for before it takes over. */
export const PURGE_MESSAGE = 'BALLIGH_PURGE'
export const SKIP_WAITING = 'SKIP_WAITING'

export interface RegisterOptions {
  /** the UI language, read when the update notice appears (default Arabic) */
  language?: () => PwaLanguage
}

/** Where the service worker lives for the app's base URL ("" at the site root, "/balligh" on GitHub Pages). */
export function swLocation(baseUrl: string): { url: string; scope: string } {
  const base = baseUrl.replace(/\/+$/, '')
  return { url: `${base}/sw.js`, scope: `${base}/` }
}
