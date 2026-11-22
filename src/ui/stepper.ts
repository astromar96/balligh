// The narrow-screen flow (pure, unit-tested): five steps, one screen each, and how they sit in the browser's history.
//
//   verses → reciter → extras → design → preview
//
// History: Next, a jump with the step indicator and opening a sheet each add an entry, in the tap that asks for it
// (Chrome skips entries a page adds without a user gesture). The browser's Back and Forward move between them
// (popstate); a sheet's entry going away closes the sheet. Every entry keeps what Expo Router stores in history.state
// (its entry id) and the same URL, and adds our own entry under ENTRY_KEY, so the router keeps showing the same screen.
//
// Each entry records the one below it (`prev`, the entry that was current when it was added; replacing an entry keeps
// its place). That is how the on-screen Back knows whether going back in the browser lands on the previous step; when
// it does not (a jump, or the first entry of the page, e.g. after opening a shared link) the current entry is changed
// in place instead, so the on-screen Back never leaves the app.

import type { MessageKey } from './i18n'

export const STEPS = ['verses', 'reciter', 'extras', 'design', 'preview'] as const
export type StepKey = (typeof STEPS)[number]

/** short names (the step indicator, Next/Back) and the fuller heading on each step */
export const STEP_LABEL: Record<StepKey, MessageKey> = {
  verses: 'stepVerses',
  reciter: 'stepReciter',
  extras: 'stepExtras',
  design: 'stepDesign',
  preview: 'stepPreview',
}
export const STEP_TITLE: Record<StepKey, MessageKey> = {
  verses: 'stepVersesTitle',
  reciter: 'stepReciterTitle',
  extras: 'stepExtrasTitle',
  design: 'stepDesignTitle',
  preview: 'stepPreviewTitle',
}

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value)
}

/** 0-based position in the flow */
export function stepIndex(step: StepKey): number {
  return STEPS.indexOf(step)
}

export function nextStep(step: StepKey): StepKey | null {
  return STEPS[stepIndex(step) + 1] ?? null
}

export function prevStep(step: StepKey): StepKey | null {
  const i = stepIndex(step)
  return i > 0 ? STEPS[i - 1] : null
}

export interface StepGate {
  /** a passage is selected */
  hasSelection: boolean
  /** its first word is tapped and the end is still open */
  pending: boolean
}

/** The verses are always open; every later step needs a finished selection. */
export function canOpenStep(step: StepKey, gate: StepGate): boolean {
  return step === 'verses' || (gate.hasSelection && !gate.pending)
}

/** Where the app opens: a link that carries a passage opens on the preview, anything else on the verses. */
export function landingStep(hasPassage: boolean): StepKey {
  return hasPassage ? 'preview' : 'verses'
}

/** The steps that show the live preview (a canvas with its own animation loop: one at a time). */
export function showsStage(step: StepKey): boolean {
  return step === 'design' || step === 'preview'
}

/** 1 when `to` comes after `from` in the flow, -1 when before, 0 when it is the same step. */
export function slideDirection(from: StepKey, to: StepKey): -1 | 0 | 1 {
  const d = stepIndex(to) - stepIndex(from)
  return d > 0 ? 1 : d < 0 ? -1 : 0
}

/**
 * Horizontal start offset of a step sliding in, in px (screen coordinates: negative is left). The flow reads in the
 * UI's direction: in Arabic the next step comes in from the left, the previous one from the right; English mirrors it.
 */
export function slideOffset(direction: -1 | 0 | 1, rtl: boolean, distance: number): number {
  if (direction === 0) return 0
  const fromLeft = direction > 0 === rtl
  return fromLeft ? -distance : distance
}

// ───────────────────────── history entries ─────────────────────────

/** our part of history.state; the rest (Expo Router's entry id) is never touched */
export const ENTRY_KEY = 'balligh'

export interface NavEntry {
  /** unique per entry the app added: page-load id + counter */
  key: string
  /** the entry below this one in the browser's history; null for the page's first entry */
  prev: string | null
  step: StepKey
  /** the entry of an open sheet (same step as the one below it) */
  sheet: boolean
}

/** history.state with our entry set; everything else in it is kept as it is. */
export function withEntry(state: unknown, entry: NavEntry): Record<string, unknown> {
  const base = state && typeof state === 'object' && !Array.isArray(state) ? (state as Record<string, unknown>) : {}
  return { ...base, [ENTRY_KEY]: { key: entry.key, prev: entry.prev, step: entry.step, sheet: entry.sheet } }
}

/**
 * An entry the step flow added or changed in place (it carries our marker, from this page load or an earlier one).
 * Going back or forward onto one shows another step of the same screen: Expo Router has nothing to restore there.
 */
export function isOwnEntry(state: unknown): boolean {
  return readEntry(state) !== null
}

