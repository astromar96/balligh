// Preview stage — web. Draws the same deterministic scene the export uses (preview == export) on a
// DPR-aware <canvas> through createCanvasPainter: the video frame at player.currentMs() while the recitation is
// ready (a requestAnimationFrame loop while playing), else the still image's pages with a pager. Play/pause,
// scrub, elapsed/total in the UI's digits. Every draw happens in an animation frame, never in an effect body.
// `compact` (the narrow step flow): no notes under the controls (the step shows StageNotes itself), and the pager
// takes the controls' row while there is no recitation to play, so the Stage is always maxHeight + STAGE_CHROME tall.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import type { Scene } from '../../core/types'
import type { PreviewPlayer } from '../../media'
import { createScene, getGraphics } from '../../render'
import { createCanvasPainter } from '../../render/platform.web'
import { useCompose } from '../compose'
import { formatClock } from '../format'
import { useT } from '../hooks'
import { uiPlatform } from '../platform'
import { attempt, describeError } from '../safe'
import { useAppStore } from '../store'
import { useReducedMotion, useTheme } from '../theme'
import { FAMILY, RADIUS, SPACE, TOUCH, TYPE } from '../tokens'
import { Icon } from './Icon'
import { IconButton } from './primitives'
import type { StageProps } from './Stage'
import { MAT_PAD } from './stageLayout'
import { StageNotes } from './StageNotes'

export type { StageProps } from './Stage'

/** shown while the length is not known (no recitation yet): never "٠:٠٠ / ٠:٠٠" */
const NO_TIME = '–:––'
/**
 * Each time sits in its own left-to-right isolate (LRI … PDI). Two Arabic-Indic numbers around a slash are otherwise
 * shown swapped by the bidi algorithm ("٠:٥٣ / ٠:٠٢"): elapsed must stay next to the scrubber, total after it.
 */
const isolate = (s: string) => `\u2066${s}\u2069`

function aspectRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : 9 / 16
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Play state and clock belong to one player: a new player (new passage or reciter) starts paused at 0. */
interface PlayState {
  player: PreviewPlayer | null
  playing: boolean
  ms: number
}

