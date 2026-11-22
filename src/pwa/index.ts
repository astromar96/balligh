// pwa/ — progressive web app (milestone M6): service-worker registration and the update notice on the web, a no-op
// on native. The service worker itself is generated at build time over the Expo web export by
// scripts/build-sw.mjs (Workbox precache + runtime caches from src/data/cache-policy.json; its Balligh-specific
// runtime is sw-runtime.ts). Call registerServiceWorker() once, at module load of the root layout.
export { registerServiceWorker, type RegisterOptions } from './register'
export type { PwaLanguage } from './options'
