// Quiet building blocks. Hierarchy comes from type and spacing, not from boxes: one control radius,
// round chips, hairlines instead of shadows. Selected options are inked (neutral), never coloured —
// colour is reserved for meaning (malachite = primary action, gold = the Quran selection, rubric = warning).
import { use, useEffect, useEffectEvent, useState, type ComponentRef, type ReactNode, type Ref } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { uiPlatform } from '../platform'
import { SheetHistoryContext } from '../sheetHistory'
import { useIsWide, useReducedMotion, useTheme } from '../theme'
import { FAMILY, RADIUS, SPACE, TOUCH, TYPE, type Theme } from '../tokens'
import { Icon, type IconName } from './Icon'

// ───────────────────────── text ─────────────────────────

export function SectionTitle({ children, trailing }: { children: string; trailing?: ReactNode }) {
  const th = useTheme()
  return (
    <View style={styles.sectionHead}>
      <Text accessibilityRole="header" style={[TYPE.section, { color: th.text }]}>
        {children}
      </Text>
      {trailing}
    </View>
  )
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const th = useTheme()
  return <Text style={[TYPE.label, { color: th.text }, style]}>{children}</Text>
}

export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const th = useTheme()
  return (
    <Text numberOfLines={numberOfLines} style={[TYPE.small, { color: th.textMuted }, style]}>
      {children}
    </Text>
  )
}

// ───────────────────────── buttons ─────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'onStage'

export function Button({
  label,
  onPress,
  variant = 'secondary',
  icon,
  iconEnd,
  rtl,
  disabled,
  busy,
  compact,
  accessibilityLabel,
  describedBy,
  hint,
  testID,
  style,
  ref,
}: {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  icon?: IconName
  /** a glyph after the label (e.g. «التالي» with a chevron pointing on) */
  iconEnd?: IconName
  /** writing direction for logical chevrons (Icon) */
  rtl?: boolean
  disabled?: boolean
  busy?: boolean
  compact?: boolean
  accessibilityLabel?: string
  /** the nativeID of a text on screen that says more (e.g. why the button is disabled): web aria-describedby */
  describedBy?: string
  /** the same for native screen readers (accessibilityHint) */
  hint?: string
  testID?: string
  style?: StyleProp<ViewStyle>
  /** e.g. to move keyboard focus here (useFocusOnMount) */
  ref?: Ref<ComponentRef<typeof Pressable>>
}) {
  const th = useTheme()
  const colors = buttonColors(th, variant)
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={hint}
      {...(describedBy ? uiPlatform.describedBy(describedBy) : null)}
      aria-disabled={!!disabled}
      aria-busy={!!busy}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        {
          backgroundColor: pressed ? colors.pressed : colors.bg,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.fg} /> : icon ? <Icon name={icon} size={compact ? 16 : 18} color={colors.fg} rtl={rtl} /> : null}
      <Text style={[compact ? TYPE.label : TYPE.bodyMedium, { color: colors.fg }]} numberOfLines={1}>
        {label}
      </Text>
      {iconEnd ? <Icon name={iconEnd} size={compact ? 16 : 18} color={colors.fg} rtl={rtl} /> : null}
    </Pressable>
  )
}

function buttonColors(th: Theme, v: ButtonVariant) {
  switch (v) {
    case 'primary':
      return { bg: th.primary, pressed: th.primaryPressed, fg: th.onPrimary, border: th.primary }
    case 'secondary':
      return { bg: th.surface, pressed: th.bg, fg: th.text, border: th.hairline }
    case 'quiet':
      return { bg: 'transparent', pressed: th.primaryTint, fg: th.link, border: 'transparent' }
    case 'onStage':
      return { bg: 'rgba(236,230,216,0.10)', pressed: 'rgba(236,230,216,0.18)', fg: th.onStage, border: 'rgba(236,230,216,0.18)' }
  }
}

export function IconButton({
  icon,
  label,
  onPress,
  color,
  size = TOUCH,
  disabled,
  testID,
  style,
  rtl,
}: {
  icon: IconName
  label: string
  onPress: () => void
  color?: string
  size?: number
  disabled?: boolean
  testID?: string
  style?: StyleProp<ViewStyle>
  /** writing direction for the logical chevrons (Icon) */
  rtl?: boolean
}) {
  const th = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 },
        pressed && { backgroundColor: th.primaryTint },
        style,
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.46)} color={color ?? th.text} rtl={rtl} />
    </Pressable>
  )
}

// ───────────────────────── chips & toggles ─────────────────────────

