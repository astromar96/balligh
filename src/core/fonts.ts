// Font family names shared by the UI (registers them with expo-font's useFonts, keys = these names)
// and the scene (draws with them on canvas/Skia). On native every weight is its own family, so
// weights are separate names. Nothing here imports anything.
export const FONTS = {
  /** Quran text only — assets/fonts/AmiriQuran-Regular.ttf (also fed to HarfBuzz) */
  quran: 'AmiriQuran',
  /** UI and non-Quran canvas text (Readex Pro — @expo-google-fonts/readex-pro) */
  ui: 'ReadexPro',
  uiMedium: 'ReadexPro-Medium',
  uiSemiBold: 'ReadexPro-SemiBold',
  /** app name and section titles, sparingly (Reem Kufi — @expo-google-fonts/reem-kufi) */
  display: 'ReemKufi',
  displaySemiBold: 'ReemKufi-SemiBold',
} as const

export type FontFamily = (typeof FONTS)[keyof typeof FONTS]
