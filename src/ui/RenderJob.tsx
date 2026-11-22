// The render route's body (src/app/render.tsx), driven by the publishing server (server/src/render.ts) in headless
// Chrome. It opens the deep link in the query, waits until everything the video draws has loaded, refuses a cut the
// selection guard rates 'warning' (the server never posts one to Balligh's pages), then encodes the MP4 exactly as
// the export sheet does and hands it over through window.__ballighRender with its caption and canonical link.
// Query: the share link's own keys, plus q=fullhd for 1080p. The UI language is Arabic here: the caption is Arabic.
// A person opening /render sees the progress and nothing else; nothing leaves the page.
import { useEffect, useSyncExternalStore } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { ExportedFile, ExportProgress } from '../core/types'
import * as domain from '../domain'
import { exportSize } from '../render'
import { decodeQuery, openInitialPassage } from './bootstrap'
import { useCompose, useComposeEngine } from './compose'
import { currentFileBase, exportVideoFromState } from './exportVideo'
import { uiPlatform } from './platform'
import { errorMessage } from './safe'
import { buildShareText, currentShareLink, currentShareQuery, shareTextParts, type ShareTextParts } from './shareText'
import { useAppStore } from './store'
import { useTheme } from './theme'
import { SPACE, TYPE } from './tokens'

export type RenderStatus = 'loading' | 'encoding' | 'done' | 'error'

export type RenderErrorCode =
  /** the query is not a share link */
  | 'bad-link'
  /** the selection guard rates the cut 'warning' (meaning can change) */
  | 'cut-warning'
  /** under domain.MIN_PUBLISH_MS: the platforms refuse it */
  | 'too-short'
  /** past domain.MAX_VIDEO_MS (D3) */
  | 'too-long'
  /** the passage, recitation, font, tafsir or translation could not be loaded */
  | 'load'
  /** nothing ready after LOAD_TIMEOUT_MS */
  | 'timeout'
  | 'export'

/** What the driver reads (JSON-safe), plus `chunk` to pull the file out in base64 slices. */
export interface RenderReport {
  status: RenderStatus
  phase: ExportProgress['phase'] | null
  progress: number
  errorCode: RenderErrorCode | null
  error: string | null
  /** the kinds of the 'warning'-rated cut warnings (domain.SelectionWarning['kind']) */
  warnings: string[]
  durationMs: number | null
  width: number | null
  height: number | null
  /** encodeShareState of what was rendered (with the passage's ayahs: the shortest form) */
  canonicalQuery: string | null
  /** the deep link that reopens the clip in the app */
  link: string | null
  /** buildShareText in Arabic: the words, reference, reciter, sources and link */
  caption: string | null
  /** the same, line by line (the server cuts it to each platform's length) */
  captionParts: ShareTextParts | null
  /** the reciter's Arabic name (YouTube's title) */
  reciterName: string | null
  fileName: string | null
  mimeType: string | null
  size: number | null
}

export interface RenderApi extends RenderReport {
  /** base64 of bytes [offset, offset + length) of the finished file; '' past its end */
  chunk(offset: number, length: number): Promise<string>
}

type RenderWindow = typeof globalThis & { __ballighRender?: RenderApi }

const LOAD_TIMEOUT_MS = 120_000
/** the loaded state must hold this long: tafsir/translation reload for the played span once the recitation is ready */
const SETTLE_MS = 600

const INITIAL: RenderReport = {
  status: 'loading',
  phase: null,
  progress: 0,
  errorCode: null,
  error: null,
  warnings: [],
  durationMs: null,
  width: null,
  height: null,
  canonicalQuery: null,
  link: null,
  caption: null,
  captionParts: null,
  reciterName: null,
  fileName: null,
  mimeType: null,
  size: null,
}

let report: RenderReport = INITIAL
let file: ExportedFile | null = null
const listeners = new Set<() => void>()

