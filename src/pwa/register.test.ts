import { registerServiceWorker } from './register.web'
import { PURGE_MESSAGE, SKIP_WAITING, swLocation } from './options'
import { toastCopy } from './toast.web'

describe('swLocation', () => {
  it('puts the worker at the root of the app base, scoped to it', () => {
    expect(swLocation('')).toEqual({ url: '/sw.js', scope: '/' })
    expect(swLocation('/balligh')).toEqual({ url: '/balligh/sw.js', scope: '/balligh/' })
    expect(swLocation('/balligh/')).toEqual({ url: '/balligh/sw.js', scope: '/balligh/' })
  })
})

describe('messages', () => {
  it('match what the worker listens for', () => {
    expect(PURGE_MESSAGE).toBe('BALLIGH_PURGE')
    expect(SKIP_WAITING).toBe('SKIP_WAITING') // Workbox generateSW without skipWaiting
  })
})

describe('update notice copy', () => {
  it('says what happened and what the button does, Arabic first', () => {
    expect(toastCopy('update', 'ar')).toEqual({ text: 'تحديث متاح', action: 'حدّث الآن', dismiss: 'لاحقًا' })
    expect(toastCopy('reload', 'ar').action).toBe('أعد التحميل')
    expect(toastCopy('update', 'en')).toEqual({ text: 'Update available', action: 'Update now', dismiss: 'Later' })
  })
})

describe('registerServiceWorker outside a browser', () => {
  it('does nothing and never throws (static rendering runs in Node)', () => {
    expect(() => registerServiceWorker({ language: () => 'en' })).not.toThrow()
  })
})
