// Design options: size, background (presets drawn by the renderer itself + «صورتك»), legibility
// (dim, blur, text tone, size), the elements drawn on the clip, and the video quality.
import * as ImagePicker from 'expo-image-picker'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import type { DesignOptions } from '../../core/types'
import { BACKGROUND_PRESETS, type BackgroundPreset } from '../../render'
import { useT } from '../hooks'
import { uiPlatform } from '../platform'
import { describeError } from '../safe'
import { useCompose } from '../compose'
import { useAppStore } from '../store'
import { ASPECTS, BLURS, ELEMENTS, OVERLAYS, nearestIndex } from '../options'
import { useTheme } from '../theme'
import { RADIUS, SPACE, TOUCH, TYPE } from '../tokens'
import { Icon } from './Icon'
import { Chip, ChipRow, Hairline, InlineError, Label, Muted, Note, SectionTitle, ToggleRow } from './primitives'
import { PresetThumb } from './PresetThumb'

/** `hideTitle`: the step flow shows its own step heading above the section. */
export function DesignSection({ hideTitle = false }: { hideTitle?: boolean }) {
  const th = useTheme()
  const { t } = useT()
  const design = useAppStore((s) => s.design)
  const setDesign = useAppStore((s) => s.setDesign)
  const quality = useAppStore((s) => s.exportQuality)
  const setQuality = useAppStore((s) => s.setExportQuality)
  const overlayIdx = nearestIndex(OVERLAYS.map((o) => o.v), design.overlay)
  const blurIdx = nearestIndex(BLURS.map((o) => o.v), design.blur)
  const pct = Math.round(design.fontScale * 100)

  return (
    <View style={styles.section} testID="design-section">
      {hideTitle ? null : <SectionTitle>{t('design')}</SectionTitle>}

      <Group label={t('aspect')}>
        <ChipRow label={t('aspect')}>
          {ASPECTS.map((a) => (
            <Chip
              key={a.aspect}
              testID={`aspect-${a.aspect}`}
              label={t(a.key)}
              accessibilityLabel={`${t(a.key)} ${a.aspect}`}
              selected={design.aspect === a.aspect}
              onPress={() => setDesign({ aspect: a.aspect })}
              accessory={<AspectGlyph ratio={a.ratio} color={design.aspect === a.aspect ? th.bg : th.textMuted} />}
            />
          ))}
        </ChipRow>
      </Group>

      <Group label={t('background')}>
        <BackgroundGrid />
      </Group>

      <Group label={t('overlay')}>
        <ChipRow label={t('overlay')}>
          {OVERLAYS.map((o, i) => (
            <Chip key={o.key} label={t(o.key)} selected={i === overlayIdx} onPress={() => setDesign({ overlay: o.v })} testID={`overlay-${o.key}`} />
          ))}
        </ChipRow>
      </Group>

      <Group label={t('blur')}>
        <ChipRow label={t('blur')}>
          {BLURS.map((o, i) => (
            <Chip key={o.key} label={t(o.key)} selected={i === blurIdx} onPress={() => setDesign({ blur: o.v })} testID={`blur-${o.key}`} />
          ))}
        </ChipRow>
      </Group>

      <View style={styles.twoUp}>
        <Group label={t('textTone')}>
          <ChipRow label={t('textTone')}>
            <Chip label={t('toneLight')} selected={design.textTone === 'light'} onPress={() => setDesign({ textTone: 'light' })} testID="tone-light" />
            <Chip label={t('toneDark')} selected={design.textTone === 'dark'} onPress={() => setDesign({ textTone: 'dark' })} testID="tone-dark" />
          </ChipRow>
        </Group>
        <Group label={t('fontScale')}>
          <Stepper
            value={`${pct}٪`}
            onMinus={() => setDesign({ fontScale: Math.max(0.75, Math.round((design.fontScale - 0.05) * 100) / 100) })}
            onPlus={() => setDesign({ fontScale: Math.min(1.4, Math.round((design.fontScale + 0.05) * 100) / 100) })}
            minusLabel={t('smaller')}
            plusLabel={t('larger')}
            canMinus={design.fontScale > 0.75 + 1e-6}
            canPlus={design.fontScale < 1.4 - 1e-6}
          />
        </Group>
      </View>

      <Group label={t('elements')}>
        <View>
          {ELEMENTS.map((e, i) => (
            <View key={e.field}>
              {i > 0 ? <Hairline /> : null}
              <ToggleRow
                label={t(e.key)}
                value={!!design[e.field]}
                onChange={(v) => setDesign({ [e.field]: v } as Partial<DesignOptions>)}
                testID={`el-${e.field}`}
              />
            </View>
          ))}
        </View>
        <Note>{t('creditsAlways')}</Note>
      </Group>

      <Group label={t('exportQuality')}>
        <ChipRow label={t('exportQuality')}>
          <Chip label={t('qualityHd')} selected={quality === 'hd'} onPress={() => setQuality('hd')} testID="quality-hd" />
          <Chip label={t('qualityFullHd')} selected={quality === 'fullhd'} onPress={() => setQuality('fullhd')} testID="quality-fullhd" />
        </ChipRow>
      </Group>
    </View>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Label>{label}</Label>
      {children}
    </View>
  )
}

function AspectGlyph({ ratio, color }: { ratio: number; color: string }) {
  const h = 16
  const w = Math.round(h * ratio)
  const box = ratio > 1 ? { width: 20, height: Math.round(20 / ratio) } : { width: w, height: h }
  return <View style={{ ...box, borderWidth: 1.5, borderColor: color, borderRadius: 2 }} />
}

