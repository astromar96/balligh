import { useCallback, useEffect, useRef, useState } from 'react'
import { countLabel, formatNumber, translate, type CountNoun, type Language, type MessageKey, type Params } from './i18n'
import { useAppStore } from './store'

export interface Translator {
  lang: Language
  t(key: MessageKey, params?: Params): string
  /** number in the UI's digits (Arabic-Indic in Arabic) */
  n(value: number): string
  /** "٧ آيات" / "7 verses" */
  count(value: number, noun: CountNoun): string
}

export function useT(): Translator {
  const lang = useAppStore((s) => s.language)
  const t = useCallback((key: MessageKey, params?: Params) => translate(lang, key, params), [lang])
  const n = useCallback((value: number) => formatNumber(lang, value), [lang])
  const count = useCallback((value: number, noun: CountNoun) => countLabel(lang, value, noun), [lang])
  return { lang, t, n, count }
}

/**
 * A number that grows each time `visible` turns true (0 until the first opening). Key a sheet's body on it and
 * every opening starts from fresh state, while the body stays mounted through the closing animation. This is
 * React's "adjust state when a prop changes" pattern: the update happens during render, never in an effect.
 */
export function useOpenSession(visible: boolean): number {
  const [state, setState] = useState(() => ({ visible, session: visible ? 1 : 0 }))
  // React re-runs this component with the new state before rendering its children
  if (state.visible !== visible) setState({ visible, session: visible ? state.session + 1 : state.session })
  return state.session
}

/**
 * A ref whose element takes keyboard focus when it mounts: where the control that had focus has just disappeared
 * (the export sheet's option → its progress → its result), focus goes to the next action instead of falling to the
 * page. Web only in practice: a native View has no focus(), so this is a no-op there.
 */
export function useFocusOnMount<T>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current as { focus?: () => void } | null
    el?.focus?.()
  }, [])
  return ref
}
