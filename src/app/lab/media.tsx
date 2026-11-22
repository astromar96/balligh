// Dev-only web test bench for src/media: /lab/media (?run=all or ?run=detect,slices,pages,istiadha,…; add
// &aac=polyfill to force the WASM AAC encoder — honoured in development builds only). Headless drivers: scratchpad
// harness/media-lab*.mjs. The logic lives in src/media/lab/bench.web.ts; this route renders the log and manual
// controls. A run is an external process: its state lives in a small store outside React that the screen
// subscribes to (useSyncExternalStore), so starting one from the mount effect sets no React state there.
import { useEffect, useSyncExternalStore } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ExportedFile } from '../../core/types'
import { canShareFile, canShareFiles, createPreviewPlayer, downloadFile, shareFile, shareFiles, shareLink, type PreviewPlayer } from '../../media'
import { runMediaLab, type LabOutput } from '../../media/lab/bench.web'

type LabWindow = typeof globalThis & {
  __mediaLab?: {
    done: boolean
    log: string[]
    results: Record<string, unknown> | null
    fileBase64(name: string): Promise<string | null>
    pcmBase64(name: string): string | null
  }
}

interface LabState {
  lines: string[]
  running: boolean
  out: LabOutput | null
  playing: boolean
}

function createStore(initial: LabState) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<LabState>) {
      state = { ...state, ...patch }
      for (const l of [...listeners]) l()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const store = createStore({ lines: [], running: false, out: null, playing: false })
let player: PreviewPlayer | null = null

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function log(line: string): void {
  console.log(`[media-lab] ${line}`)
  store.set({ lines: [...store.get().lines, line] })
}

async function run(only: string[] | null): Promise<void> {
  if (store.get().running) return
  store.set({ running: true })
  const w = globalThis as LabWindow
  w.__mediaLab = { done: false, log: store.get().lines, results: null, fileBase64: async () => null, pcmBase64: () => null }
  const result = await runMediaLab(only, log)
  store.set({ out: result })
  w.__mediaLab = {
    done: true,
    log: store.get().lines,
    results: JSON.parse(JSON.stringify(result.results, (k, v) => (k === 'assembled' ? undefined : v))),
    fileBase64: async (name) => {
      const f = result.files[name]
      return f ? toBase64(new Uint8Array(await f.blob.arrayBuffer())) : null
    },
    pcmBase64: (name) => {
      const p = result.pcm[name]
      return p ? toBase64(new Uint8Array(p.buffer, p.byteOffset, p.byteLength)) : null
    },
  }
  log('DONE')
  store.set({ running: false })
}

async function togglePlay(): Promise<void> {
  const { out } = store.get()
  if (!out) return
  if (!player) {
    const name = Object.keys(out.pcm)[0]
    if (!name) return
    // rebuild an AudioBuffer from the interleaved PCM the lab kept
    const pcm = out.pcm[name]
    const buf = new AudioBuffer({ numberOfChannels: 2, length: pcm.length / 2, sampleRate: 48000 })
    const l = buf.getChannelData(0)
    const r = buf.getChannelData(1)
    for (let i = 0; i < l.length; i++) {
      l[i] = pcm[2 * i]
      r[i] = pcm[2 * i + 1]
    }
    player = createPreviewPlayer(buf)
    player.onEnded(() => store.set({ playing: false }))
  }
  if (player.isPlaying()) {
    player.pause()
    store.set({ playing: false })
  } else {
    store.set({ playing: true })
    await player.play()
  }
}

function disposePlayer(): void {
  player?.dispose()
  player = null
  store.set({ playing: false })
}

function share(f: ExportedFile): void {
  // called directly in the press handler: Web Share needs the fresh gesture
  void shareFile(f, { title: 'بلّغ', text: f.fileName }).then((r) => log(`share ${f.fileName}: ${r}`))
}

/** The still pages of the last run ("page1", "page2", …), in order. */
function pagesOf(out: LabOutput | null): ExportedFile[] {
  if (!out) return []
  const pages: ExportedFile[] = []
  for (let k = 1; out.files[`page${k}`]; k++) pages.push(out.files[`page${k}`])
  return pages
}

function sharePages(pages: ExportedFile[]): void {
  // one share sheet for every page, from this tap
  void shareFiles(pages, { title: 'بلّغ', text: `${pages.length} pages` }).then((r) => log(`share ${pages.length} pages: ${r}`))
}

export default function MediaLab() {
  const { lines, running, out, playing } = useSyncExternalStore(store.subscribe, store.get, store.get)
  const pages = pagesOf(out)

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof location === 'undefined') return
    const q = new URLSearchParams(location.search).get('run')
    if (q) void run(q.split(','))
    return disposePlayer
  }, [])

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.page}>
        <Text style={styles.line}>The media lab runs on the web only.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>media lab</Text>
      <View style={styles.row}>
        <Button label={running ? 'running…' : 'Run all'} disabled={running} onPress={() => void run(null)} />
        <Button label={playing ? 'Pause' : 'Play first audio'} disabled={!out} onPress={() => void togglePlay()} />
        <Button
          label="Share link"
          onPress={() => void shareLink(typeof location !== 'undefined' ? location.href : 'https://balligh.app', 'بلّغ').then((r) => log(`shareLink: ${r}`))}
        />
        {pages.length > 0 && (
          <Button label={`Share ${pages.length} pages (canShareFiles=${String(canShareFiles(pages))})`} onPress={() => sharePages(pages)} />
        )}
      </View>
      {out &&
        Object.entries(out.files).map(([name, f]) => (
          <View key={name} style={styles.row}>
            <Text style={styles.file}>
              {name} · {(f.blob.size / 1024).toFixed(0)} KB · canShare={String(canShareFile(f))}
            </Text>
            <Button label="Download" onPress={() => downloadFile(f)} />
            <Button label="Share" onPress={() => share(f)} />
          </View>
        ))}
      {lines.map((l, i) => (
        <Text key={i} style={styles.line} selectable>
          {l}
        </Text>
      ))}
    </ScrollView>
  )
}

function Button(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [styles.button, props.disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0F1820' },
  content: { padding: 16, gap: 8 },
  title: { color: '#ECE6D8', fontSize: 20, fontWeight: '600', writingDirection: 'ltr' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { backgroundColor: '#1D6B57', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: '#FBF8F0', fontSize: 14 },
  file: { color: '#ECE6D8', fontSize: 13, writingDirection: 'ltr' },
  line: { color: '#ECE6D8', fontSize: 12, fontFamily: Platform.select({ web: 'ui-monospace, monospace', default: undefined }), writingDirection: 'ltr', textAlign: 'left' },
})
