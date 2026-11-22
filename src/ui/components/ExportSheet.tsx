// Export sheet: «فيديو» / «صورة» (or «صور» when the still needs several pages) → progress + «إلغاء» → «شارك» /
// «حمّل» / «انسخ الرابط». The share button calls media.shareFile(s) directly in its own onPress: an export takes
// longer than the 5 s transient activation, so sharing must start from a fresh tap (research/media-pipeline.md §8).
// Every opening starts fresh (useOpenSession); closing stops a running export, and the body frees its previews.
import * as Clipboard from 'expo-clipboard'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ExportedFile, ExportProgress, Scene } from '../../core/types'
import * as media from '../../media'
import type { VideoSupport } from '../../media'
import { createScene, exportSize, getGraphics } from '../../render'
import { findReciter, tafsirTooFast, useCompose } from '../compose'
import { currentFileBase, exportVideoFromState } from '../exportVideo'
import { formatClock, formatMegabytes, toIndic } from '../format'
import { useFocusOnMount, useOpenSession, useT } from '../hooks'
import type { MessageKey } from '../i18n'
import { uiPlatform } from '../platform'
import { attempt, describeAudioSourceError, describeError, errorMessage, isAbortError, orElse } from '../safe'
import { useAppStore } from '../store'
import { buildShareText, currentShareLink } from '../shareText'
import { useTheme } from '../theme'
import { RADIUS, SPACE, TYPE } from '../tokens'
import { DurationWarnings } from './DurationWarnings'
import { Icon } from './Icon'
import { Button, InlineError, Muted, Note, ProgressBar, Sheet } from './primitives'

type Kind = 'video' | 'image'
type Phase =
  | { step: 'choose' }
  | { step: 'working'; kind: Kind; label: MessageKey; ratio: number }
  | { step: 'done'; kind: Kind; files: ExportedFile[]; previews: string[] }
  | { step: 'error'; kind: Kind; error: unknown }

/** what one share sheet carries (media.canShareFiles) */
const SHARE_CAP = 50 * 1024 * 1024
/** pages of a still one export makes: one share sheet (00-gaps D3). The text and a licensed tafsir never lose pages,
 *  so a still that needs more is not exported at all; the sheet asks for a shorter selection. */
export const MAX_PAGES = 10

const PHASE_LABEL: Record<ExportProgress['phase'], MessageKey> = { audio: 'phaseAudio', frames: 'phaseFrames', finalizing: 'phaseFinalizing' }


export function ExportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT()
  const session = useOpenSession(visible)
  const running = useRef<AbortController | null>(null)
  const onRunning = useCallback((c: AbortController | null) => {
    running.current = c
  }, [])
  // every way out (close button, backdrop, Escape) stops a running export at once, not after the closing animation
  const close = () => {
    running.current?.abort()
    running.current = null
    onClose()
  }
  return (
    <Sheet visible={visible} onClose={close} title={t('exportTitle')} testID="export-sheet" closeLabel={t('close')}>
      <ExportBody key={session} onRunning={onRunning} />
    </Sheet>
  )
}