export function Chip({
  label,
  selected,
  onPress,
  accessory,
  accessibilityLabel,
  testID,
  role = 'radio',
}: {
  label: string
  selected: boolean
  onPress: () => void
  accessory?: ReactNode
  accessibilityLabel?: string
  testID?: string
  role?: 'radio' | 'button'
}) {
  const th = useTheme()
  const inked = th.text
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      aria-checked={role === 'radio' ? selected : undefined}
      aria-selected={role === 'radio' ? undefined : selected}
      onPress={onPress}
      {...(role === 'radio' ? uiPlatform.spaceToPress(onPress) : {})}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? inked : pressed ? th.primaryTint : 'transparent',
          borderColor: selected ? inked : th.hairline,
        },
      ]}
    >
      {accessory}
      <Text style={[TYPE.label, { color: selected ? th.bg : th.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chipRow}>
      {children}
    </View>
  )
}

/** A full-width row with a label (and optional hint) and a switch at the end. */
export function ToggleRow({
  label,
  hint,
  hideHint = false,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string
  hint?: string
  /** keep the hint for native screen readers only (a tight space, e.g. the step flow's band under the Mushaf) */
  hideHint?: boolean
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  testID?: string
}) {
  const th = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      aria-checked={value}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={() => onChange(!value)}
      {...(disabled ? {} : uiPlatform.spaceToPress(() => onChange(!value)))}
      style={({ pressed }) => [styles.toggleRow, pressed && { backgroundColor: th.primaryTint }, disabled && { opacity: 0.5 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[TYPE.body, { color: th.text }]}>{label}</Text>
        {hint && !hideHint ? <Text style={[TYPE.caption, { color: th.textMuted }]}>{hint}</Text> : null}
      </View>
      <SwitchGlyph on={value} />
    </Pressable>
  )
}

export function SwitchGlyph({ on }: { on: boolean }) {
  const th = useTheme()
  const reduced = useReducedMotion()
  return (
    // off = an outlined track with a muted thumb, on = an inked track: legible in both themes
    <View
      style={[
        styles.track,
        { backgroundColor: on ? th.text : 'transparent', borderColor: on ? th.text : th.textMuted },
        uiPlatform.webStyle(reduced ? {} : { transitionProperty: 'background-color', transitionDuration: '160ms' }),
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: on ? th.bg : th.textMuted, alignSelf: on ? 'flex-end' : 'flex-start' }]} />
    </View>
  )
}

// ───────────────────────── feedback ─────────────────────────

/** What happened + what to do, with an optional action. Rubric edge, quiet tint. */
export function InlineError({ message, actionLabel, onAction, testID }: { message: string; actionLabel?: string; onAction?: () => void; testID?: string }) {
  const th = useTheme()
  return (
    <View testID={testID} accessibilityRole="alert" style={[styles.notice, { backgroundColor: th.warnTint, borderStartColor: th.warn }]}>
      <Icon name="alert" size={18} color={th.warn} />
      <View style={{ flex: 1, gap: SPACE.sm }}>
        <Text style={[TYPE.small, { color: th.text }]}>{message}</Text>
        {actionLabel && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} style={styles.noticeAction}>
            <Text style={[TYPE.label, { color: th.link }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

/** Neutral information (no colour). */
export function Note({ children, icon }: { children: ReactNode; icon?: IconName }) {
  const th = useTheme()
  return (
    <View style={styles.note}>
      {icon ? <Icon name={icon} size={16} color={th.textMuted} /> : null}
      <Text style={[TYPE.caption, { color: th.textMuted, flex: 1 }]}>{children}</Text>
    </View>
  )
}

export function SkeletonLine({ width = '100%', height = 14, style }: { width?: ViewStyle['width']; height?: number; style?: StyleProp<ViewStyle> }) {
  const th = useTheme()
  return <View style={[{ width, height, borderRadius: height / 2, backgroundColor: th.skeleton }, style]} />
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const th = useTheme()
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: th.hairline }, style]} />
}

export function ProgressBar({ ratio, color, track }: { ratio: number; color?: string; track?: string }) {
  const th = useTheme()
  const reduced = useReducedMotion()
  const pct = `${Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10}%` as const
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: track ?? th.hairline, overflow: 'hidden' }}>
      <View
        style={[
          { height: 6, width: pct, backgroundColor: color ?? th.primary, borderRadius: 3 },
          uiPlatform.webStyle(reduced ? {} : { transitionProperty: 'width', transitionDuration: '200ms' }),
        ]}
      />
    </View>
  )
}

// ───────────────────────── sheet ─────────────────────────

