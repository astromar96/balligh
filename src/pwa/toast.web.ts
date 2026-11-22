// The update notice (web): a small status strip at the top of the page — clear of the sticky bottom bar that holds
// the primary action. Plain DOM appended to <body>, outside the react-native-web tree, so hydration never sees it.
// Arabic first; the strip follows the language's direction. Motion only when reduced motion is off.
import type { PwaLanguage } from './options'

/** update: a new version is waiting for this tab · reload: another tab switched to the new version */
export type ToastKind = 'update' | 'reload'

interface Copy {
  text: string
  action: string
  dismiss: string
}

const COPY: Record<ToastKind, Record<PwaLanguage, Copy>> = {
  update: {
    ar: { text: 'تحديث متاح', action: 'حدّث الآن', dismiss: 'لاحقًا' },
    en: { text: 'Update available', action: 'Update now', dismiss: 'Later' },
  },
  reload: {
    ar: { text: 'حُدِّث التطبيق في نافذة أخرى', action: 'أعد التحميل', dismiss: 'لاحقًا' },
    en: { text: 'The app was updated in another window', action: 'Reload', dismiss: 'Later' },
  },
}

export function toastCopy(kind: ToastKind, lang: PwaLanguage): Copy {
  return COPY[kind][lang]
}

const TOAST_ID = 'balligh-pwa-toast'
const STYLE_ID = 'balligh-pwa-toast-style'

// Palette and type from the design brief (ui/tokens.ts): an inverse strip (ink on light pages, parchment on dark),
// the action in malachite (primary actions), Readex Pro as registered by the root layout's useFonts.
const CSS = `
#${TOAST_ID} {
  position: fixed; z-index: 2147483000; box-sizing: border-box;
  top: calc(env(safe-area-inset-top, 0px) + 12px); left: 12px; right: 12px; margin: 0 auto; max-width: 440px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding-block: 8px; padding-inline: 16px 8px; border-radius: 14px;
  background: #16222E; color: #FBF8F0; box-shadow: 0 6px 24px rgba(15, 24, 32, 0.28);
  font-family: ReadexPro, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 15px; line-height: 22px;
}
#${TOAST_ID} .t { flex: 1 1 10em; }
#${TOAST_ID} button {
  font: inherit; min-height: 44px; padding: 0 14px; border: 0; border-radius: 10px; cursor: pointer;
}
#${TOAST_ID} .a { background: #1D6B57; color: #FFFFFF; font-family: "ReadexPro-SemiBold", ReadexPro, system-ui, sans-serif; }
#${TOAST_ID} .a:disabled { opacity: 0.7; cursor: default; }
#${TOAST_ID} .d { background: transparent; color: #C9D1D6; }
#${TOAST_ID} button:focus-visible { outline: 2px solid #8FB0E6; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  #${TOAST_ID} { background: #ECE6D8; color: #16222E; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }
  #${TOAST_ID} .d { color: #4F5D69; }
  #${TOAST_ID} button:focus-visible { outline-color: #2A4A7F; }
}
@media (prefers-reduced-motion: no-preference) {
  #${TOAST_ID} { animation: balligh-pwa-toast-in 180ms ease-out; }
  @keyframes balligh-pwa-toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
}
`

/** Shows the notice (replacing one already shown). `onAction` runs once, on the main button. */
export function showToast(kind: ToastKind, lang: PwaLanguage, onAction: () => void): void {
  if (typeof document === 'undefined' || !document.body) return
  document.getElementById(TOAST_ID)?.remove()
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }
  const copy = toastCopy(kind, lang)
  const root = document.createElement('div')
  root.id = TOAST_ID
  root.setAttribute('role', 'status')
  root.setAttribute('aria-live', 'polite')
  root.lang = lang
  root.dir = lang === 'ar' ? 'rtl' : 'ltr'
  const text = document.createElement('span')
  text.className = 't'
  text.textContent = copy.text
  const action = document.createElement('button')
  action.type = 'button'
  action.className = 'a'
  action.textContent = copy.action
  action.addEventListener('click', () => {
    if (action.disabled) return
    action.disabled = true
    onAction()
  })
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'd'
  dismiss.textContent = copy.dismiss
  dismiss.addEventListener('click', () => root.remove())
  root.append(text, action, dismiss)
  document.body.appendChild(root)
}
