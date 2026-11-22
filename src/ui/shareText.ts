// What a shared clip says about itself: the deep link that reopens it and the text that goes with the file (the
// selected words, the reference, the reciter, the sources). Used by the export sheet's share sheet and by the render
// route, whose text becomes the caption on Balligh's own pages (server/). Reads the stores; no React.
import type { RenderModel } from '../core/types'
import * as domain from '../domain'
import { useCompose } from './compose'
import { shareSources } from './credits'
import { ayahOrnament } from './format'
import { translate, type Language } from './i18n'
import { uiPlatform } from './platform'
import { orElse } from './safe'
import { selectedText } from './selection'
import { useAppStore } from './store'

/** The query string that reopens the current state (encodeShareState), or null with nothing selected. */
export function currentShareQuery(): string | null {
  const st = useAppStore.getState()
  const state = st.shareState()
  if (!state) return null
  const query = orElse(() => domain.encodeShareState(state, st.ayahs ?? undefined), '')
  return query || null
}

/** The deep link for the current state: `base` (the app's address, origin + pathname) + '?' + encodeShareState. */
export function currentShareLink(base: string = uiPlatform.appBaseUrl()): string | null {
  const query = currentShareQuery()
  return query ? `${base}?${query}` : null
}

/** The lines of a shared clip's text, each empty when it does not apply. */
export interface ShareTextParts {
  /** «the selected words» */
  words: string
  /** "— Al-Baqarah 255" */
  reference: string
  /** "Recited by …" (video only) */
  reciter: string
  /** "Sources: …" */
  sources: string
  link: string
}

/**
 * The text that travels with a shared clip: «the words», the reference, the reciter (video), the sources the file
 * carries burned in (QF terms: Quran.com / Quran Foundation in the caption too — 00-gaps §2.9), and the link.
 */
export function shareTextParts(kind: 'video' | 'image', lang: Language, link: string | null = currentShareLink()): ShareTextParts {
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(lang, key, params)
  const arabic = lang === 'ar'
  const st = useAppStore.getState()
  const comp = useCompose.getState()
  const m: RenderModel | null = kind === 'video' ? comp.model : comp.stillModel
  const sel = kind === 'video' ? (comp.playedSelection ?? st.selection) : st.selection
  const words = sel && st.ayahs ? selectedText(sel, st.ayahs, ayahOrnament) : ''
  const sources = shareSources(kind, m, { tafsir: st.design.showTafsir, translation: st.design.showTranslation }, lang)
  return {
    words: words ? `«${words}»` : '',
    reference: t('shareTextReference', { desc: comp.description }),
    reciter: kind === 'video' && m?.reciter ? t('shareTextReciter', { name: arabic ? m.reciter.nameAr : m.reciter.nameEn }) : '',
    sources: t('shareTextSources', { list: sources.join(arabic ? '، ' : ', ') }),
    link: link ?? '',
  }
}

/** shareTextParts as one text, a line each. */
export function buildShareText(kind: 'video' | 'image', lang: Language, link: string | null = currentShareLink()): string {
  const p = shareTextParts(kind, lang, link)
  return [p.words, p.reference, p.reciter, p.sources, p.link].filter(Boolean).join('\n')
}
