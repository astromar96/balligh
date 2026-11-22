// Design tokens — PLAN.md "Design brief". Colour only where it means something:
//   malachite = primary actions (export/share), gold leaf = the selection band,
//   lapis = focus and links, rubric = warnings. The page colour belongs to the Mushaf panel only.
import { FONTS } from '../core/fonts'

export const PALETTE = {
  ink: '#16222E',
  page: '#FBF8F0',
  chrome: '#F2F4F3',
  malachite: '#1D6B57',
  gold: '#C29A3E',
  lapis: '#2A4A7F',
  rubric: '#A8382C',
} as const

export interface Theme {
  dark: boolean
  /** app background (chrome) */
  bg: string
  /** raised surfaces: inputs, sheets, list rows */
  surface: string
  /** the Mushaf page — only the Mushaf panel uses it */
  page: string
  text: string
  textMuted: string
  textFaint: string
  hairline: string
  /** malachite: primary actions */
  primary: string
  primaryPressed: string
  onPrimary: string
  /** quiet tint behind selected chips / toggles */
  primaryTint: string
  gold: string
  /** the selection band behind selected words */
  goldBand: string
  /** the first tapped word while the end is still open */
  goldAnchor: string
  /** lapis: focus rings and links */
  focus: string
  link: string
  warn: string
  warnTint: string
  /** the dark mat the preview canvas sits on */
  stage: string
  onStage: string
  onStageMuted: string
  skeleton: string
  scrim: string
  /** double rule around the Mushaf page */
  frameOuter: string
  frameInner: string
}

export const LIGHT: Theme = {
  dark: false,
  bg: PALETTE.chrome,
  surface: '#FFFFFF',
  page: PALETTE.page,
  text: PALETTE.ink,
  textMuted: '#4F5D69',
  textFaint: '#77838D',
  hairline: '#D5DBD8',
  primary: PALETTE.malachite,
  primaryPressed: '#15513F',
  onPrimary: '#FFFFFF',
  primaryTint: 'rgba(29,107,87,0.10)',
  gold: PALETTE.gold,
  goldBand: 'rgba(194,154,62,0.30)',
  goldAnchor: 'rgba(194,154,62,0.58)',
  focus: PALETTE.lapis,
  link: PALETTE.lapis,
  warn: PALETTE.rubric,
  warnTint: 'rgba(168,56,44,0.07)',
  stage: PALETTE.ink,
  onStage: '#ECE6D8',
  onStageMuted: '#9DA9B3',
  skeleton: 'rgba(22,34,46,0.08)',
  scrim: 'rgba(15,24,32,0.48)',
  frameOuter: PALETTE.malachite,
  frameInner: PALETTE.gold,
}

export const DARK: Theme = {
  dark: true,
  bg: '#0F1820',
  surface: '#16212B',
  page: '#17212B',
  text: '#ECE6D8',
  textMuted: '#AEB6BC',
  textFaint: '#7F8A93',
  hairline: '#27343F',
  primary: PALETTE.malachite,
  primaryPressed: '#24826A',
  onPrimary: '#F4F1E8',
  primaryTint: 'rgba(63,163,135,0.16)',
  gold: '#D3AF5E',
  goldBand: 'rgba(211,175,94,0.26)',
  goldAnchor: 'rgba(211,175,94,0.50)',
  focus: '#8FB0E6',
  link: '#8FB0E6',
  warn: '#E58B7F',
  warnTint: 'rgba(229,139,127,0.10)',
  stage: '#0A1117',
  onStage: '#ECE6D8',
  onStageMuted: '#8E9AA4',
  skeleton: 'rgba(236,230,216,0.08)',
  scrim: 'rgba(0,0,0,0.6)',
  frameOuter: '#2E8C72',
  frameInner: '#B99446',
}

export const SPACE = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const

/** Radii follow hierarchy: the page is crisp, controls soft, chips round, sheets generous. */
export const RADIUS = { page: 3, control: 10, chip: 999, sheet: 20, small: 6 } as const

/** Font families registered by expo-font in src/app/_layout.tsx (names from core/fonts.ts). */
export const FAMILY = {
  quran: FONTS.quran,
  ui: FONTS.ui,
  uiMedium: FONTS.uiMedium,
  uiSemiBold: FONTS.uiSemiBold,
  display: FONTS.display,
  displaySemiBold: FONTS.displaySemiBold,
} as const

/**
 * Type scale (UI = Readex Pro; display = Reem Kufi, sparingly; Quran = Amiri Quran).
 * Arabic needs generous leading; Amiri Quran needs ~2.1× for stacked marks.
 */
export const TYPE = {
  caption: { fontFamily: FAMILY.ui, fontSize: 12, lineHeight: 18 },
  small: { fontFamily: FAMILY.ui, fontSize: 13.5, lineHeight: 21 },
  body: { fontFamily: FAMILY.ui, fontSize: 15, lineHeight: 24 },
  bodyMedium: { fontFamily: FAMILY.uiMedium, fontSize: 15, lineHeight: 24 },
  label: { fontFamily: FAMILY.uiMedium, fontSize: 14, lineHeight: 21 },
  title: { fontFamily: FAMILY.uiSemiBold, fontSize: 17, lineHeight: 26 },
  section: { fontFamily: FAMILY.displaySemiBold, fontSize: 23, lineHeight: 34 },
  subsection: { fontFamily: FAMILY.uiSemiBold, fontSize: 15.5, lineHeight: 24 },
  brand: { fontFamily: FAMILY.displaySemiBold, fontSize: 30, lineHeight: 40 },
} as const

export const QURAN_SIZE = { narrow: 25, wide: 29 } as const
export const QURAN_LEADING = 2.15

/** Window width at which the layout becomes two columns (PLAN.md). */
export const WIDE_BREAKPOINT = 1024

/** Minimum touch target (WCAG 2.5.8 / platform guidance). */
export const TOUCH = 44