/**
 * A modal sheet: bottom sheet on phones, centred dialog on wide screens. Escape / back closes it
 * (onRequestClose). Opens with a slide (or no motion when reduce-motion is on). In the narrow step flow it also
 * takes a history entry while open (SheetHistoryContext), so the browser's Back closes it.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  scroll = true,
  tall = false,
  testID,
  closeLabel,
}: {
  visible: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  scroll?: boolean
  /** a fixed, tall sheet (searchable lists), so filtering does not make it jump */
  tall?: boolean
  testID?: string
  closeLabel: string
}) {
  const th = useTheme()
  const wide = useIsWide()
  const reduced = useReducedMotion()
  const history = use(SheetHistoryContext)
  const closeFromHistory = useEffectEvent(() => onClose())
  // the entry is added in the commit of the tap that opened the sheet (React flushes it before the tap's task ends)
  useEffect(() => {
    if (!history || !visible) return
    const token = history.opened(() => closeFromHistory())
    return () => history.closed(token)
  }, [history, visible])
  const body = scroll ? (
    <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
  )
  return (
    <Modal visible={visible} transparent animationType={reduced ? 'none' : wide ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.sheetRoot, wide ? styles.sheetRootWide : null]}>
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: th.scrim }]} />
        <View
          testID={testID}
          aria-modal
          role="dialog"
          aria-label={title}
          style={[
            styles.sheet,
            { backgroundColor: th.surface, borderColor: th.hairline },
            wide ? styles.sheetWide : styles.sheetNarrow,
            tall ? (wide ? styles.sheetTallWide : styles.sheetTallNarrow) : null,
            uiPlatform.webStyle({ paddingBottom: 'env(safe-area-inset-bottom)' }),
          ]}
        >
          <View style={styles.sheetHead}>
            <Text accessibilityRole="header" style={[TYPE.section, { color: th.text, flex: 1 }]} numberOfLines={1}>
              {title}
            </Text>
            <IconButton icon="close" label={closeLabel} onPress={onClose} testID={testID ? `${testID}-close` : undefined} />
          </View>
          {body}
          {footer ? <View style={[styles.sheetFoot, { borderTopColor: th.hairline }]}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  )
}

/** Search box for the pickers: the focus ring is drawn around the whole field, icon included. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  inputRef,
  testID,
}: {
  value: string
  onChangeText: (text: string) => void
  placeholder: string
  onSubmit?: () => void
  inputRef?: Ref<ComponentRef<typeof TextInput>>
  testID?: string
}) {
  const th = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View
      style={[
        styles.search,
        { borderColor: focused ? th.focus : th.hairline, backgroundColor: th.bg },
        focused ? (uiPlatform.webStyle({ outlineColor: th.focus, outlineStyle: 'solid', outlineWidth: 1 }) as ViewStyle) : null,
      ]}
    >
      <Icon name="search" size={18} color={focused ? th.text : th.textMuted} />
      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={th.textFaint}
        accessibilityLabel={placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.searchInput, { color: th.text }, uiPlatform.webStyle({ outlineStyle: 'none' }) as TextStyle]}
      />
    </View>
  )
}

/** Hook for a simple open/close flag. */
export function useToggle(initial = false): [boolean, () => void, () => void] {
  const [on, setOn] = useState(initial)
  return [on, () => setOn(true), () => setOn(false)]
}

export const quranFamily = FAMILY.quran

/** Drawn nowhere, still read by screen readers (and focusable when the element is). */
export const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 } as const

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, marginBottom: SPACE.sm },
  button: {
    minHeight: TOUCH,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
  },
  buttonCompact: { minHeight: 36, paddingHorizontal: SPACE.md },
  chip: {
    minHeight: 38,
    paddingHorizontal: SPACE.md + 2,
    borderRadius: RADIUS.chip,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  toggleRow: { minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xs, borderRadius: RADIUS.small },
  track: { width: 44, height: 26, borderRadius: 13, borderWidth: 2, padding: 2, justifyContent: 'center' },
  thumb: { width: 18, height: 18, borderRadius: 9 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    padding: SPACE.md,
    borderStartWidth: 3,
    borderRadius: RADIUS.small,
  },
  noticeAction: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetRootWide: { justifyContent: 'center', alignItems: 'center', padding: SPACE.xl },
  sheet: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sheetNarrow: { borderTopStartRadius: RADIUS.sheet, borderTopEndRadius: RADIUS.sheet, maxHeight: '88%', width: '100%' },
  sheetWide: { borderRadius: RADIUS.sheet, width: 560, maxWidth: '100%', maxHeight: '86%' },
  sheetTallNarrow: { height: '88%' },
  sheetTallWide: { height: '86%' },
  search: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, borderWidth: 1, borderRadius: RADIUS.control, paddingHorizontal: SPACE.md },
  searchInput: { flex: 1, minWidth: 0, height: TOUCH, fontFamily: FAMILY.ui, fontSize: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingStart: SPACE.lg, paddingEnd: SPACE.sm, paddingTop: SPACE.sm, paddingBottom: SPACE.xs },
  sheetFoot: { borderTopWidth: StyleSheet.hairlineWidth, padding: SPACE.lg, gap: SPACE.sm },
})
