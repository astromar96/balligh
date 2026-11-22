// UI lab bench (dev only): typographic checks for the Mushaf panel. Served at /lab/ui.
import { ScrollView, Text, View } from 'react-native'
import { FONTS } from '../../core/fonts'

const WORDS = ['خَلْفَهُمْ', 'وَلَا', 'ٱلْقَيُّومُ', 'رَيْبَ', 'فِيهِ']
const MARKS = ['ۖ', 'ۚ', 'ۗ', 'ۛ', 'ۙ', 'ۘ']
const VARIANTS: { name: string; join: (w: string, m: string) => string }[] = [
  { name: 'NBSP + mark', join: (w, m) => `${w}\u00A0${m}` },
  { name: 'space + mark', join: (w, m) => `${w} ${m}` },
  { name: 'ZWNJ + mark', join: (w, m) => `${w}\u200C${m}` },
  { name: 'NNBSP + mark', join: (w, m) => `${w}\u202F${m}` },
]

const BAND = 'rgba(194,154,62,0.30)'
const bandStyle = { backgroundImage: `linear-gradient(to bottom, transparent 41%, ${BAND} 41%, ${BAND} 89%, transparent 89%)` } as object
const seat = { position: 'relative', top: '0.52em' } as object
const seatVa = { verticalAlign: '-0.52em', lineHeight: 0 } as object
const seatIb = { display: 'inline-block', transform: 'translateY(0.52em)', lineHeight: 0 } as object

function BandCase({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontFamily: FONTS.ui, fontSize: 13 }}>{label}</Text>
      <Text {...({ dir: 'rtl' } as object)} style={{ fontFamily: FONTS.quran, fontSize: 28, lineHeight: 60, writingDirection: 'rtl', backgroundColor: '#fff' }}>
        {children}
      </Text>
    </View>
  )
}

export default function UiLab() {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18, backgroundColor: '#FBF8F0' }}>
      <BandCase label="A: band span with nested seated mark">
        <Text style={bandStyle}>وَلَا</Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>
          خَلْفَهُمْ
          <Text style={seat}>{'\u00A0\u06D6'}</Text>
        </Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>وَمَا</Text>
      </BandCase>
      <BandCase label="B: seated mark as a sibling, band on a wrapper without offset">
        <Text style={bandStyle}>وَلَا</Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>خَلْفَهُمْ</Text>
        <Text style={bandStyle}>
          <Text style={seat}>{'\u00A0\u06D6'}</Text>
        </Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>وَمَا</Text>
      </BandCase>
      <BandCase label="D: nested mark, vertical-align -0.52em, line-height 0">
        <Text style={bandStyle}>وَلَا</Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>
          خَلْفَهُمْ
          <Text style={seatVa}>{'\u00A0\u06D6'}</Text>
        </Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>وَمَا</Text>
      </BandCase>
      <BandCase label="E: nested mark, inline-block translateY">
        <Text style={bandStyle}>وَلَا</Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>
          خَلْفَهُمْ
          <Text style={seatIb}>{'\u00A0\u06D6'}</Text>
        </Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>وَمَا</Text>
      </BandCase>
      <BandCase label="C: mark in the same span, no offset">
        <Text style={bandStyle}>وَلَا</Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>{'خَلْفَهُمْ\u00A0\u06D6'}</Text>
        <Text style={bandStyle}> </Text>
        <Text style={bandStyle}>وَمَا</Text>
      </BandCase>
      {VARIANTS.map((v) => (
        <View key={v.name} style={{ gap: 4 }} testID={`variant-${v.name}`}>
          <Text style={{ fontFamily: FONTS.ui, fontSize: 13 }}>{v.name}</Text>
          <Text
            {...({ dir: 'rtl' } as object)}
            style={{ fontFamily: FONTS.quran, fontSize: 28, lineHeight: 60, writingDirection: 'rtl', textAlign: 'justify', backgroundColor: '#fff' }}
          >
            {WORDS.map((w, i) => (
              <Text key={i}>
                {v.join(w, MARKS[i % MARKS.length])}
                {i < WORDS.length - 1 ? ' ' : ''}
              </Text>
            ))}
            {' ۝٢٥٥'}
          </Text>
        </View>
      ))}
    </ScrollView>
  )
}
