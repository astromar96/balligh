// The hero: the surah as a Mushaf page you can cut from. Text flows page by page (grouped by the
// printed page number) inside a double rule; tapping words lays a gold band over the selection.
// Every page is laid out (so jumps land exactly), but only the pages around the viewport are built
// word by word (LitePage vs PageBlock); a built page re-renders only when the selection touches it
// (pageSelectionKey). Al-Baqarah: 48 pages, 6,000+ words, ~3 built at a time.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent, type TextStyle } from 'react-native'
import type { Ayah, Selection, Surah, WordRef } from '../../core/types'
import { describeError } from '../safe'
import { ayahOrnament, keepHyphens } from '../format'
import { useT } from '../hooks'
import { uiPlatform } from '../platform'
import { contains, findAyah, firstWordOf, groupByPage, lastWordOf, pageIndexOfAyah, pageSelectionKey, type MushafPage } from '../selection'
import { currentSurah, useAppStore } from '../store'
import { useIsWide, useReducedMotion, useTheme, useWindowSizeSafe } from '../theme'
import { FAMILY, QURAN_LEADING, QURAN_SIZE, RADIUS, SPACE, TYPE, type Theme } from '../tokens'
import { InlineError, SkeletonLine } from './primitives'

const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'
// ayah ornaments stay buttons for screen readers but leave the Tab order to the panel (arrow keys)
const NOT_TABBABLE = { focusable: false } as object

export function MushafPanel({ fill }: { fill?: boolean }) {
  const th = useTheme()
  const wide = useIsWide()
  const { t, lang } = useT()
  const status = useAppStore((s) => s.ayahsStatus)
  const error = useAppStore((s) => s.ayahsError)
  const ayahs = useAppStore((s) => s.ayahs)
  const retry = useAppStore((s) => s.retryAyahs)
  const surah = useAppStore((s) => currentSurah(s))
  const surahNo = useAppStore((s) => s.surah)

  const fontSize = wide ? QURAN_SIZE.wide : QURAN_SIZE.narrow
  const height = fill ? undefined : wide ? undefined : 460

  return (
    <View
      style={[styles.frameOuter, { borderColor: th.frameOuter, backgroundColor: th.page }, fill ? { flex: 1 } : { height }]}
      testID="mushaf-panel"
    >
      <View style={[styles.frameInner, { borderColor: th.frameInner }]}>
        {status === 'error' ? (
          <View style={{ padding: SPACE.lg }}>
            <InlineError message={describeError(lang, 'whatAyahs', error)} actionLabel={t('retry')} onAction={retry} testID="mushaf-error" />
          </View>
        ) : status !== 'ready' || !ayahs ? (
          <MushafSkeleton fontSize={fontSize} label={t('loadingSurah')} />
        ) : (
          <MushafList key={surahNo} ayahs={ayahs} surah={surah} surahNo={surahNo} fontSize={fontSize} theme={th} />
        )}
      </View>
    </View>
  )
}

function MushafSkeleton({ fontSize, label }: { fontSize: number; label: string }) {
  const lineH = Math.round(fontSize * QURAN_LEADING)
  const widths = ['92%', '100%', '96%', '100%', '88%', '100%', '94%', '72%'] as const
  return (
    <View style={{ padding: SPACE.lg, gap: lineH - 16 }} accessibilityLabel={label} accessibilityRole="progressbar">
      <SkeletonLine width="56%" height={22} style={{ alignSelf: 'center', marginBottom: SPACE.md }} />
      {widths.map((w, i) => (
        <SkeletonLine key={i} width={w} height={16} />
      ))}
    </View>
  )
}

