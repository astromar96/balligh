// Reciter section + picker. Arabic names, style, a badge for word timings (classes A/B) and what the others do
// instead (C/D: whole ayahs, the ayah highlighted — D4), the isti'adha toggle for reciters who recorded it in their
// own voice (D7). "Listen" plays the first ayah of the current passage in that voice.
// The list itself (ReciterList) is shared by the picker sheet (wide layout) and the reciter step (narrow layout).
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { Reciter } from '../../core/types'
import * as data from '../../data'
import * as domain from '../../domain'
import * as media from '../../media'
import type { PreviewPlayer } from '../../media'
import { findReciter, runAudioPipeline, useCompose } from '../compose'
import { useT } from '../hooks'
import type { MessageKey } from '../i18n'
import { uiPlatform } from '../platform'
import { describeError, isAbortError } from '../safe'
import { normalizeLocal } from '../selection'
import { useAppStore } from '../store'
import { useTheme } from '../theme'
import { RADIUS, SPACE, TOUCH, TYPE } from '../tokens'
import { Icon } from './Icon'
import { Note, SectionTitle, Sheet, ToggleRow } from './primitives'

const STYLE_KEY: Record<string, MessageKey> = { murattal: 'murattal', mujawwad: 'mujawwad', muallim: 'muallim' }

export function ReciterSection({ onOpen }: { onOpen: () => void }) {
  const th = useTheme()
  const { t, lang } = useT()
  const reciterId = useAppStore((s) => s.reciterId)
  const istiadha = useAppStore((s) => s.istiadha)
  const setIstiadha = useAppStore((s) => s.setIstiadha)
  const reciter = findReciter(reciterId)
  return (
    <View style={styles.section}>
      <SectionTitle>{t('reciter')}</SectionTitle>
      <Pressable
        testID="reciter-button"
        accessibilityRole="button"
        accessibilityLabel={`${t('chooseReciter')}: ${reciter ? (lang === 'ar' ? reciter.nameAr : reciter.nameEn) : reciterId}`}
        onPress={onOpen}
        style={({ pressed }) => [styles.current, { borderColor: th.hairline, backgroundColor: pressed ? th.bg : th.surface }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[TYPE.title, { color: th.text }]} numberOfLines={1}>
            {reciter ? (lang === 'ar' ? reciter.nameAr : reciter.nameEn) : reciterId}
          </Text>
          {reciter ? <ReciterMeta reciter={reciter} /> : <Text style={[TYPE.caption, { color: th.textMuted }]}>{t('chooseReciter')}</Text>}
        </View>
        <Text style={[TYPE.label, { color: th.link }]}>{t('chooseReciter')}</Text>
      </Pressable>
      {reciter?.istiadha ? (
        <ToggleRow label={t('istiadha')} hint={t('istiadhaHint')} value={istiadha} onChange={setIstiadha} testID="istiadha-toggle" />
      ) : null}
    </View>
  )
}

function ReciterMeta({ reciter, inPicker }: { reciter: Reciter; inPicker?: boolean }) {
  const th = useTheme()
  const { t, lang } = useT()
  const styleKey = reciter.style ? STYLE_KEY[reciter.style] : undefined
  return (
    <View style={styles.metaRow}>
      {styleKey ? <Text style={[TYPE.caption, { color: th.textMuted }]}>{t(styleKey)}</Text> : null}
      {lang === 'ar' ? null : <Text style={[TYPE.caption, { color: th.textMuted }]}>{reciter.nameAr}</Text>}
      {reciter.wordTimings ? (
        <View style={[styles.badge, { borderColor: th.hairline }]} accessibilityLabel={t('wordTimingsHint')}>
          <Icon name="check" size={12} color={th.text} />
          <Text style={[TYPE.caption, { color: th.text }]}>{t('wordTimings')}</Text>
        </View>
      ) : (
        <Text style={[TYPE.caption, { color: th.textMuted }]} accessibilityLabel={t('ayahLevelHint')}>
          {t('ayahLevel')}
        </Text>
      )}
      {inPicker && reciter.istiadha ? <Text style={[TYPE.caption, { color: th.textMuted }]}>{t('withIstiadha')}</Text> : null}
    </View>
  )
}

export type ReciterPreview = ReturnType<typeof useReciterPreview>

/** Plays the first ayah of the current passage in a given voice; one at a time; stops on close and on unmount. */
export function useReciterPreview() {
  const [state, setState] = useState<{ id: string | null; status: 'idle' | 'loading' | 'playing' | 'error'; error: unknown }>({
    id: null,
    status: 'idle',
    error: null,
  })
  const player = useRef<PreviewPlayer | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    ctrl.current?.abort()
    ctrl.current = null
    const p = player.current
    player.current = null
    if (p) {
      try {
        p.pause()
        p.dispose()
      } catch {
        // already gone
      }
    }
    setState({ id: null, status: 'idle', error: null })
  }, [])

  const play = useCallback(
    (reciter: Reciter) => {
      stop()
      useCompose.getState().player?.pause()
      const { surah, ayahs, selection } = useAppStore.getState()
      if (!ayahs || ayahs.length === 0) return
      const first = selection ? normalizeLocal(selection).start.ayah : 1
      const sel = domain.ayahRangeSelection(surah, first, first, ayahs)
      const c = new AbortController()
      ctrl.current = c
      setState({ id: reciter.id, status: 'loading', error: null })
      runAudioPipeline({ surah, ayahs, selection: sel, reciter, signal: c.signal, capMs: Number.POSITIVE_INFINITY })
        .then(async (res) => {
          if (c.signal.aborted) return
          const p = media.createPreviewPlayer(res.assembled.audio)
          player.current = p
          p.onEnded(() => {
            if (player.current === p) stop()
          })
          await p.play(0)
          if (!c.signal.aborted) setState({ id: reciter.id, status: 'playing', error: null })
        })
        .catch((error) => {
          if (c.signal.aborted || isAbortError(error)) return
          setState({ id: reciter.id, status: 'error', error })
        })
    },
    [stop],
  )

  useEffect(() => stop, [stop])
  return { state, play, stop }
}