function publish(patch: Partial<RenderReport>): void {
  report = { ...report, ...patch }
  const w = globalThis as RenderWindow
  w.__ballighRender = { ...report, chunk: readChunk }
  for (const l of [...listeners]) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function readChunk(offset: number, length: number): Promise<string> {
  if (!file) return ''
  const bytes = new Uint8Array(await file.blob.slice(offset, offset + length).arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

class RenderFailure extends Error {
  readonly code: RenderErrorCode
  constructor(code: RenderErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

type Readiness = { state: 'waiting' } | { state: 'ready' } | { state: 'failed'; code: RenderErrorCode; error: unknown }

function readiness(): Readiness {
  const st = useAppStore.getState()
  const c = useCompose.getState()
  const failed = (code: RenderErrorCode, error: unknown): Readiness => ({ state: 'failed', code, error })
  if (st.surahsStatus === 'error') return failed('load', st.surahsError)
  if (st.ayahsStatus === 'error') return failed('load', st.ayahsError)
  if (c.font.status === 'error') return failed('load', c.font.error)
  if (c.audio.status === 'error') return failed('load', c.audio.error)
  if (c.audio.status === 'too-long') return failed('too-long', c.audio.error)
  if (st.tafsirId && c.tafsir.status === 'error') return failed('load', c.tafsir.error)
  if (st.translationId !== null && c.translation.status === 'error') return failed('load', c.translation.error)
  const fontsSettled = c.font.status === 'ready' && (c.textFonts.status === 'ready' || c.textFonts.status === 'error')
  const audio = c.audio.status === 'ready' ? c.audio.value : null
  if (audio && c.modelError) return failed('load', c.modelError)
  // the model must be the one built from this recitation (the engine rebuilds it in an effect after the audio lands)
  const audioReady = !!audio && c.model?.timeline === audio.timeline
  const tafsirSettled = !st.tafsirId || (c.tafsir.status === 'ready' && !!c.model?.tafsir)
  const translationSettled = st.translationId === null || (c.translation.status === 'ready' && !!c.model?.translation)
  return fontsSettled && audioReady && tafsirSettled && translationSettled ? { state: 'ready' } : { state: 'waiting' }
}

/** Resolves once readiness() has said 'ready' for SETTLE_MS without a break; rejects on a failure or the timeout. */
function waitUntilReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settle: ReturnType<typeof setTimeout> | null = null
    const stops: (() => void)[] = []
    const finish = (fn: () => void) => {
      for (const stop of stops) stop()
      if (settle) clearTimeout(settle)
      clearTimeout(deadline)
      fn()
    }
    const check = () => {
      const r = readiness()
      if (r.state === 'failed') finish(() => reject(new RenderFailure(r.code, errorMessage(r.error))))
      else if (r.state === 'waiting') {
        // any break restarts the wait
        if (settle) clearTimeout(settle)
        settle = null
      } else if (!settle) settle = setTimeout(() => finish(resolve), SETTLE_MS)
    }
    const deadline = setTimeout(() => finish(() => reject(new RenderFailure('timeout', 'nothing ready in time'))), LOAD_TIMEOUT_MS)
    stops.push(useAppStore.subscribe(check), useCompose.subscribe(check))
    check()
  })
}

let started = false

async function runRenderJob(): Promise<void> {
  const query = uiPlatform.initialQuery()
  const state = decodeQuery(query)
  if (!state) throw new RenderFailure('bad-link', 'the query is not a share link')
  const st = useAppStore.getState()
  st.setLanguage('ar')
  st.setExportQuality(new URLSearchParams(query ?? '').get('q') === 'fullhd' ? 'fullhd' : 'hd')
  openInitialPassage(state)

  await waitUntilReady()

  const c = useCompose.getState()
  const warnings = c.warnings.filter((w) => domain.warningSeverity(w) === 'warning').map((w) => w.kind)
  const durationMs = c.audio.status === 'ready' && c.audio.value ? c.audio.value.timeline.durationMs : null
  const { width, height } = exportSize(useAppStore.getState().design.aspect, useAppStore.getState().exportQuality)
  // the app's address without this route's own path segment
  const link = currentShareLink(uiPlatform.appBaseUrl().replace(/render\/?$/, ''))
  publish({
    warnings,
    durationMs,
    width,
    height,
    link,
    canonicalQuery: currentShareQuery(),
    caption: buildShareText('video', 'ar', link),
    captionParts: shareTextParts('video', 'ar', link),
    reciterName: c.model?.reciter?.nameAr ?? null,
  })
  if (warnings.length > 0) throw new RenderFailure('cut-warning', warnings.join(', '))
  if (durationMs !== null && durationMs < domain.MIN_PUBLISH_MS) throw new RenderFailure('too-short', `${durationMs} ms`)

  publish({ status: 'encoding', phase: 'audio', progress: 0 })
  try {
    file = await exportVideoFromState({ lang: 'ar', onProgress: (p) => publish({ phase: p.phase, progress: p.ratio }) })
  } catch (error) {
    throw new RenderFailure('export', errorMessage(error))
  }
  publish({ status: 'done', progress: 1, fileName: file.fileName || currentFileBase(), mimeType: file.mimeType, size: file.blob.size })
}

function start(): void {
  if (started) return
  started = true
  publish({})
  runRenderJob().catch((error: unknown) => {
    const code: RenderErrorCode = error instanceof RenderFailure ? error.code : 'export'
    publish({ status: 'error', errorCode: code, error: errorMessage(error) })
  })
}

export function RenderJob() {
  useComposeEngine()
  const r = useSyncExternalStore(
    subscribe,
    () => report,
    () => INITIAL,
  )
  const th = useTheme()
  useEffect(() => {
    start()
  }, [])
  const pct = Math.round(r.progress * 100)
  return (
    <View style={[styles.root, { backgroundColor: th.bg }]} testID="render-job">
      <Text style={[TYPE.title, { color: th.text }]}>بلّغ</Text>
      <Text style={[TYPE.body, { color: th.textMuted }]} testID="render-status">
        {r.status === 'error' ? `${r.errorCode}: ${r.error}` : r.status === 'encoding' ? `${r.phase ?? ''} ${pct}%` : r.status}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.sm },
})