function MushafList({ ayahs, surah, surahNo, fontSize, theme }: { ayahs: Ayah[]; surah: Surah | null; surahNo: number; fontSize: number; theme: Theme }) {
  const { t, lang } = useT()
  const reduced = useReducedMotion()
  const selection = useAppStore((s) => s.selection)
  const pending = useAppStore((s) => s.pending)
  const cursor = useAppStore((s) => s.cursor)
  const scrollRequest = useAppStore((s) => s.scrollRequest)
  const tap = useAppStore((s) => s.tap)
  const moveCursor = useAppStore((s) => s.moveCursor)
  const setCursor = useAppStore((s) => s.setCursor)
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null)

  // the keyboard cursor is drawn only while the panel is driven from the keyboard; a tap hides it
  const [keyboardMode, setKeyboardMode] = useState(false)
  const shownCursor = keyboardMode ? cursor : null

  const pages = useMemo(() => groupByPage(ayahs), [ayahs])

  // ── light rendering ──
  // Every page is laid out, so the scroll height is real and a jump lands exactly where it should. Only
  // the pages around the viewport are built word by word (tappable, banded); the others are a few text
  // runs with the very same characters, so they wrap identically and swapping one for the other moves
  // nothing. Al-Baqarah: ~3 built pages instead of 48 (6,000+ words).
  const tops = useRef<number[]>([])
  const heights = useRef<number[]>([])
  const view = useRef({ y: 0, h: 600 })
  const [live, setLive] = useState<number[]>([0, 1, 2])
  const liveSet = useMemo(() => new Set(live), [live])

  const refreshLive = useCallback(
    (extra: number[] = []) => {
      const { y, h } = view.current
      const out = new Set<number>(extra)
      for (let i = 0; i < pages.length; i++) {
        const top = tops.current[i]
        const height = heights.current[i]
        if (top === undefined || height === undefined) continue
        if (top + height >= y - h && top <= y + 2 * h) out.add(i)
      }
      if (out.size === 0) return
      const next = [...out].sort((a, b) => a - b)
      setLive((cur) => (cur.join(',') === next.join(',') ? cur : next))
    },
    [pages.length],
  )

  const layoutPending = useRef(false)
  const onPageLayout = useCallback(
    (i: number, y: number, height: number) => {
      tops.current[i] = y
      heights.current[i] = height
      if (layoutPending.current) return
      layoutPending.current = true
      setTimeout(() => {
        layoutPending.current = false
        refreshLive()
      }, 0)
    },
    [refreshLive],
  )

  const onWord = useCallback(
    (ref: WordRef) => {
      setKeyboardMode(false)
      tap({ kind: 'word', ref })
    },
    [tap],
  )
  const onAyah = useCallback(
    (n: number) => {
      setKeyboardMode(false)
      tap({ kind: 'ayah', ayah: n })
    },
    [tap],
  )

  // ── bringing a requested word into view (deep link, search hit, from/to inputs, keyboard cursor) ──
  const reveal = useCallback(
    (ayah: number, word: number, align: 'top' | 'nearest'): boolean => {
      const node = (scrollRef.current as unknown as { getScrollableNode?: () => unknown } | null)?.getScrollableNode?.()
      const box = uiPlatform.boxWithin(node, `w-${ayah}-${word}`)
      if (!box) return false
      const inView = box.top >= box.scrollTop && box.bottom <= box.scrollTop + box.height
      if (align === 'nearest' && inView) return true
      const below = align === 'nearest' && box.bottom > box.scrollTop + box.height
      const y = Math.max(0, Math.round(below ? box.bottom - box.height + fontSize * 0.6 : box.top - fontSize * 0.4))
      scrollRef.current?.scrollTo({ y, animated: false })
      view.current = { ...view.current, y }
      return true
    },
    [fontSize],
  )

  useEffect(() => {
    if (!scrollRequest) return
    const index = pageIndexOfAyah(pages, scrollRequest.ayah)
    if (index < 0) return
    const { ayah } = scrollRequest
    const word = scrollRequest.word ?? firstWordOf(findAyah(ayahs, ayah))
    const align = scrollRequest.align ?? 'top'
    let tries = 0
    let jumped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const step = () => {
      tries += 1
      if (reveal(ayah, word, align)) return // web: the word is built, place it exactly
      const top = tops.current[index]
      if (top !== undefined && !jumped) {
        // the page is laid out (as plain text): go to it and have it built word by word
        jumped = true
        scrollRef.current?.scrollTo({ y: top, animated: false })
        view.current = { ...view.current, y: top }
        refreshLive([index])
        if (uiPlatform.os !== 'web') return // native: the page's top is as precise as it gets
      }
      if (tries < 40) timer = setTimeout(step, 50)
    }
    timer = setTimeout(step, 0)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [scrollRequest, pages, ayahs, reveal, refreshLive])

  const onKeyDown = useCallback(
    (e: NativeSyntheticEvent<{ key: string; shiftKey?: boolean }>) => {
      const key = e.nativeEvent.key
      const shift = !!e.nativeEvent.shiftKey
      if (key.startsWith('Arrow') || key === 'Enter' || key === ' ') setKeyboardMode(true)
      // reading order is right-to-left: ← moves forward through the text
      if (key === 'ArrowLeft' || key === 'ArrowDown') {
        moveCursor(1, shift)
        ;(e as unknown as { preventDefault?: () => void }).preventDefault?.()
      } else if (key === 'ArrowRight' || key === 'ArrowUp') {
        moveCursor(-1, shift)
        ;(e as unknown as { preventDefault?: () => void }).preventDefault?.()
      } else if (key === 'Enter' || key === ' ') {
        const c = useAppStore.getState().cursor
        if (c) {
          tap({ kind: 'word', ref: c })
          ;(e as unknown as { preventDefault?: () => void }).preventDefault?.()
        }
      } else if (key === 'Escape') {
        setCursor(null)
        setKeyboardMode(false)
      }
    },
    [moveCursor, setCursor, tap],
  )

  const quranStyle = useMemo<TextStyle>(
    () => ({
      fontFamily: FAMILY.quran,
      fontSize,
      lineHeight: Math.round(fontSize * QURAN_LEADING),
      color: theme.text,
      textAlign: 'justify',
      writingDirection: 'rtl',
    }),
    [fontSize, theme],
  )
  const juzLabel = useCallback((n: number) => t('juzNote', { n }), [t])
  const pageLabel = useCallback((n: number) => t('pageNote', { n }), [t])
  const ornamentLabel = useCallback((n: number) => t('ornamentLabel', { n }), [t])

  const name = surah?.nameArabic ?? ''
  return (
    <View
      style={{ flex: 1 }}
      focusable
      accessibilityLabel={t('mushafLabel', { name })}
      accessibilityHint={t('mushafKeyboardHint')}
      onKeyDown={onKeyDown}
      onBlur={() => setKeyboardMode(false)}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: SPACE.lg }}
        nestedScrollEnabled
        scrollEventThrottle={64}
        onLayout={(e) => {
          view.current = { ...view.current, h: e.nativeEvent.layout.height }
        }}
        onScroll={(e) => {
          view.current = { y: e.nativeEvent.contentOffset.y, h: e.nativeEvent.layoutMeasurement.height }
          refreshLive()
        }}
      >
        <SurahHeader surah={surah} surahNo={surahNo} fontSize={fontSize} theme={theme} lang={lang} />
        {pages.map((page, i) => (
          <View key={page.page} onLayout={(e) => onPageLayout(i, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}>
            {liveSet.has(i) ? (
              <PageBlock
                page={page}
                selKey={pageSelectionKey(page, selection, pending, shownCursor)}
                selection={selection}
                anchor={pending}
                cursor={shownCursor}
                quranStyle={quranStyle}
                theme={theme}
                reduced={reduced}
                onWord={onWord}
                onAyah={onAyah}
                juzLabel={juzLabel}
                pageLabel={pageLabel}
                ornamentLabel={ornamentLabel}
              />
            ) : (
              <LitePage page={page} quranStyle={quranStyle} theme={theme} juzLabel={juzLabel} pageLabel={pageLabel} />
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function SurahHeader({ surah, surahNo, fontSize, theme, lang }: { surah: Surah | null; surahNo: number; fontSize: number; theme: Theme; lang: 'ar' | 'en' }) {
  const { t, count } = useT()
  const { width } = useWindowSizeSafe()
  const showBasmala = surah ? surah.bismillahPre : surahNo !== 1 && surahNo !== 9
  const place = surah ? t(surah.revelationPlace === 'makkah' ? 'makki' : 'madani') : ''
  const verses = surah ? count(surah.versesCount, 'ayah') : ''
  const name = surah ? t('surahName', { name: lang === 'ar' ? surah.nameArabic : keepHyphens(surah.nameSimple) }) : ''
  // Under 360 px (down to the 320 px reflow width) three columns can't hold a long English name
  // ("Surah Al-Muddaththir") without cutting the sides, so the place and count move under the name.
  const stacked = width < 360
  return (
    <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg }}>
      <View style={[styles.cartouche, { borderColor: theme.frameOuter }]}>
        {stacked ? (
          <View style={[styles.cartoucheStacked, { borderColor: theme.frameInner }]}>
            <Text style={[styles.cartoucheName, { color: theme.text }]} accessibilityRole="header">
              {name}
            </Text>
            {surah ? <Text style={[TYPE.caption, { color: theme.textMuted, textAlign: 'center' }]}>{`${place}${lang === 'ar' ? '، ' : ', '}${verses}`}</Text> : null}
          </View>
        ) : (
          <View style={[styles.cartoucheInner, { borderColor: theme.frameInner }]}>
            <Text style={[TYPE.caption, styles.cartoucheSide, { color: theme.textMuted }]} numberOfLines={2}>
              {place}
            </Text>
            <Text style={[styles.cartoucheName, styles.cartoucheNameRow, { color: theme.text }]} numberOfLines={2} accessibilityRole="header">
              {name}
            </Text>
            <View style={[styles.cartoucheSide, { alignItems: 'flex-end' }]}>
              <Text style={[TYPE.caption, { color: theme.textMuted }, uiPlatform.webStyle({ textAlign: 'end' }) as TextStyle]} numberOfLines={2}>
                {verses}
              </Text>
            </View>
          </View>
        )}
      </View>
      {showBasmala ? (
        <Text
          {...uiPlatform.quranProps}
          style={{ fontFamily: FAMILY.quran, fontSize: fontSize * 0.92, lineHeight: Math.round(fontSize * 2), color: theme.text, textAlign: 'center', writingDirection: 'rtl', marginTop: SPACE.sm }}
        >
          {BASMALA}
        </Text>
      ) : null}
    </View>
  )
}

interface PageBlockProps {
  page: MushafPage
  selKey: string
  selection: Selection | null
  anchor: Selection | null
  cursor: WordRef | null
  quranStyle: TextStyle
  theme: Theme
  reduced: boolean
  onWord(ref: WordRef): void
  onAyah(n: number): void
  juzLabel(n: number): string
  pageLabel(n: number): string
  ornamentLabel(n: number): string
}

const PageBlock = memo(
  function PageBlock(p: PageBlockProps) {
    const { page, selection, anchor, cursor, theme } = p
    const band = uiPlatform.bandStyle(theme.goldBand) as TextStyle
    const anchorBand = uiPlatform.bandStyle(theme.goldAnchor) as TextStyle
    // keyboard cursor: a 2 px focus-coloured rule just under the band, clear of the kasras
    const cursorStyle = [
      { textDecorationLine: 'underline', textDecorationColor: theme.focus } as TextStyle,
      uiPlatform.webStyle({ textDecorationThickness: '2px', textUnderlineOffset: '0.45em', textDecorationSkipInk: 'none' }) as TextStyle,
    ]
    const motion = uiPlatform.webStyle(p.reduced ? {} : { transitionProperty: 'background-color', transitionDuration: '160ms' }) as TextStyle
    // vertical-align (not position: relative) so the band of the word's span is painted in place;
    // line-height 0 keeps the lowered mark from opening up the line
    const waqfSeat = [uiPlatform.webStyle({ verticalAlign: '-0.52em', lineHeight: 0 }) as TextStyle, { color: theme.frameOuter }]

    const children: React.ReactNode[] = []
    const lastAyahIndex = page.ayahs.length - 1
    page.ayahs.forEach((a, ai) => {
      const last = lastWordOf(a)
      a.words.forEach((w, wi) => {
        const ref = { ayah: a.number, word: w.position }
        const selected = contains(selection, ref)
        const isAnchor = !!anchor && contains(anchor, ref)
        const isCursor = !!cursor && cursor.ayah === a.number && cursor.word === w.position
        const nextRef = wi < a.words.length - 1 ? { ayah: a.number, word: a.words[wi + 1].position } : null
        const startsBand = selected && !contains(selection, prevRef(a, wi))
        const endsBand = selected && (nextRef ? !contains(selection, nextRef) : false)
        children.push(
          <Text
            key={`w${a.number}.${w.position}`}
            testID={`w-${a.number}-${w.position}`}
            onPress={() => p.onWord(ref)}
            style={[
              motion,
              selected ? band : null,
              isAnchor ? anchorBand : null,
              startsBand ? styles.bandStart : null,
              endsBand ? styles.bandEnd : null,
              ...(isCursor ? cursorStyle : []),
            ]}
          >
            {w.text}
            {w.waqfChar ? (
              w.waqf === 'saktah' ? (
                w.waqfChar
              ) : (
                // Amiri Quran seats pause marks ~1.5em up, where they read as part of the line above at
                // Mushaf leading; the mark is lowered into its own gap (the renderer does the same)
                <Text style={waqfSeat}>{`\u00A0${w.waqfChar}`}</Text>
              )
            ) : null}
          </Text>,
        )
        // the gap after a word: part of the band when both sides are selected; a no-break space
        // before the ornament keeps the ayah number from starting a line on its own
        const gapSelected = selected && (nextRef ? contains(selection, nextRef) : w.position === last)
        children.push(
          <Text key={`g${a.number}.${w.position}`} style={[motion, gapSelected ? band : null]}>
            {nextRef ? ' ' : '\u00A0'}
          </Text>,
        )
      })
      const lastSelected = contains(selection, { ayah: a.number, word: last })
      const continues = lastSelected && contains(selection, { ayah: a.number + 1, word: 1 })
      children.push(
        <Text
          key={`o${a.number}`}
          testID={`o-${a.number}`}
          {...NOT_TABBABLE}
          accessibilityRole="button"
          accessibilityLabel={p.ornamentLabel(a.number)}
          onPress={() => p.onAyah(a.number)}
          style={[motion, styles.ornament, { color: theme.frameOuter }, lastSelected ? band : null, lastSelected && !continues ? styles.bandEnd : null]}
        >
          {ayahOrnament(a.number)}
        </Text>,
      )
      if (ai < lastAyahIndex) children.push(<Text key={`s${a.number}`} style={[motion, continues ? band : null]}>{' '}</Text>)
    })

    return (
      <PageFrame page={page} theme={theme} juzLabel={p.juzLabel} pageLabel={p.pageLabel}>
        <Text {...uiPlatform.quranProps} selectable={false} style={p.quranStyle}>
          {children}
        </Text>
      </PageFrame>
    )
  },
  (a, b) => a.page === b.page && a.selKey === b.selKey && a.quranStyle === b.quranStyle && a.theme === b.theme && a.reduced === b.reduced && a.juzLabel(1) === b.juzLabel(1),
)

/** Juz note above, page number below: the same frame around a built and a light page. */
function PageFrame({ page, theme, juzLabel, pageLabel, children }: { page: MushafPage; theme: Theme; juzLabel(n: number): string; pageLabel(n: number): string; children: React.ReactNode }) {
  return (
    <View style={styles.pageBlock}>
      {page.juzStarts.length > 0 ? (
        <View style={styles.marginRow}>
          <View style={[styles.marginRule, { backgroundColor: theme.frameInner }]} />
          <Text style={[TYPE.caption, { color: theme.frameOuter }]}>{page.juzStarts.map((j) => juzLabel(j)).join('، ')}</Text>
        </View>
      ) : null}
      {children}
      <View style={styles.pageFoot} accessibilityLabel={pageLabel(page.page)}>
        <View style={[styles.footRule, { backgroundColor: theme.hairline }]} />
        <Text style={[TYPE.caption, { color: theme.textFaint }]}>{page.ayahs.length > 0 ? pageLabel(page.page) : ''}</Text>
        <View style={[styles.footRule, { backgroundColor: theme.hairline }]} />
      </View>
    </View>
  )
}

/**
 * A page away from the viewport: the same characters as PageBlock (words, spaces, no-break spaces,
 * lowered pause marks, ornaments) in a handful of runs, so it wraps line for line like the built page.
 */
const LitePage = memo(function LitePage({
  page,
  quranStyle,
  theme,
  juzLabel,
  pageLabel,
}: {
  page: MushafPage
  quranStyle: TextStyle
  theme: Theme
  juzLabel(n: number): string
  pageLabel(n: number): string
}) {
  const waqfSeat = [uiPlatform.webStyle({ verticalAlign: '-0.52em', lineHeight: 0 }) as TextStyle, { color: theme.frameOuter }]
  const ornamentBox = uiPlatform.webStyle({ display: 'inline-block' }) as TextStyle
  const children: React.ReactNode[] = []
  let run = ''
  const flush = () => {
    if (run) children.push(run)
    run = ''
  }
  page.ayahs.forEach((a, ai) => {
    a.words.forEach((w, wi) => {
      run += w.text
      if (w.waqfChar) {
        if (w.waqf === 'saktah') run += w.waqfChar
        else {
          flush()
          children.push(
            <Text key={`m${a.number}.${w.position}`} style={waqfSeat}>
              {`\u00A0${w.waqfChar}`}
            </Text>,
          )
        }
      }
      run += wi < a.words.length - 1 ? ' ' : '\u00A0'
    })
    flush()
    // the built page's ornament is a button (an inline-block): match it, or lines would break elsewhere
    children.push(
      <Text key={`o${a.number}`} style={[styles.ornament, ornamentBox, { color: theme.frameOuter }]}>
        {ayahOrnament(a.number)}
      </Text>,
    )
    if (ai < page.ayahs.length - 1) run += ' '
  })
  flush()
  return (
    <PageFrame page={page} theme={theme} juzLabel={juzLabel} pageLabel={pageLabel}>
      <Text {...uiPlatform.quranProps} selectable={false} style={quranStyle}>
        {children}
      </Text>
    </PageFrame>
  )
})

function prevRef(a: Ayah, wi: number): WordRef {
  if (wi > 0) return { ayah: a.number, word: a.words[wi - 1].position }
  return { ayah: a.number - 1, word: Number.MAX_SAFE_INTEGER }
}

const styles = StyleSheet.create({
  frameOuter: { borderWidth: 2, borderRadius: RADIUS.page, padding: 3, overflow: 'hidden' },
  frameInner: { flex: 1, borderWidth: 1, borderRadius: 1, overflow: 'hidden' },
  cartouche: { borderTopWidth: 2, borderBottomWidth: 2, paddingVertical: 2, marginBottom: SPACE.xs },
  cartoucheInner: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.sm,
    gap: SPACE.sm,
  },
  cartoucheStacked: { borderTopWidth: 1, borderBottomWidth: 1, alignItems: 'center', paddingVertical: SPACE.sm, paddingHorizontal: SPACE.sm, gap: SPACE.xxs },
  cartoucheSide: { flex: 1 },
  cartoucheName: { fontFamily: FAMILY.displaySemiBold, fontSize: 21, lineHeight: 30, textAlign: 'center' },
  cartoucheNameRow: { flex: 2 },
  ornament: { fontFamily: FAMILY.quran },
  bandStart: { borderTopStartRadius: 6, borderBottomStartRadius: 6 },
  bandEnd: { borderTopEndRadius: 6, borderBottomEndRadius: 6 },
  pageBlock: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm },
  marginRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.xs },
  marginRule: { flex: 1, height: 1, opacity: 0.6 },
  pageFoot: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm },
  footRule: { flex: 1, height: StyleSheet.hairlineWidth },
})