function Stepper({
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  canMinus,
  canPlus,
}: {
  value: string
  onMinus: () => void
  onPlus: () => void
  minusLabel: string
  plusLabel: string
  canMinus: boolean
  canPlus: boolean
}) {
  const th = useTheme()
  const { lang } = useT()
  const shown = lang === 'ar' ? value.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : value.replace('٪', '%')
  return (
    <View style={[styles.stepper, { borderColor: th.hairline, backgroundColor: th.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={minusLabel} disabled={!canMinus} onPress={onMinus} style={[styles.stepBtn, !canMinus && { opacity: 0.35 }]} testID="font-smaller">
        <Icon name="minus" size={18} color={th.text} />
      </Pressable>
      <Text style={[TYPE.label, { color: th.text, minWidth: 52, textAlign: 'center' }]} aria-live="polite">
        {shown}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={plusLabel} disabled={!canPlus} onPress={onPlus} style={[styles.stepBtn, !canPlus && { opacity: 0.35 }]} testID="font-larger">
        <Icon name="plus" size={18} color={th.text} />
      </Pressable>
    </View>
  )
}

function BackgroundGrid() {
  const th = useTheme()
  const { t, lang } = useT()
  const design = useAppStore((s) => s.design)
  const setDesign = useAppStore((s) => s.setDesign)
  const bgSlot = useCompose((s) => s.bgImage)
  const presets = BACKGROUND_PRESETS
  const ratio = (() => {
    const [w, h] = design.aspect.split(':').map(Number)
    return w / h
  })()
  const thumbH = ratio > 1 ? 54 : 84
  const thumbW = Math.round(Math.min(132, Math.max(48, thumbH * ratio)))
  const selectedId = design.background.kind === 'preset' ? design.background.id : null
  const photo = design.background.kind === 'image' ? design.background.src : null

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, allowsEditing: false })
    if (res.canceled || !res.assets?.[0]) return
    const uri = res.assets[0].uri
    const prev = useAppStore.getState().design.background
    if (prev.kind === 'image' && prev.src !== uri) uiPlatform.releaseObjectUrl(prev.src)
    setDesign({ background: { kind: 'image', src: uri, focusX: 0.5, focusY: 0.5 }, textTone: 'light', overlay: Math.max(useAppStore.getState().design.overlay, 0.35) })
  }

  const choosePreset = (p: BackgroundPreset) => {
    const prev = useAppStore.getState().design.background
    if (prev.kind === 'image') uiPlatform.releaseObjectUrl(prev.src)
    setDesign({ background: { kind: 'preset', id: p.id }, textTone: p.tone })
  }

  return (
    <View style={{ gap: SPACE.sm }}>
      {presets.length === 0 ? <Muted>{t('presetsUnavailable')}</Muted> : null}
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t('background')}>
        {presets.map((p) => {
          const selected = p.id === selectedId
          return (
            <Pressable
              key={p.id}
              testID={`preset-${p.id}`}
              accessibilityRole="radio"
              accessibilityLabel={p.nameAr}
              aria-checked={selected}
              onPress={() => choosePreset(p)}
              {...uiPlatform.spaceToPress(() => choosePreset(p))}
              style={styles.tile}
            >
              <View style={[styles.tileRing, { borderColor: selected ? th.text : 'transparent' }]}>
                <PresetThumb preset={p} width={thumbW} height={thumbH} />
              </View>
              <Text style={[TYPE.caption, { color: selected ? th.text : th.textMuted, width: thumbW + 10, textAlign: 'center' }]} numberOfLines={2}>
                {p.nameAr}
              </Text>
            </Pressable>
          )
        })}
        <Pressable
          testID="preset-photo"
          accessibilityRole="radio"
          accessibilityLabel={t('yourPhoto')}
          accessibilityHint={t('yourPhotoHint')}
          aria-checked={!!photo}
          onPress={pickPhoto}
          {...uiPlatform.spaceToPress(pickPhoto)}
          style={styles.tile}
        >
          <View style={[styles.tileRing, { borderColor: photo ? th.text : 'transparent' }]}>
            {photo ? (
              <Image source={{ uri: photo }} style={{ width: thumbW, height: thumbH, borderRadius: 4 }} resizeMode="cover" accessibilityIgnoresInvertColors />
            ) : (
              <View style={[styles.photoTile, { width: thumbW, height: thumbH, borderColor: th.textFaint }]}>
                <Icon name="image" size={22} color={th.textMuted} />
              </View>
            )}
          </View>
          <Text style={[TYPE.caption, { color: photo ? th.text : th.textMuted }]} numberOfLines={1}>
            {t('yourPhoto')}
          </Text>
        </Pressable>
      </View>
      {bgSlot.status === 'error' ? <InlineError message={describeError(lang, 'whatImage', bgSlot.error)} /> : null}
      <Note>{photo ? t('photoNotInLink') : t('yourPhotoHint')}</Note>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: SPACE.lg },
  group: { gap: SPACE.sm },
  twoUp: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xl },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.chip, alignSelf: 'flex-start' },
  stepBtn: { width: TOUCH, height: 40, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
  tile: { alignItems: 'center', gap: 4 },
  tileRing: { borderWidth: 2, borderRadius: 7, padding: 2 },
  photoTile: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
})
