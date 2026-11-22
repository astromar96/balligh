// Wording and one-tap fixes for the selection guard (domain.selectionWarnings): the full sentence under the
// panel, the short form the narrow bottom bar shows (so a cut that changes the meaning is never out of view),
// the severity styling, and what each fix button does to the selection. Never points at a pause-mark glyph
// (00-gaps D1). Pure and unit-tested (warnings.test.ts).
import type { Ayah, Selection, WordRef } from '../core/types'
import * as domain from '../domain'
import type { SelectionWarning } from '../domain'
import type { MessageKey, Params } from './i18n'
import { stepWord } from './selection'

type Kind = SelectionWarning['kind']

/** What a fix button does to the selection. */
export type SelectionFix =
  /** move the start back to where its sentence begins (the end stays) */
  | { kind: 'snap-start' }
  /** move the end forward to the next place where stopping is allowed (the start stays) */
  | { kind: 'snap-end' }
  | { kind: 'whole-ayahs' }
  /** move the end to `to` (the end of the next ayah's first phrase: 'ends-curated' / 'next-starts-with-illa') */
  | { kind: 'extend-to'; to: WordRef }
  /** continue past an allowed stop to the next one ('pause-hint' on «continuing is better») */
  | { kind: 'next-stop'; after: WordRef }

export interface FixAction {
  fix: SelectionFix
  label: MessageKey
  params?: Params
}

export interface WarningCopy {
  /** 'info' is a quiet hint (no colour); 'warning' is drawn in rubric and can reach the bottom bar */
  severity: 'warning' | 'info'
  message: MessageKey
  params?: Params
  /** the bottom bar's few words */
  short: MessageKey
  fixes: FixAction[]
}

const SNAP_START: FixAction = { fix: { kind: 'snap-start' }, label: 'fixSnapStart' }
const SNAP_END: FixAction = { fix: { kind: 'snap-end' }, label: 'fixSnapEnd' }
const WHOLE: FixAction = { fix: { kind: 'whole-ayahs' }, label: 'fixWholeAyahs' }
const extendTo = (to: WordRef): FixAction => ({ fix: { kind: 'extend-to', to }, label: 'fixExtendTo', params: { n: to.ayah } })

export function warningCopy(w: SelectionWarning): WarningCopy {
  const severity = domain.warningSeverity(w)
  switch (w.kind) {
    case 'starts-mid-phrase':
      return { severity, message: 'warnStartsMidPhrase', short: 'warnShortStartsMidPhrase', fixes: [SNAP_START, WHOLE] }
    case 'starts-after-speech-verb':
      return { severity, message: 'warnStartsAfterSpeechVerb', short: 'warnShortStartsAfterSpeechVerb', fixes: [SNAP_START, WHOLE] }
    case 'ends-mid-phrase':
      return { severity, message: 'warnEndsMidPhrase', short: 'warnShortEndsMidPhrase', fixes: [SNAP_END, WHOLE] }
    case 'ends-on-mamnu':
      return { severity, message: 'warnEndsOnMamnu', short: 'warnShortEndsOnMamnu', fixes: [SNAP_END, WHOLE] }
    case 'ends-curated':
      return { severity, message: 'warnEndsCurated', short: 'warnShortEndsCurated', fixes: [extendTo(w.extendTo)] }
    case 'next-starts-with-illa':
      return { severity, message: 'warnNextStartsWithIlla', short: 'warnShortNextStartsWithIlla', fixes: [extendTo(w.extendTo)] }
    case 'pause-hint':
      if (w.mark === 'muanaqa') {
        return w.bothStops
          ? { severity, message: 'warnPauseHintBothStops', short: 'warnShortBothStops', fixes: [SNAP_END] }
          : { severity, message: 'warnPauseHintMuanaqa', short: 'warnShortPauseHint', fixes: [] }
      }
      return { severity, message: 'warnPauseHintWasl', short: 'warnShortPauseHint', fixes: [{ fix: { kind: 'next-stop', after: w.at }, label: 'fixNextStop' }] }
    case 'long':
      return { severity, message: 'warnLong', params: { n: w.count }, short: 'warnShortLong', fixes: [] }
  }
}

/** Cuts that can invert the meaning first, then a cut sentence, then length. Info hints never rank. */
const RANK: Record<Kind, number> = {
  'ends-on-mamnu': 0,
  'ends-curated': 1,
  'starts-after-speech-verb': 2,
  'next-starts-with-illa': 3,
  'starts-mid-phrase': 4,
  'ends-mid-phrase': 5,
  'pause-hint': 6,
  long: 7,
}

/** The warning to surface when there is room for only one (the bottom bar); info hints are left out. */
export function primaryWarning(warnings: readonly SelectionWarning[]): SelectionWarning | null {
  let best: SelectionWarning | null = null
  for (const w of warnings) {
    if (domain.warningSeverity(w) !== 'warning') continue
    if (!best || (RANK[w.kind] ?? 9) < (RANK[best.kind] ?? 9)) best = w
  }
  return best
}

/** The selection after a fix button. Returns the selection unchanged when the fix cannot move it. */
export function applySelectionFix(sel: Selection, fix: SelectionFix, ayahs: Ayah[]): Selection {
  const s = domain.normalizeSelection(sel)
  switch (fix.kind) {
    case 'whole-ayahs':
      return domain.expandToAyahs(s, ayahs)
    case 'snap-start':
      return domain.normalizeSelection({ ...s, start: domain.snapToPauses(s, ayahs).start })
    case 'snap-end':
      return domain.normalizeSelection({ ...s, end: domain.snapToPauses(s, ayahs).end })
    case 'extend-to':
      return domain.compareRefs(fix.to, s.end) > 0 ? domain.clampSelection({ ...s, end: fix.to }, ayahs) : s
    case 'next-stop': {
      const next = stepWord(ayahs, fix.after, 1)
      if (domain.compareRefs(next, fix.after) <= 0) return s
      const moved: Selection = { ...s, end: domain.compareRefs(next, s.end) > 0 ? next : s.end }
      return domain.normalizeSelection({ ...s, end: domain.snapToPauses(moved, ayahs).end })
    }
  }
}
