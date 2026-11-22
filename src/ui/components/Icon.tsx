// Icons: Feather (thin, even strokes — quiet next to the Mushaf page) from @expo/vector-icons. The font is
// preloaded with the app fonts (ui/fonts.ts), so icons never flash in empty. Each glyph sits in an LTR box so media
// glyphs keep their conventional orientation in the RTL UI (play points right everywhere).
import Feather from '@expo/vector-icons/Feather'
import { View, type ViewStyle } from 'react-native'
import { uiPlatform } from '../platform'

export type IconName =
  | 'play'
  | 'pause'
  | 'close'
  | 'chevronDown'
  | 'chevronStart'
  | 'chevronEnd'
  | 'search'
  | 'check'
  | 'plus'
  | 'minus'
  | 'download'
  | 'share'
  | 'link'
  | 'image'
  | 'video'
  | 'alert'
  | 'info'
  | 'book'
  | 'external'

type FeatherName = keyof typeof Feather.glyphMap

const GLYPH: Record<IconName, FeatherName> = {
  play: 'play',
  pause: 'pause',
  close: 'x',
  chevronDown: 'chevron-down',
  // logical directions, resolved per writing direction below
  chevronStart: 'chevron-right',
  chevronEnd: 'chevron-left',
  search: 'search',
  check: 'check',
  plus: 'plus',
  minus: 'minus',
  download: 'download',
  share: 'share',
  link: 'link',
  image: 'image',
  video: 'video',
  alert: 'alert-circle',
  info: 'info',
  book: 'book-open',
  external: 'external-link',
}

/**
 * `rtl` flips the two logical chevrons (start = the reading side): in Arabic «previous» points right, in English
 * left. Every other glyph keeps its orientation.
 */
export function Icon({ name, size = 20, color, rtl = true }: { name: IconName; size?: number; color: string; rtl?: boolean }) {
  let glyph = GLYPH[name]
  if (!rtl && name === 'chevronStart') glyph = 'chevron-left'
  if (!rtl && name === 'chevronEnd') glyph = 'chevron-right'
  const box: ViewStyle = { width: size, height: size, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', ...(uiPlatform.ltrStyle as ViewStyle) }
  return (
    <View style={box} {...uiPlatform.ltrProps} aria-hidden>
      <Feather name={glyph} size={Math.round(size * 0.92)} color={color} />
    </View>
  )
}
