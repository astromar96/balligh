// Native: no service worker. The app store delivers updates, data/ keeps its caches in memory with the same capped
// TTLs, and there is nothing to precache. The web implementation is register.web.ts (Metro picks it on the web).
import type { RegisterOptions } from './options'

export type { RegisterOptions } from './options'

/** No-op on native. */
export function registerServiceWorker(options: RegisterOptions = {}): void {
  void options
}