export function Stage({ maxHeight, widthHint, compact = false }: StageProps) {
  const th = useTheme()
  const { t, lang } = useT()
  const reduced = useReducedMotion()
  const design = useAppStore((s) => s.design)
  const model = useCompose((s) => s.model)
  const stillModel = useCompose((s) => s.stillModel)
  const font = useCompose((s) => s.font)
  const textFonts = useCompose((s) => s.textFonts)
  const bg = useCompose((s) => s.bgImage)
  const player = useCompose((s) => s.player)
  const audio = useCompose((s) => s.audio)
  const [boxW, setBoxW] = useState(() => (widthHint ? Math.max(0, widthHint - MAT_PAD * 2) : 0))
  // a Stage mounting over an existing player (the step flow mounts one per step) starts where the player stands
  const [play, setPlay] = useState<PlayState>(() => {
    const p = useCompose.getState().player
    return p ? { player: p, playing: p.isPlaying(), ms: p.currentMs() } : { player: null, playing: false, ms: 0 }
  })
  const [redraw, setRedraw] = useState(0)
  const [drawError, setDrawError] = useState<{ scene: Scene; error: unknown } | null>(null)
  const [pageState, setPageState] = useState<{ scene: Scene | null; k: number }>({ scene: null, k: 0 })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const trackRef = useRef<ComponentRef<typeof View>>(null)
  const lastClockSet = useRef(0)

  const mine = !!player && play.player === player
  const playing = mine && play.playing
  const clock = mine ? play.ms : 0

  const ratio = aspectRatio(design.aspect)
  const cssW = Math.max(0, Math.min(boxW, maxHeight * ratio))
  const cssH = cssW / ratio
  const dpr = typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1
  const pw = even(cssW * dpr)
  const ph = even(cssH * dpr)

  // the video frame once the recitation is ready; until then (or without one) the still image, page by page
  const timed = audio.status === 'ready' && !!model?.timeline
  const shownModel = timed ? model : stillModel
  // the UI families must be loaded before a scene measures its text (a translation's own font loads with it)
  const fontsSettled = font.status === 'ready' && (textFonts.status === 'ready' || textFonts.status === 'error')

  const sceneResult = useMemo(() => {
    if (!shownModel || !fontsSettled || !font.value || cssW < 8) return null
    const assets = { font: font.value, graphics: getGraphics(), backgroundImage: bg.status === 'ready' ? bg.value : null }
    return attempt<Scene>(() => createScene(shownModel, design, assets, { width: pw, height: ph }))
  }, [shownModel, design, font, fontsSettled, bg, pw, ph, cssW])
  const scene = sceneResult?.ok ? sceneResult.value : null
  const pages = scene && !timed ? scene.pageCount : 1
  const page = scene && pageState.scene === scene ? Math.min(pageState.k, pages - 1) : 0

  useEffect(() => {
    if (!player) return
    return player.onEnded(() => {
      setPlay((p) => (p.player === player ? { ...p, playing: false } : p))
      setRedraw((n) => n + 1)
    })
  }, [player])

  // draw: one frame per change, a rAF loop while playing
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let alive = true
    const frame = () => {
      if (!alive) return
      // resized here, with the new picture, so a layout change never shows a blank canvas in between
      if (canvas.width !== pw) canvas.width = pw
      if (canvas.height !== ph) canvas.height = ph
      const tMs = timed && player ? player.currentMs() : 0
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, pw, ph)
        const painter = createCanvasPainter(ctx, pw, ph)
        if (timed) scene.draw(painter, tMs)
        else scene.drawPage(painter, page)
      } catch (error) {
        setDrawError({ scene, error })
        return
      }
      if (!timed || !player) return
      const now = performance.now()
      const going = player.isPlaying()
      if (now - lastClockSet.current > 200 || !going) {
        lastClockSet.current = now
        setPlay((p) => (p.player === player ? { ...p, ms: tMs } : p))
      }
      if (going) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [scene, player, playing, redraw, pw, ph, timed, page])

  const toggle = useCallback(() => {
    if (!player) return
    if (player.isPlaying()) {
      player.pause()
      setPlay({ player, playing: false, ms: player.currentMs() })
      setRedraw((n) => n + 1)
    } else {
      const from = player.currentMs() >= player.durationMs() - 30 ? 0 : undefined
      // play() is called synchronously inside the tap (autoplay policy)
      player.play(from).then(
        () => setPlay((p) => (p.player === player ? { ...p, playing: true } : p)),
        () => setPlay((p) => (p.player === player ? { ...p, playing: false } : p)),
      )
      setPlay({ player, playing: true, ms: from ?? player.currentMs() })
    }
  }, [player])

  const seekRatio = useCallback(
    (r: number) => {
      if (!player) return
      const ms = Math.min(1, Math.max(0, r)) * player.durationMs()
      player.seek(ms)
      setPlay((p) => ({ player, playing: p.player === player ? p.playing : false, ms }))
      setRedraw((n) => n + 1)
    },
    [player],
  )

  const seekAtPageX = (pageX: number) => {
    const node = trackRef.current as unknown as HTMLElement | null
    if (!node?.getBoundingClientRect) return
    const rect = node.getBoundingClientRect()
    if (rect.width > 0) seekRatio((pageX - rect.left) / rect.width)
  }

  const turnPage = (delta: number) => {
    if (!scene) return
    setPageState({ scene, k: Math.min(pages - 1, Math.max(0, page + delta)) })
  }

  const total = player ? player.durationMs() : null
  const progress = total && total > 0 ? clock / total : 0
  const arabic = lang === 'ar'
  // at rest the length alone ("٠:٥٣"): the Arabic-Indic zero is a dot, so "٠:٠٠ / ٠:٥٣" would open with a row of dots
  const started = playing || clock > 0
  const timeLabel =
    total === null ? NO_TIME : started ? `${isolate(formatClock(clock, arabic))} / ${isolate(formatClock(total, arabic))}` : isolate(formatClock(total, arabic))

  const onLayout = (e: LayoutChangeEvent) => setBoxW(Math.max(0, e.nativeEvent.layout.width - MAT_PAD * 2))

  const drawFailed = drawError && drawError.scene === scene ? drawError.error : null
  const previewError = sceneResult && !sceneResult.ok ? sceneResult.error : (drawFailed ?? (font.status === 'error' ? font.error : null))
  const waiting = !scene && !previewError
  // compact: the still image's pages are turned in the controls' row (nothing to play yet), so the height stays put
  const pagerInRow = compact && pages > 1

  return (
    <View style={[styles.mat, { backgroundColor: th.stage }]} onLayout={onLayout} testID="stage">
      <View style={[styles.canvasBox, { width: cssW || '100%', height: cssH || 200 }]}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={pages > 1 ? `${t('preview')} — ${t('pageOf', { k: page + 1, n: pages })}` : t('preview')}
          data-testid="preview-canvas"
          style={{ width: cssW, height: cssH, display: scene ? 'block' : 'none', borderRadius: 4 }}
        />
        {waiting ? (
          <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: 'rgba(236,230,216,0.06)' }]}>
            <Text style={[TYPE.small, { color: th.onStageMuted }]}>{t('preparingPreview')}</Text>
          </View>
        ) : null}
        {previewError ? (
          <View style={[StyleSheet.absoluteFill, styles.placeholder, { padding: SPACE.lg }]} testID="preview-error">
            <Icon name="alert" size={22} color="#E9B6AE" />
            <Text style={[TYPE.small, { color: th.onStage, textAlign: 'center' }]}>{describeError(lang, 'whatPreview', previewError)}</Text>
          </View>
        ) : null}
      </View>

      {pages > 1 ? (
        <View style={[styles.pager, pagerInRow && styles.pagerInRow]} testID="stage-pager">
          <IconButton icon="chevronStart" rtl={arabic} label={t('prevPage')} onPress={() => turnPage(-1)} disabled={page === 0} color={th.onStage} testID="page-prev" />
          <Text style={[TYPE.label, { color: th.onStage, fontVariant: ['tabular-nums'] }]} testID="stage-page">
            {t('pageOf', { k: page + 1, n: pages })}
          </Text>
          <IconButton icon="chevronEnd" rtl={arabic} label={t('nextPage')} onPress={() => turnPage(1)} disabled={page >= pages - 1} color={th.onStage} testID="page-next" />
        </View>
      ) : null}

      {pagerInRow ? null : (
        <View style={styles.controls} {...uiPlatform.ltrProps}>
          <Pressable
            testID="play-toggle"
            accessibilityRole="button"
            accessibilityLabel={playing ? t('pause') : t('play')}
            disabled={!player}
            onPress={toggle}
            style={({ pressed }) => [styles.play, { backgroundColor: pressed ? th.primaryPressed : th.primary, opacity: player ? 1 : 0.4 }]}
          >
            <Icon name={playing ? 'pause' : 'play'} size={20} color={th.onPrimary} />
          </Pressable>
          <View
            ref={trackRef}
            style={styles.trackHit}
            focusable={!!player}
            accessibilityRole="adjustable"
            accessibilityLabel={t('scrub')}
            aria-valuemin={0}
            aria-valuemax={Math.round((total ?? 0) / 1000)}
            aria-valuenow={Math.round(clock / 1000)}
            aria-valuetext={formatClock(clock, arabic)}
            onStartShouldSetResponder={() => !!player}
            onMoveShouldSetResponder={() => !!player}
            onResponderGrant={(e) => seekAtPageX(e.nativeEvent.pageX)}
            onResponderMove={(e) => seekAtPageX(e.nativeEvent.pageX)}
            onKeyDown={(e) => {
              if (!player || !total) return
              const k = e.nativeEvent.key
              if (k === 'ArrowRight') seekRatio((clock + 5000) / total)
              else if (k === 'ArrowLeft') seekRatio((clock - 5000) / total)
              else if (k === 'Home') seekRatio(0)
              else if (k === 'End') seekRatio(1)
            }}
          >
            <View style={[styles.track, { backgroundColor: 'rgba(236,230,216,0.18)' }]}>
              <View
                style={[
                  styles.trackFill,
                  { width: `${Math.round(progress * 1000) / 10}%`, backgroundColor: th.gold },
                  uiPlatform.webStyle(reduced || playing ? {} : { transitionProperty: 'width', transitionDuration: '120ms' }),
                ]}
              />
            </View>
          </View>
          <Text style={[styles.time, { color: total !== null ? th.onStage : th.onStageMuted }]} testID="stage-time">
            {timeLabel}
          </Text>
        </View>
      )}

      {compact ? null : <StageNotes onStage />}
    </View>
  )
}

const styles = StyleSheet.create({
  mat: { borderRadius: RADIUS.control, padding: MAT_PAD, gap: SPACE.md },
  canvasBox: { alignSelf: 'center', borderRadius: 4, overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: SPACE.sm },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, marginTop: -SPACE.xs },
  // in the controls' place: exactly their height
  pagerInRow: { marginTop: 0, height: TOUCH },
  controls: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  play: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  trackHit: { flex: 1, height: TOUCH, justifyContent: 'center', cursor: 'pointer' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2 },
  // 16 px semibold, full contrast: the Arabic-Indic zero is a small dot, lost in a 12 px muted caption by the colon
  time: { fontFamily: FAMILY.uiSemiBold, fontSize: 16, lineHeight: 22, minWidth: 96, textAlign: 'right', fontVariant: ['tabular-nums'] },
})