export function ReciterPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT()
  const setReciter = useAppStore((s) => s.setReciter)
  const preview = useReciterPreview()

  // every way out of the sheet goes through here (close button, backdrop, Escape, choosing a reciter)
  const close = () => {
    preview.stop()
    onClose()
  }

  return (
    <Sheet visible={visible} onClose={close} title={t('chooseReciter')} scroll={false} testID="reciter-picker" closeLabel={t('close')}>
      <ReciterList
        preview={preview}
        style={{ flexGrow: 0 }}
        onChoose={(id) => {
          setReciter(id)
          close()
        }}
      />
    </Sheet>
  )
}

/**
 * Every reciter as a radio row with a «استمع» button, and the notes under them. `onChoose` decides what a choice does
 * (the sheet also closes; the step only selects). `istiadhaInline` shows the isti'adha switch under the chosen row
 * when that reciter recorded one (the step has no separate reciter section for it). `revealCurrent` opens the list
 * with the chosen reciter in view (the step: coming back to change it, the choice may be far down the list).
 */
export function ReciterList({
  preview,
  onChoose,
  istiadhaInline = false,
  revealCurrent = false,
  header,
  style,
}: {
  preview: ReciterPreview
  onChoose: (id: string) => void
  istiadhaInline?: boolean
  revealCurrent?: boolean
  header?: ReactElement
  style?: StyleProp<ViewStyle>
}) {
  const th = useTheme()
  const { t, lang } = useT()
  const current = useAppStore((s) => s.reciterId)
  const istiadha = useAppStore((s) => s.istiadha)
  const setIstiadha = useAppStore((s) => s.setIstiadha)
  const listRef = useRef<FlatList<Reciter>>(null)
  const revealTries = useRef(0)
  useEffect(() => {
    if (!revealCurrent) return
    const index = data.RECITERS.findIndex((r) => r.id === useAppStore.getState().reciterId)
    if (index <= 0) return
    const timer = setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false }), 0)
    return () => clearTimeout(timer)
  }, [revealCurrent])
  return (
    <FlatList
      ref={listRef}
      data={data.RECITERS}
      keyExtractor={(r) => r.id}
      style={style}
      // the step lays out every row at once (a few dozen), so the chosen one can be scrolled to straight away
      initialNumToRender={revealCurrent ? data.RECITERS.length : 12}
      onScrollToIndexFailed={(info) => {
        // not measured yet: get near it, then try again (a few times at most)
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })
        revealTries.current += 1
        if (revealTries.current <= 3) setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.3, animated: false }), 80)
      }}
      ListHeaderComponent={header}
      ListFooterComponent={
        <View style={{ padding: SPACE.lg, gap: SPACE.sm }}>
          <Note icon="info">{t('ayahFallbackNote')}</Note>
          <Note icon="alert">{t('copyrightNote')}</Note>
        </View>
      }
      renderItem={({ item }) => {
        const selected = item.id === current
        const mine = preview.state.id === item.id
        const choose = () => onChoose(item.id)
        return (
          // the chosen row stands out from what it sits on: the sheet is white, the step sits on the chrome
          <View style={selected && { backgroundColor: istiadhaInline ? th.surface : th.bg }}>
            <View style={styles.row}>
              <Pressable
                testID={`reciter-${item.id}`}
                accessibilityRole="radio"
                aria-checked={selected}
                accessibilityLabel={lang === 'ar' ? item.nameAr : item.nameEn}
                onPress={choose}
                {...uiPlatform.spaceToPress(choose)}
                style={({ pressed }) => [styles.rowMain, pressed && { backgroundColor: th.primaryTint }]}
              >
                <View style={[styles.radio, { borderColor: selected ? th.text : th.hairline }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: th.text }]} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[TYPE.bodyMedium, { color: th.text }]} numberOfLines={1}>
                    {lang === 'ar' ? item.nameAr : item.nameEn}
                  </Text>
                  <ReciterMeta reciter={item} inPicker />
                  {mine && preview.state.status === 'error' ? (
                    <Text style={[TYPE.caption, { color: th.warn }]}>{describeError(lang, 'whatAudio', preview.state.error)}</Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                testID={`listen-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={mine && preview.state.status === 'playing' ? t('stopListening') : t('listenLabel', { name: lang === 'ar' ? item.nameAr : item.nameEn })}
                onPress={() => (mine && preview.state.status !== 'error' ? preview.stop() : preview.play(item))}
                style={({ pressed }) => [styles.listen, { borderColor: th.hairline, backgroundColor: pressed ? th.primaryTint : 'transparent' }]}
              >
                {mine && preview.state.status === 'loading' ? (
                  <ActivityIndicator size="small" color={th.text} />
                ) : (
                  <Icon name={mine && preview.state.status === 'playing' ? 'pause' : 'play'} size={16} color={th.text} />
                )}
                <Text style={[TYPE.caption, { color: th.text }]}>{mine && preview.state.status === 'playing' ? t('stopListening') : t('listen')}</Text>
              </Pressable>
            </View>
            {istiadhaInline && selected && item.istiadha ? (
              <View style={styles.rowExtra}>
                <ToggleRow label={t('istiadha')} hint={t('istiadhaHint')} value={istiadha} onChange={setIstiadha} testID="istiadha-toggle" />
              </View>
            ) : null}
          </View>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  section: { gap: SPACE.sm },
  current: { borderWidth: 1, borderRadius: RADIUS.control, padding: SPACE.md, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH + 16 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: SPACE.sm, rowGap: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: RADIUS.chip, paddingHorizontal: SPACE.sm, paddingVertical: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingEnd: SPACE.lg },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm, paddingStart: SPACE.lg, paddingEnd: SPACE.sm, minHeight: 64 },
  // under the chosen row, lined up with its name (after the radio)
  rowExtra: { paddingStart: SPACE.lg + 20 + SPACE.md, paddingEnd: SPACE.lg, paddingBottom: SPACE.sm },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  listen: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: RADIUS.chip, paddingHorizontal: SPACE.md, minHeight: 36 },
})
