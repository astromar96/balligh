// Surah picker: search by Arabic or English name or number (Arabic-Indic digits too), and the Quran text itself
// (data.searchQuran) — a text hit jumps to its ayah. Every opening starts with an empty search (useOpenSession).
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as data from '../../data'
import { describeError, isAbortError } from '../safe'
import { toIndic } from '../format'
import { useOpenSession, useT } from '../hooks'
import { filterSurahs, TEXT_HIT_LIMIT, textQuery, type TextHit } from '../search'
import { useAppStore } from '../store'
import { useTheme } from '../theme'
import { FAMILY, SPACE, TYPE } from '../tokens'
import { Icon } from './Icon'
import { InlineError, Muted, SearchField, Sheet, SkeletonLine } from './primitives'

export function SurahPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT()
  const session = useOpenSession(visible)
  return (
    <Sheet visible={visible} onClose={onClose} title={t('chooseSurah')} scroll={false} tall testID="surah-picker" closeLabel={t('close')}>
      <PickerBody key={session} visible={visible} onClose={onClose} />
    </Sheet>
  )
}

function PickerBody({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const th = useTheme()
  const { t, lang, n, count } = useT()
  const surahs = useAppStore((s) => s.surahs)
  const status = useAppStore((s) => s.surahsStatus)
  const error = useAppStore((s) => s.surahsError)
  const current = useAppStore((s) => s.surah)
  const loadSurahs = useAppStore((s) => s.loadSurahs)
  const openSurah = useAppStore((s) => s.openSurah)
  const [query, setQuery] = useState('')
  // hits are kept with the query they answer, so a stale answer is never shown for a newer query
  const [found, setFound] = useState<{ query: string; hits: TextHit[] }>({ query: '', hits: [] })
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null)

  useEffect(() => {
    if (!visible) return
    loadSurahs()
    const id = setTimeout(() => inputRef.current?.focus(), 250)
    return () => clearTimeout(id)
  }, [visible, loadSurahs])

  const filtered = useMemo(() => (surahs ? filterSurahs(surahs, query) : []), [surahs, query])

  // full-text search, debounced and abortable
  const textQ = textQuery(query)
  useEffect(() => {
    if (!textQ) return
    const ctrl = new AbortController()
    const id = setTimeout(() => {
      data.searchQuran(textQ, TEXT_HIT_LIMIT, ctrl.signal).then(
        (hits) => {
          if (!ctrl.signal.aborted) setFound({ query: textQ, hits: hits.slice(0, TEXT_HIT_LIMIT) })
        },
        (e) => {
          if (!ctrl.signal.aborted && !isAbortError(e)) setFound({ query: textQ, hits: [] })
        },
      )
    }, 300)
    return () => {
      clearTimeout(id)
      ctrl.abort()
    }
  }, [textQ])
  const hits = textQ && found.query === textQ ? found.hits : []

  const choose = (num: number, ayah?: number) => {
    onClose()
    if (ayah) {
      const sel = { surah: num, start: { ayah, word: 1 }, end: { ayah, word: Number.MAX_SAFE_INTEGER } }
      openSurah(num, { selection: sel, scrollTo: ayah })
    } else if (num !== current || !useAppStore.getState().ayahs) {
      openSurah(num)
    }
  }

  const surahName = (num: number) => surahs?.find((s) => s.number === num)?.[lang === 'ar' ? 'nameArabic' : 'nameSimple'] ?? n(num)

  return (
    <>
      <View style={{ paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm }}>
        <SearchField
          inputRef={inputRef}
          testID="surah-search"
          value={query}
          onChangeText={setQuery}
          placeholder={t('searchSurahOrText')}
          onSubmit={() => {
            if (filtered[0]) choose(filtered[0].number)
          }}
        />
      </View>
      {status === 'error' ? (
        <View style={{ padding: SPACE.lg }}>
          <InlineError
            message={describeError(lang, 'whatSurahs', error)}
            actionLabel={t('retry')}
            onAction={() => {
              useAppStore.setState({ surahsStatus: 'idle' })
              loadSurahs()
            }}
          />
        </View>
      ) : !surahs ? (
        <View style={{ padding: SPACE.lg, gap: SPACE.lg }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonLine key={i} width={i % 2 ? '70%' : '85%'} height={18} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => String(s.number)}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          style={{ flexGrow: 0 }}
          ListEmptyComponent={hits.length === 0 ? <Muted style={{ padding: SPACE.lg }}>{t('noResults')}</Muted> : undefined}
          ListFooterComponent={
            hits.length > 0 ? (
              <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, gap: SPACE.xs }}>
                <Text style={[TYPE.label, { color: th.textMuted }]}>{t('searchInText')}</Text>
                {hits.map((h) => (
                  <Pressable
                    key={`${h.surah}:${h.ayah}`}
                    testID={`hit-${h.surah}-${h.ayah}`}
                    accessibilityRole="button"
                    onPress={() => choose(h.surah, h.ayah)}
                    style={({ pressed }) => [styles.hit, { borderColor: th.hairline }, pressed && { backgroundColor: th.primaryTint }]}
                  >
                    <Text style={[TYPE.label, { color: th.text }]}>
                      {surahName(h.surah)} {n(h.ayah)}
                    </Text>
                    {h.text ? (
                      <Text style={[styles.hitText, { color: th.textMuted }]} numberOfLines={2}>
                        {h.text}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : undefined
          }
          renderItem={({ item }) => {
            const selected = item.number === current
            return (
              <Pressable
                testID={`surah-${item.number}`}
                accessibilityRole="button"
                aria-selected={selected}
                accessibilityLabel={`${n(item.number)} ${item.nameArabic} ${item.nameSimple}`}
                onPress={() => choose(item.number)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: th.primaryTint }, selected && { backgroundColor: th.bg }]}
              >
                <Text style={[styles.num, { color: th.textMuted }]}>{lang === 'ar' ? toIndic(String(item.number)) : item.number}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[TYPE.bodyMedium, { color: th.text }]} numberOfLines={1}>
                    {lang === 'ar' ? item.nameArabic : item.nameSimple}
                  </Text>
                  <Text style={[TYPE.caption, { color: th.textMuted }]} numberOfLines={1}>
                    {lang === 'ar' ? `${item.nameSimple}، ${item.nameTranslated}` : `${item.nameArabic}, ${item.nameTranslated}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[TYPE.caption, { color: th.text }]}>{count(item.versesCount, 'ayah')}</Text>
                  <Text style={[TYPE.caption, { color: th.textMuted }]}>{t(item.revelationPlace === 'makkah' ? 'makki' : 'madani')}</Text>
                </View>
                {selected ? <Icon name="check" size={18} color={th.text} /> : <View style={{ width: 18 }} />}
              </Pressable>
            )
          }}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.lg, minHeight: 60, paddingVertical: SPACE.xs },
  num: { width: 30, textAlign: 'center', fontFamily: FAMILY.uiMedium, fontSize: 14 },
  hit: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: SPACE.sm, gap: 2 },
  hitText: { fontFamily: FAMILY.quran, fontSize: 18, lineHeight: 34, writingDirection: 'rtl' },
})
