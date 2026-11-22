// Sheets and the browser's Back on narrow screens: the step flow (ui/stepNav.ts) gives every open sheet a history
// entry, so system Back (Android back, iOS edge swipe, the browser button) closes the sheet and keeps the step.
// Provided only by the narrow layout; without it (wide screens) a sheet behaves as it always did.
import { createContext } from 'react'

export interface SheetHistory {
  /** a sheet opened (right after the tap that opened it): returns its token; `close` closes it on system Back */
  opened(close: () => void): string
  /** the sheet closed in any way, or went away: its entry, if the browser is still on it, is gone back over */
  closed(token: string): void
}

export const SheetHistoryContext = createContext<SheetHistory | null>(null)