/** Our entry in a history.state, or null: the router's first entry of the page, or anything malformed. */
export function readEntry(state: unknown): NavEntry | null {
  if (!state || typeof state !== 'object') return null
  const raw = (state as Record<string, unknown>)[ENTRY_KEY]
  if (!raw || typeof raw !== 'object') return null
  const { key, prev, step, sheet } = raw as Record<string, unknown>
  if (typeof key !== 'string' || key.length === 0) return null
  if (prev !== null && typeof prev !== 'string') return null
  if (!isStepKey(step)) return null
  return { key, prev, step, sheet: sheet === true }
}

// ───────────────────────── navigation model ─────────────────────────

/** What the app knows about the history entries it has seen, and which one the browser is on. */
export interface Nav {
  entries: Readonly<Record<string, NavEntry>>
  current: string
  /** the page's first entry (Expo Router's, without our marker until the app changes it in place) */
  base: string
}

export function startNav(base: string, step: StepKey): Nav {
  return { entries: { [base]: { key: base, prev: null, step, sheet: false } }, current: base, base }
}

export function currentEntry(nav: Nav): NavEntry {
  return nav.entries[nav.current] ?? nav.entries[nav.base]
}

/** A new entry on top of the current one (Next, a jump, a sheet opening). */
export function pushEntry(nav: Nav, key: string, step: StepKey, sheet = false): { nav: Nav; entry: NavEntry } {
  const entry: NavEntry = { key, prev: currentEntry(nav).key, step, sheet }
  return { nav: { ...nav, entries: { ...nav.entries, [key]: entry }, current: key }, entry }
}

/** The current entry shows another step (same place in the history). */
export function replaceStep(nav: Nav, step: StepKey): { nav: Nav; entry: NavEntry } {
  const entry: NavEntry = { ...currentEntry(nav), step }
  return { nav: { ...nav, entries: { ...nav.entries, [entry.key]: entry } }, entry }
}

export type BackPlan =
  /** the entry below shows the previous step: go back in the browser (its Forward still leads here) */
  | { kind: 'history'; step: StepKey; nav: Nav }
  /** no such entry (a jump, or the page's first entry): show the previous step in this entry */
  | { kind: 'replace'; step: StepKey; nav: Nav; entry: NavEntry }

/** The on-screen Back: the previous step, never out of the app. null on the first step (and while a sheet is open). */
export function planBack(nav: Nav): BackPlan | null {
  const cur = currentEntry(nav)
  if (cur.sheet) return null
  const step = prevStep(cur.step)
  if (!step) return null
  const below = cur.prev !== null ? nav.entries[cur.prev] : undefined
  if (below && !below.sheet && below.step === step) return { kind: 'history', step, nav: { ...nav, current: below.key } }
  const { nav: next, entry } = replaceStep(nav, step)
  return { kind: 'replace', step, nav: next, entry }
}

/** A sheet closed from the UI (close button, backdrop, Escape, a choice): go back over its entry if the browser is on it. */
export function planSheetClosed(nav: Nav, key: string): { goBack: boolean; nav: Nav } {
  const entry = nav.entries[key]
  if (nav.current !== key || !entry?.sheet) return { goBack: false, nav }
  return { goBack: true, nav: { ...nav, current: entry.prev ?? nav.base } }
}

/** The sheet that is open: its entry key, and whether it has an entry (none when the browser refused the push). */
export interface OpenSheet {
  key: string
  hasEntry: boolean
}

export interface PopPlan {
  nav: Nav
  /** the step to show (nothing to show while skipBack: the entry below decides) */
  step: StepKey
  /** a sheet is open and the browser left its entry (system Back): close it */
  closeSheet: boolean
  /** the browser came forward onto the entry of a sheet that is closed: go back over it */
  skipBack: boolean
  /**
   * the entry shows a step the selection does not open (e.g. Forward while the end of a new selection is pending): it
   * shows the verses instead, and this is the entry to write back in place so its marker says so
   */
  replace: NavEntry | null
}

/**
 * The browser moved to another entry (popstate). `state` is that entry's history.state: our marker, or none for the
 * page's first entry. Entries of an earlier page load are learnt as the browser reaches them. A later step only shows
 * when `gate` opens it (as Next and the indicator require); otherwise the entry becomes the verses, in place.
 */
export function planPop(nav: Nav, state: unknown, open: OpenSheet | null, gate: StepGate): PopPlan {
  const marked = readEntry(state)
  const entry = marked ?? currentEntryOf(nav, nav.base)
  const next: Nav = { ...nav, entries: { ...nav.entries, [entry.key]: entry }, current: entry.key }
  const onOpenSheet = !!open && open.hasEntry && open.key === entry.key
  const closeSheet = !!open && !onOpenSheet
  const skipBack = entry.sheet && !onOpenSheet
  if (!skipBack && !canOpenStep(entry.step, gate)) {
    const r = replaceStep(next, 'verses')
    return { nav: r.nav, step: 'verses', closeSheet, skipBack: false, replace: r.entry }
  }
  return { nav: next, step: entry.step, closeSheet, skipBack, replace: null }
}

function currentEntryOf(nav: Nav, key: string): NavEntry {
  return nav.entries[key] ?? { key, prev: null, step: 'verses', sheet: false }
}
