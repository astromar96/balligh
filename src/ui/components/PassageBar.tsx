// Above the Mushaf panel: which surah, and the ayah range as numbers (the keyboard-friendly way in).
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { fromIndic, parseCount, toIndic } from '../format'
import { useT } from '../hooks'
import { normalizeLocal } from '../selection'
import { currentSurah, useAppStore } from '../store'
import { useTheme, useWindowSizeSafe } from '../theme'
import { FAMILY, RADIUS, SPACE, TOUCH, TYPE } from '../tokens'
import { Icon } from './Icon'

export function PassageBar({ onOpenPicker }: { onOpenPicker: () => void }) {
  const th = useTheme()
  const { t, lang, count } = useT()
  const surah = useAppStore((s) => currentSurah(s))
  const surahNo = useAppStore((s) => s.surah)
  const selection = useAppStore((s) => s.selection)
  const ayahs = useAppStore((s) => s.ayahs)
  const setRange = useAppStore((s) => s.setRange)
  const sel = selection ? normalizeLocal(selection) : null
  const maxAyah = ayahs?.length ?? surah?.versesCount ?? 0

  const name = surah ? (lang === 'ar' ? surah.nameArabic : surah.nameSimple) : lang === 'ar' ? `سورة ${toIndic(String(surahNo))}` : `Surah ${surahNo}`
  const meta = surah ? `${t(surah.revelationPlace === 'makkah' ? 'makki' : 'madani')}، ${count(surah.versesCount, 'ayah')}` : ''
  // Under 360 px the surah button takes its own row (the ayah fields share the next one), so names and
  // counts are never cut down to "Al-Fat…" on the smallest phones (320 px reflow width).
  const stacked = useWindowSizeSafe().width < 360

  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <Pressable
        testID="surah-button"
        accessibilityRole="button"
        accessibilityLabel={`${t('chooseSurah')}: ${name}`}
        onPress={onOpenPicker}
        style={({ pressed }) => [styles.surahButton, stacked && styles.surahButtonStacked, { backgroundColor: pressed ? th.bg : th.surface, borderColor: th.hairline }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.surahName, { color: th.text }]} numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            <Text style={[TYPE.caption, { color: th.textMuted }]} numberOfLines={1}>
              {lang === 'ar' ? meta : meta.replace('، ', ', ')}
            </Text>
          ) : null}
        </View>
        <Icon name="chevronDown" size={18} color={th.textMuted} />
      </Pressable>
      <AyahField
        label={t('fromAyah')}
        value={sel?.start.ayah ?? null}
        max={maxAyah}
        disabled={!ayahs}
        stacked={stacked}
        testID="from-ayah"
        onCommit={(n) => setRange(n, Math.max(n, sel?.end.ayah ?? n))}
      />
      <AyahField
        label={t('toAyah')}
        value={sel?.end.ayah ?? null}
        max={maxAyah}
        disabled={!ayahs}
        stacked={stacked}
        testID="to-ayah"
        onCommit={(n) => setRange(Math.min(n, sel?.start.ayah ?? n), n)}
      />
    </View>
  )
}

function AyahField({
  label,
  value,
  max,
  disabled,
  stacked,
  onCommit,
  testID,
}: {
  label: string
  value: number | null
  max: number
  disabled?: boolean
  stacked?: boolean
  onCommit: (n: number) => void
  testID?: string
}) {
  const th = useTheme()
  const { lang } = useT()
  const shown = value === null ? '' : lang === 'ar' ? toIndic(String(value)) : String(value)
  // while the field has focus it shows the draft being typed; otherwise always the selection's ayah
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  const commit = () => {
    if (draft === null) return
    const n = parseCount(draft)
    if (n !== null && max > 0) onCommit(Math.min(n, max))
  }

  return (
    <View style={stacked ? styles.fieldStacked : styles.field}>
      <Text style={[TYPE.caption, { color: th.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        editable={!disabled}
        value={draft ?? shown}
        onChangeText={(v) => setDraft(lang === 'ar' ? toIndic(fromIndic(v)) : fromIndic(v))}
        onFocus={() => {
          setFocused(true)
          setDraft(shown)
        }}
        onBlur={() => {
          commit()
          setDraft(null)
          setFocused(false)
        }}
        onSubmitEditing={() => {
          commit()
          setDraft(null)
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        returnKeyType="done"
        maxLength={3}
        selectTextOnFocus
        style={[
          styles.input,
          {
            color: th.text,
            backgroundColor: th.surface,
            borderColor: focused ? th.focus : th.hairline,
          },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE.sm },
  rowStacked: { flexWrap: 'wrap' },
  surahButton: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH + 12,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  surahButtonStacked: { flexBasis: '100%' },
  surahName: { fontFamily: FAMILY.displaySemiBold, fontSize: 20, lineHeight: 28 },
  // 68 px holds «من الآية» / "From verse" (65 px) and three digits, and leaves the surah button room for
  // the longest English names at 390 px ("Al-Mumtahanah", 152 px).
  field: { width: 68, gap: 2 },
  fieldStacked: { flexGrow: 1, flexBasis: 100, gap: 2 },
  input: {
    height: TOUCH + 12,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    textAlign: 'center',
    fontFamily: FAMILY.uiMedium,
    fontSize: 18,
  },
})