function ExportBody({ onRunning }: { onRunning: (c: AbortController | null) => void }) {
  const th = useTheme()
  const { t, lang, count } = useT()
  const model = useCompose((s) => s.model)
  const stillModel = useCompose((s) => s.stillModel)
  const font = useCompose((s) => s.font)
  const textFonts = useCompose((s) => s.textFonts)
  const bg = useCompose((s) => s.bgImage)
  const audio = useCompose((s) => s.audio)
  const description = useCompose((s) => s.description)
  const retryAudio = useCompose((s) => s.retryAudio)
  const design = useAppStore((s) => s.design)
  const quality = useAppStore((s) => s.exportQuality)
  const reciterId = useAppStore((s) => s.reciterId)
  const [phase, setPhase] = useState<Phase>({ step: 'choose' })
  const [support, setSupport] = useState<{ key: string; value: VideoSupport } | null>(null)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const urls = useRef<string[]>([])
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const arabic = lang === 'ar'
  const { width: vw, height: vh } = exportSize(design.aspect, quality)
  const { width: iw, height: ih } = exportSize(design.aspect, 'fullhd')
  const sizeKey = `${vw}x${vh}`

  useEffect(() => {
    let alive = true
    const key = `${vw}x${vh}`
    Promise.resolve()
      .then(() => media.detectVideoSupport(vw, vh))
      .then(
        (value) => {
          if (alive) setSupport({ key, value })
        },
        () => {
          if (alive) setSupport({ key, value: { method: 'none', container: null, reason: null, noteAr: null, noteEn: null } })
        },
      )
    return () => {
      alive = false
    }
  }, [vw, vh])
  const videoSupport = support?.key === sizeKey ? support.value : null

  // the still is laid out once per change: its page count is shown before export, and the export reuses it
  const fontsSettled = font.status === 'ready' && (textFonts.status === 'ready' || textFonts.status === 'error')
  const still = useMemo(() => {
    if (!stillModel || !font.value || !fontsSettled) return null
    const assets = { font: font.value, graphics: getGraphics(), backgroundImage: bg.status === 'ready' ? bg.value : null }
    return attempt<Scene>(() => createScene(stillModel, design, assets, { width: iw, height: ih }))
  }, [stillModel, design, font, fontsSettled, bg, iw, ih])
  const stillScene = still?.ok ? still.value : null
  const pages = stillScene ? stillScene.pageCount : null

  const releaseUrls = useCallback(() => {
    for (const u of urls.current) uiPlatform.releaseObjectUrl(u)
    urls.current = []
  }, [])
  const dispose = useCallback(() => {
    ctrl.current?.abort()
    ctrl.current = null
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    releaseUrls()
  }, [releaseUrls])
  useEffect(() => dispose, [dispose])

  const run = async (kind: Kind) => {
    const c = new AbortController()
    ctrl.current?.abort()
    ctrl.current = c
    onRunning(c)
    setShareNote(null)
    setCopied(false)
    setPhase({ step: 'working', kind, label: kind === 'video' ? 'phaseFrames' : 'phaseImages', ratio: 0 })
    try {
      let files: ExportedFile[]
      if (kind === 'video') {
        const file = await exportVideoFromState({
          lang,
          signal: c.signal,
          onProgress: (p) => {
            if (!c.signal.aborted) setPhase({ step: 'working', kind, label: PHASE_LABEL[p.phase], ratio: p.ratio })
          },
        })
        files = [file]
      } else {
        if (!stillScene) throw new Error(t('nothingToExport'))
        if (stillScene.pageCount > MAX_PAGES) throw new Error(t('tooManyPages', { n: stillScene.pageCount }))
        files =
          stillScene.pageCount > 1
            ? await media.exportImages({
                scene: stillScene,
                fileBase: currentFileBase(),
                maxPages: MAX_PAGES,
                signal: c.signal,
                onProgress: (ratio) => {
                  if (!c.signal.aborted) setPhase({ step: 'working', kind, label: 'phaseImages', ratio })
                },
              })
            : [await media.exportImage({ scene: stillScene, fileBase: currentFileBase() })]
      }
      if (c.signal.aborted) return
      releaseUrls()
      const previews = kind === 'image' ? files.map((f) => uiPlatform.objectUrl(f.blob)).filter((u): u is string => !!u) : []
      urls.current = previews
      setPhase({ step: 'done', kind, files, previews })
    } catch (error) {
      if (c.signal.aborted || isAbortError(error)) {
        setPhase({ step: 'choose' })
        return
      }
      setPhase({ step: 'error', kind, error })
    } finally {
      if (ctrl.current === c) {
        ctrl.current = null
        onRunning(null)
      }
    }
  }

  const cancel = () => {
    ctrl.current?.abort()
    setPhase({ step: 'choose' })
  }

  // must stay synchronous up to media.shareFile(s): it consumes the tap's transient activation
  const share = (kind: Kind, files: ExportedFile[]) => {
    setShareNote(null)
    const total = files.reduce((n, f) => n + f.blob.size, 0)
    if (total > SHARE_CAP) {
      setShareNote(t(files.length > 1 || kind === 'image' ? 'shareTooLargeImages' : 'shareTooLarge'))
      return
    }
    const meta = { title: description, text: buildShareText(kind, lang) }
    const many = files.length > 1
    if (!orElse(() => (many ? media.canShareFiles(files) : media.canShareFile(files[0])), false)) {
      setShareNote(t('shareUnsupported'))
      return
    }
    ;(many ? media.shareFiles(files, meta) : media.shareFile(files[0], meta)).then(
      (r) => {
        if (r === 'unsupported') setShareNote(t('shareUnsupported'))
      },
      (e) => setShareNote(describeError(lang, 'whatExport', e)),
    )
  }

  const download = (files: ExportedFile[]) => {
    setShareNote(null)
    try {
      for (const f of files) media.downloadFile(f)
    } catch (e) {
      setShareNote(describeError(lang, 'whatExport', e))
    }
  }

  const copyLink = async () => {
    const link = currentShareLink()
    if (!link) return
    try {
      await Clipboard.setStringAsync(link)
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2500)
    } catch (e) {
      setShareNote(describeError(lang, 'whatExport', e))
    }
  }

  const reciter = findReciter(reciterId)
  const audioReady = audio.status === 'ready' && !!audio.value && !!model?.timeline
  const exactMs = audio.status === 'ready' && audio.value ? audio.value.timeline.durationMs : null
  const aboutMs = exactMs ?? (audio.status === 'loading' || audio.status === 'too-long' ? audio.estimateMs : null)
  const tooLong = audio.status === 'too-long'
  const videoBlocked = videoSupport?.method === 'none'
  const fontReady = font.status === 'ready'
  const canVideo = !!model && fontReady && !videoBlocked && audioReady
  const tooManyPages = pages !== null && pages > MAX_PAGES
  const canImage = !!stillScene && !tooManyPages
  const sizeLabel = (w: number, h: number) => (arabic ? toIndic(`${w}×${h}`) : `${w}×${h}`)
  const videoSub = !design.highlightWords ? 'exportVideoSubPlain' : reciter && !reciter.wordTimings ? 'exportVideoSubAyah' : 'exportVideoSub'
  const videoMeta =
    exactMs !== null ? t('durationLabel', { time: formatClock(exactMs, arabic) }) : aboutMs !== null ? t('durationAbout', { time: formatClock(aboutMs, arabic) }) : undefined
  // media says why, in both languages; the generic line when it could not tell
  const unsupportedNote = (arabic ? videoSupport?.noteAr : videoSupport?.noteEn) || t('videoUnsupported')
  const fastTafsir = audioReady && design.showTafsir && tafsirTooFast(model)
  const pagesMeta = pages === null ? undefined : pages === 1 ? t('oneImage') : count(pages, 'image')
  const stillError = still && !still.ok ? still.error : font.status === 'error' ? font.error : null

  return (
    <View style={{ gap: SPACE.lg }}>
      <Text style={[TYPE.bodyMedium, { color: th.text }]} numberOfLines={2}>
        {description}
      </Text>

      {phase.step === 'choose' ? (
        <View style={{ gap: SPACE.md }}>
          {!model || !stillModel ? <InlineError message={t('nothingToExport')} /> : null}
          {model && stillError ? <InlineError message={describeError(lang, 'whatPreview', stillError)} /> : null}

          <Option
            testID="export-video"
            icon="video"
            title={t('exportVideo')}
            sub={`${t(videoSub)} — ${sizeLabel(vw, vh)}`}
            meta={videoMeta}
            disabled={!canVideo}
            onPress={() => void run('video')}
          />
          {videoBlocked ? (
            <Note icon="alert">{unsupportedNote}</Note>
          ) : tooLong ? (
            <View testID="video-too-long">
              <Note icon="alert">{audio.estimateMs !== null ? t('tooLongVideoAbout', { time: formatClock(audio.estimateMs, arabic) }) : t('tooLongVideo')}</Note>
            </View>
          ) : audio.status === 'loading' ? (
            <Muted>{t('videoWaitsAudio')}</Muted>
          ) : audio.status === 'error' ? (
            <InlineError message={describeError(lang, 'whatAudio', audio.error)} actionLabel={t('retry')} onAction={retryAudio} />
          ) : null}
          {!videoBlocked && !tooLong ? <DurationWarnings durationMs={aboutMs} /> : null}
          {fastTafsir ? <Note icon="info">{t('tafsirFastPages')}</Note> : null}

          <Option
            testID="export-image"
            icon="image"
            title={pages !== null && pages > 1 ? t('exportImages') : t('exportImage')}
            sub={`${t('exportImageSub')} — ${sizeLabel(iw, ih)}`}
            meta={pagesMeta}
            metaTestID="export-image-count"
            disabled={!canImage}
            onPress={() => void run('image')}
          />
          {tooManyPages ? (
            <View testID="too-many-pages">
              <Note icon="alert">{t('tooManyPages', { n: pages })}</Note>
            </View>
          ) : null}
          <Note>{t('makingOnDevice')}</Note>
          <Button testID="copy-link-early" variant="quiet" icon={copied ? 'check' : 'link'} label={copied ? t('linkCopied') : t('copyLink')} onPress={copyLink} />
        </View>
      ) : phase.step === 'working' ? (
        <View style={{ gap: SPACE.md }} testID="export-progress" aria-live="polite">
          <Text style={[TYPE.body, { color: th.text }]}>
            {t(phase.label)}
            {'  '}
            <Text style={{ color: th.textMuted }}>{arabic ? `${toIndic(String(Math.round(phase.ratio * 100)))}٪` : `${Math.round(phase.ratio * 100)}%`}</Text>
          </Text>
          <ProgressBar ratio={phase.ratio} />
          <Muted>{t('makingOnDevice')}</Muted>
          <FocusedButton label={t('cancel')} variant="secondary" onPress={cancel} testID="export-cancel" />
        </View>
      ) : phase.step === 'error' ? (
        <View style={{ gap: SPACE.md }}>
          <InlineError
            message={describeAudioSourceError(lang, phase.error) ?? `${t('exportFailed', { message: errorMessage(phase.error) })} ${t('exportFailedHint')}`}
            testID="export-error"
          />
          <FocusedButton label={t('exportAgain')} variant="secondary" onPress={() => setPhase({ step: 'choose' })} testID="export-again" />
        </View>
      ) : (
        <Result
          kind={phase.kind}
          files={phase.files}
          previews={phase.previews}
          ratio={iw / ih}
          copied={copied}
          shareNote={shareNote}
          onShare={() => share(phase.kind, phase.files)}
          onDownload={() => download(phase.files)}
          onCopyLink={copyLink}
          onAgain={() => setPhase({ step: 'choose' })}
        />
      )}
    </View>
  )
}

