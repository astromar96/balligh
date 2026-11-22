// Service-worker registration (web). Production builds only — never on the dev server, where a worker would serve
// stale bundles (Expo's PWA guide warns about aggressive service-worker caching); there it removes a production
// worker left on the same origin instead. Registers <base>/sw.js (scripts/build-sw.mjs) after the page's load
// event, scoped to the app's base path (the site root, or /balligh/ on GitHub Pages — app.json
// experiments.baseUrl, which Expo inlines as process.env.EXPO_BASE_URL).
//
// Updates are never forced: a new worker waits (no skipWaiting) until the user taps «حدّث الآن» in the notice;
// then it takes over and this tab reloads once. A worker that took over without a reload would delete the old
// version's precached chunks under a page that may still load them lazily (Mediabunny, the AAC encoder).
// Once per app start it asks the worker to purge cached audio past its host's limit (QF: 6 days — 00-gaps D9).
import { PURGE_MESSAGE, SKIP_WAITING, swLocation, type PwaLanguage, type RegisterOptions } from './options'
import { showToast } from './toast.web'

export type { RegisterOptions } from './options'

/** an installed app can stay open for days: look for a new version when it comes back, at most this often */
const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000
/** reload anyway if the new worker has not taken over this long after the user asked */
const TAKEOVER_TIMEOUT_MS = 4000

function appBaseUrl(): string {
  try {
    return process.env.EXPO_BASE_URL ?? ''
  } catch {
    return ''
  }
}

const isDev = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__

let started = false

/** Registers the service worker once per page (repeat calls do nothing). Never throws. */
export function registerServiceWorker(options: RegisterOptions = {}): void {
  if (started || typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  started = true
  const { url, scope } = swLocation(appBaseUrl())
  if (isDev()) {
    void removeWorker(new URL(url, window.location.href).href)
    return
  }
  const start = () => void register(url, scope, options.language ?? (() => 'ar'))
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

async function removeWorker(scriptUrl: string): Promise<void> {
  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      const workers = [reg.active, reg.waiting, reg.installing]
      if (workers.some((w) => w?.scriptURL === scriptUrl)) {
        await reg.unregister()
        console.info('[pwa] development: removed the production service worker of this origin')
      }
    }
  } catch {
    // nothing to remove
  }
}

async function register(url: string, scope: string, language: () => PwaLanguage): Promise<void> {
  const container = navigator.serviceWorker
  let reg: ServiceWorkerRegistration
  try {
    reg = await container.register(url, { scope })
  } catch (e) {
    // no sw.js in this build (export without scripts/build-sw.mjs), private mode, blocked storage…: the app works without
    console.info('[pwa] service worker not registered:', e instanceof Error ? e.message : e)
    return
  }

  let hadController = container.controller !== null
  let asked = false
  let reloading = false
  const reload = () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  }
  const offer = (worker: ServiceWorker) =>
    showToast('update', language(), () => {
      asked = true
      worker.postMessage({ type: SKIP_WAITING })
      setTimeout(reload, TAKEOVER_TIMEOUT_MS)
    })

  container.addEventListener('controllerchange', () => {
    // the first install takes control without a reload (clientsClaim): nothing changes under the page then
    if (asked) reload()
    else if (hadController) showToast('reload', language(), reload)
    hadController = true
  })
  if (reg.waiting && container.controller) offer(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) offer(worker)
    })
  })

  void container.ready.then((ready) => ready.active?.postMessage({ type: PURGE_MESSAGE })).catch(() => {})

  let lastCheck = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_EVERY_MS) return
    lastCheck = Date.now()
    reg.update().catch(() => {})
  })
}
