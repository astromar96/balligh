// App start: what the main screen and the render route both do once, before the compose engine has anything to work
// on. No React.
import * as data from '../data'
import * as domain from '../domain'
import type { ShareState } from '../domain'
import { orElse } from './safe'
import { useAppStore } from './store'

/** A deep link's query string → its state; null when there is none or it does not decode. */
export function decodeQuery(query: string | null): ShareState | null {
  return query ? orElse(() => domain.decodeShareState(query), null) : null
}

/**
 * Deletes cached Quran Foundation content past its 6-day limit (QF terms, 00-gaps §2.9), loads the surah list, then
 * opens the deep link's passage, or Al-Fatiha without one.
 */
export function openInitialPassage(state: ShareState | null): void {
  void data.purgeExpiredCaches()
  const st = useAppStore.getState()
  st.loadSurahs()
  if (state) st.applyShareState(state)
  else st.openSurah(1)
}
