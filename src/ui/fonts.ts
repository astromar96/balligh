// Font sources for expo-font's useFonts, keyed by the family names in core/fonts.ts (on native every
// weight is its own family). Readex Pro and Reem Kufi come from @expo-google-fonts (weights 400/500/600
// as exported by those packages); Amiri Quran is the bundled OFL font the renderer also feeds to HarfBuzz;
// the Feather icon font is preloaded with them so icons never appear empty on the first paint.
import { ReadexPro_400Regular, ReadexPro_500Medium, ReadexPro_600SemiBold } from '@expo-google-fonts/readex-pro'
import { ReemKufi_400Regular, ReemKufi_600SemiBold } from '@expo-google-fonts/reem-kufi'
import Feather from '@expo/vector-icons/Feather'
import { FONTS } from '../core/fonts'

export const FONT_SOURCES = {
  [FONTS.quran]: require('../../assets/fonts/AmiriQuran-Regular.ttf'),
  [FONTS.ui]: ReadexPro_400Regular,
  [FONTS.uiMedium]: ReadexPro_500Medium,
  [FONTS.uiSemiBold]: ReadexPro_600SemiBold,
  [FONTS.display]: ReemKufi_400Regular,
  [FONTS.displaySemiBold]: ReemKufi_600SemiBold,
  ...Feather.font,
} as const
