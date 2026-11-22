// The preview stage's chrome around its canvas (Stage.web.tsx), shared so the narrow step flow can give a Stage a
// fixed share of the screen. Its own file: Stage.web.tsx cannot import values from './Stage' (on the web that
// resolves to itself).
import { SPACE, TOUCH } from '../tokens'

/** the dark mat's padding around the canvas */
export const MAT_PAD = SPACE.lg

/** how much taller a compact Stage is than its canvas: the mat's padding, the gap and the controls' row */
export const STAGE_CHROME = MAT_PAD * 2 + SPACE.md + TOUCH