function Result({
  kind,
  files,
  previews,
  ratio,
  copied,
  shareNote,
  onShare,
  onDownload,
  onCopyLink,
  onAgain,
}: {
  kind: Kind
  files: ExportedFile[]
  previews: string[]
  ratio: number
  copied: boolean
  shareNote: string | null
  onShare: () => void
  onDownload: () => void
  onCopyLink: () => void
  onAgain: () => void
}) {
  const th = useTheme()
  const { t, lang, count } = useT()
  const arabic = lang === 'ar'
  const many = files.length > 1
  const total = files.reduce((n, f) => n + f.blob.size, 0)
  const title = kind === 'video' ? t('videoReady') : many ? t('imagesReady') : t('imageReady')
  // thumbnails keep the clip's shape; a wide clip gets wider thumbnails
  const thumbW = many ? (ratio >= 1 ? 88 : 52) : ratio >= 1 ? 112 : 64
  const thumbH = Math.round(thumbW / ratio)
  return (
    <View style={{ gap: SPACE.md }} testID="export-done">
      <View style={[styles.result, many ? styles.resultMany : styles.resultOne, { borderColor: th.hairline, backgroundColor: th.bg }]}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={[TYPE.title, { color: th.text }]}>{title}</Text>
          {many ? (
            <Text style={[TYPE.caption, { color: th.textMuted }]} testID="export-done-count">
              {count(files.length, 'image')}
            </Text>
          ) : (
            <Text style={[TYPE.caption, { color: th.textMuted }]} {...uiPlatform.ltrProps} numberOfLines={1}>
              {files[0]?.fileName}
            </Text>
          )}
          <Text style={[TYPE.caption, { color: th.textMuted }]}>{t('fileSize', { size: formatMegabytes(total, arabic) })}</Text>
        </View>
        {previews.length > 0 ? (
          <View style={styles.thumbs}>
            {previews.map((uri, i) => (
              <Image
                key={uri}
                source={{ uri }}
                style={[styles.thumb, { width: thumbW, height: thumbH, borderColor: th.hairline }]}
                resizeMode="contain"
                accessibilityLabel={many ? t('pageThumbLabel', { k: i + 1 }) : title}
                testID={`export-thumb-${i + 1}`}
              />
            ))}
          </View>
        ) : (
          <View style={[styles.thumbIcon, { backgroundColor: th.stage }]}>
            <Icon name={kind === 'video' ? 'video' : 'image'} size={26} color={th.onStage} />
          </View>
        )}
      </View>
      <FocusedButton
        testID="share-file"
        variant="primary"
        icon="share"
        label={kind === 'video' ? t('shareVideo') : many ? t('shareImages') : t('shareImage')}
        onPress={onShare}
      />
      <View style={styles.row2}>
        <Button
          testID="download-file"
          variant="secondary"
          icon="download"
          label={kind === 'video' ? t('downloadVideo') : many ? t('downloadImages') : t('downloadImage')}
          onPress={onDownload}
          style={{ flex: 1 }}
        />
        <Button testID="copy-link" variant="secondary" icon={copied ? 'check' : 'link'} label={copied ? t('linkCopied') : t('copyLink')} onPress={onCopyLink} style={{ flex: 1 }} />
      </View>
      {many ? <Muted>{t('multiDownloadHint')}</Muted> : null}
      {shareNote ? <Note icon="alert">{shareNote}</Note> : null}
      <Button label={t('exportAgain')} variant="quiet" onPress={onAgain} testID="export-again" />
    </View>
  )
}

/** A Button that takes keyboard focus when it appears: the control that had focus (the option pressed, the progress
 *  view) has just gone, and focus must not fall back to the page behind the sheet. */
function FocusedButton(props: Omit<ComponentProps<typeof Button>, 'ref'>) {
  const ref = useFocusOnMount<ComponentRef<typeof Pressable>>()
  return <Button {...props} ref={ref} />
}

function Option({
  title,
  sub,
  meta,
  metaTestID,
  icon,
  disabled,
  onPress,
  testID,
}: {
  title: string
  sub: string
  meta?: string
  metaTestID?: string
  icon: 'video' | 'image'
  disabled?: boolean
  onPress: () => void
  testID?: string
}) {
  const th = useTheme()
  const { lang } = useT()
  // the UI's direction, not the first letter's: «بصيغة MP4، …» must not be laid out as a Latin line
  const dir = uiPlatform.dirProps(lang === 'ar' ? 'rtl' : 'ltr')
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={meta ? `${title}. ${sub}. ${meta}` : `${title}. ${sub}`}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderColor: th.hairline, backgroundColor: pressed ? th.bg : th.surface, opacity: disabled ? 0.55 : 1 },
      ]}
    >
      <View style={[styles.optIcon, { backgroundColor: disabled ? th.skeleton : th.primary }]}>
        <Icon name={icon} size={24} color={disabled ? th.textMuted : th.onPrimary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[TYPE.title, { color: th.text }]}>{title}</Text>
        <Text style={[TYPE.caption, { color: th.textMuted }]} {...dir}>
          {sub}
        </Text>
        {meta ? (
          <Text style={[TYPE.caption, { color: th.text }]} testID={metaTestID} {...dir}>
            {meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, borderWidth: 1, borderRadius: RADIUS.control, padding: SPACE.md, minHeight: 72 },
  optIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  result: { gap: SPACE.md, borderWidth: 1, borderRadius: RADIUS.control, padding: SPACE.md },
  // one file: its thumbnail beside the text; several: the page thumbnails in a row under it
  resultOne: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-end' },
  resultMany: { flexDirection: 'column' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  thumb: { borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  thumbIcon: { width: 64, height: 64, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row2: { flexDirection: 'row', gap: SPACE.sm, flexWrap: 'wrap' },
})
