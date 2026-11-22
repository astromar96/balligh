// Web audio assembly: fetch (CORS) + decodeAudioData on a 48 kHz OfflineAudioContext, then the pure clip
// decisions (clips.ts) and one sample-exact cut + fade + concatenation into a 48 kHz stereo AudioBuffer.
// Per-ayah files are fetched whole (cacheable by the service worker, decoded once, LRU by URL); chapter
// files are fetched as HTTP Range windows (mp3.ts), never whole (research/media-pipeline.md N2/N4).
//
// Reference timeline = Chrome's decodeAudioData == ffmpeg (what the word timings were computed on). WebKit
// differs only on UNTAGGED MP3s, which it decodes 529 samples early: measured once per page with a probe
// (decoderSkew.web.ts) and compensated here, on whole files and on raw windows alike (N3).
import type { AudioClip, AudioPlan, ClipResult } from '../core/types'
import { clipSamples, MIN_FADE_MS, mixPieces, OUTPUT_RATE, resolveClip, type DecodedSpan, type MixPiece } from './clips'
import { untaggedDecoderSkew } from './decoderSkew.web'
import { frameLevelsDb, HOP_MS, type EnvelopeWindow } from './envelope'
import { AudioSourceError } from './errors'
import type { AssembledAudio } from './index'
import { LruCache } from './lru'
import {
  assembleSlice,
  averageFrameBytes,
  id3v2Size,
  parseMp3Head,
  planSlice,
  primingSamples,
  readTagFrame,
  resignLameCrc,
  type Mp3Head,
  type SlicePlan,
} from './mp3'

const HEAD_BYTES = 64 * 1024
/** research/audio-timing.md §7: decode ±1 s around the cut */
const MARGIN_MS = 1000
/** §7 step 6: the first ≥ 100 ms of a Range window differ from a full decode (bit reservoir / overlap) */
const WARMUP_MS = 100
/** the last frames of a window lack the next frame's overlap: never use its final 60 ms (unless it is the file end) */
const TAIL_GUARD_MS = 60
/** pause snapping looks 1300 ms before / 700 ms after an edge; onset extension up to 3 s back */
const SNAP_MARGIN_BEFORE_MS = 1300 + 200
const SNAP_MARGIN_AFTER_MS = 700 + 300
const ONSET_MARGIN_MS = 3000
const CONCURRENCY = 4
/** a server that ignores Range and answers 200: accept the body only for small files */
const MAX_IGNORED_RANGE_BYTES = 8 * 1024 * 1024
/** a per-ayah file is at most a few MB; anything bigger is a chapter file passed as per-ayah (would decode to GBs) */
const MAX_WHOLE_FILE_BYTES = 32 * 1024 * 1024
/** one window longer than this would decode to gigabytes; the planner should never ask for it */
const MAX_WINDOW_MS = 30 * 60 * 1000
/**
 * No response, or no body bytes, for this long = a stalled request: abort it and retry once (N5: one CDN
 * preflight hung 75 s while a retry took 0.2 s). A slow download that keeps receiving bytes never times out.
 */
const STALL_TIMEOUT_MS = 15_000

export { AudioSourceError, type AudioSourceErrorCode } from './errors'

/** v4 recitations 6, 11 and 12 return protocol-relative URLs ("//mirrors.quranicaudio.com/…", N6). */
export function absoluteAudioUrl(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

interface Decoded {
  buffer: AudioBuffer
  span: DecodedSpan
  env?: EnvelopeWindow
}

const sizeOfDecoded = (d: Decoded) => d.buffer.length * d.buffer.numberOfChannels * 4
/**
 * Decoded sources by URL (whole files) or URL#range (windows): ~40 entries, ≤ 256 MiB of PCM, each at most a day old.
 * Memory only (QF Developer Terms, 00-gaps §2.9: QF recordings are kept ≤ 1 week and exports are not kept in the
 * app): nothing media/ fetches, decodes or exports is written to disk, IndexedDB, OPFS or Cache Storage — a
 * service worker, if any, applies src/data/cache-policy.json to the network requests themselves.
 */
const decodedCache = new LruCache<string, Decoded>(40, 256 * 1024 * 1024, sizeOfDecoded, { maxAgeMs: 24 * 60 * 60 * 1000 })
const inFlight = new Map<string, Promise<Decoded>>()

interface HeadEntry {
  head: Mp3Head
  /** total file size when known (Info tag totals, or a readable Content-Range) */
  totalBytes: number | null
}
const heads = new Map<string, Promise<HeadEntry>>()

let decodeContext: OfflineAudioContext | null = null
function decoder(): OfflineAudioContext {
  // decodeAudioData resamples to the context rate: decoding on a 48 kHz context = decode + one resample.
  if (!decodeContext) decodeContext = new OfflineAudioContext(2, 1, OUTPUT_RATE)
  return decodeContext
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

function httpError(url: string, status: number, what: string): AudioSourceError {
  const hint = status === 416 ? ' (the requested time is past the end of the file)' : ''
  return new AudioSourceError('http', url, `media: HTTP ${status} for ${what}${url}${hint}`, status)
}

type Attempt<T> = (signal: AbortSignal, keepAlive: () => void) => Promise<T>

/**
 * Runs a network attempt under a stall watchdog (no progress for STALL_TIMEOUT_MS aborts it; the attempt
 * calls keepAlive whenever bytes arrive) and retries once after a stall, a network error or an HTTP 5xx.
 * The caller's abort always wins and surfaces as an AbortError DOMException.
 */
async function withRetry<T>(url: string, signal: AbortSignal | undefined, attempt: Attempt<T>): Promise<T> {
  for (let i = 0; ; i++) {
    throwIfAborted(signal)
    const ctl = new AbortController()
    let stalled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const keepAlive = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        stalled = true
        ctl.abort()
      }, STALL_TIMEOUT_MS)
    }
    const onAbort = () => ctl.abort()
    signal?.addEventListener('abort', onAbort)
    keepAlive()
    try {
      return await attempt(ctl.signal, keepAlive)
    } catch (e) {
      if (signal?.aborted) throw abortError()
      const serverError = e instanceof AudioSourceError && e.code === 'http' && (e.status ?? 0) >= 500
      // fetch() and body reads reject with a TypeError on network (and CORS) failures
      const transient = stalled || serverError || e instanceof TypeError
      if (!transient) throw e
      const why = stalled ? `no data for ${STALL_TIMEOUT_MS / 1000} s` : e instanceof Error ? e.message : String(e)
      if (i === 0) {
        console.info(`[media] ${url}: ${why}; retrying once`)
        continue
      }
      if (serverError) throw e
      throw new AudioSourceError(stalled ? 'timeout' : 'network', url, `media: could not download ${url} (${why}; retried once)`)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

function get(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, mode: 'cors', credentials: 'omit', signal })
}

/** Reads a body, re-arming the stall watchdog on every chunk. Null when it exceeds `limit` bytes. */
async function readBody(res: Response, keepAlive: () => void, limit = Infinity): Promise<Uint8Array | null> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer())
    return all.length > limit ? null : all
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    keepAlive()
    n += value.length
    if (n > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(n)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {})
}

function totalFromContentRange(res: Response): number | null {
  // Only readable where the CDN exposes it (cdn.mp3quran.net); BunnyCDN hosts hide it.
  const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')
  return m ? Number(m[1]) : null
}

/** Bytes lo..hi (inclusive). Only simple "bytes=a-b" ranges: CORS-safelisted, no preflight (finding C). */
export function fetchRange(url: string, lo: number, hi: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; total: number | null }> {
  return withRetry(url, signal, async (s, keepAlive) => {
    const res = await get(url, s, { headers: { Range: `bytes=${lo}-${hi}` } })
    keepAlive()
    if (res.status === 206) return { bytes: (await readBody(res, keepAlive))!, total: totalFromContentRange(res) }
    if (res.status === 200) {
      // the server ignored Range: fine for a small file, never for a chapter
      const len = Number(res.headers.get('content-length') ?? NaN)
      const all = len > MAX_IGNORED_RANGE_BYTES ? null : await readBody(res, keepAlive, MAX_IGNORED_RANGE_BYTES)
      if (!all) {
        await discard(res)
        throw new AudioSourceError('range-ignored', url, `media: ${url} ignored the Range request (HTTP 200 for a large file)`)
      }
      return { bytes: all.subarray(lo, hi + 1), total: all.length }
    }
    await discard(res)
    throw httpError(url, res.status, `bytes ${lo}-${hi} of `)
  })
}

function fetchWhole(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  return withRetry(url, signal, async (s, keepAlive) => {
    const res = await get(url, s)
    keepAlive()
    if (!res.ok) {
      await discard(res)
      throw httpError(url, res.status, '')
    }
    const bytes = await readBody(res, keepAlive, MAX_WHOLE_FILE_BYTES)
    if (!bytes) {
      throw new AudioSourceError('too-long', url, `media: ${url} is larger than ${MAX_WHOLE_FILE_BYTES >> 20} MiB; it is not a per-ayah file`)
    }
    return bytes
  })
}

async function decode(bytes: Uint8Array, url: string): Promise<AudioBuffer> {
  // decodeAudioData takes (and detaches) a whole ArrayBuffer
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice()
  try {
    return await decoder().decodeAudioData(whole.buffer as ArrayBuffer)
  } catch (e) {
    throw new AudioSourceError('decode', url, `media: could not decode ${url} (${e instanceof Error ? e.message : String(e)})`)
  }
}

/** ms this engine decodes an untagged MP3 early relative to the reference timeline (WebKit: 529 samples). */
async function untaggedSkewMs(sampleRate: number): Promise<number> {
  return ((await untaggedDecoderSkew()) / sampleRate) * 1000
}

function loadHead(url: string, signal?: AbortSignal): Promise<HeadEntry> {
  let p = heads.get(url)
  if (!p) {
    p = (async (): Promise<HeadEntry> => {
      const first = await fetchRange(url, 0, HEAD_BYTES - 1, signal)
      const id3 = id3v2Size(first.bytes)
      let bytes = first.bytes
      let base = 0
      // a large ID3 tag (cover art): read the head again from the tag's end
      if (id3 + 8192 > bytes.length && bytes.length === HEAD_BYTES) {
        bytes = (await fetchRange(url, id3, id3 + HEAD_BYTES - 1, signal)).bytes
        base = id3
      }
      const head = parseMp3Head(bytes, base, id3)
      if (head === 'vbr') {
        throw new AudioSourceError(
          'vbr',
          url,
          `media: ${url} is a variable-bitrate MP3 (Xing/VBRI tag or mixed frame bitrates); a time window cannot be cut from it with Range requests — use this reciter's per-ayah files`,
        )
      }
      if (head === 'no-sync') throw new AudioSourceError('no-sync', url, `media: no MP3 frame found at the start of ${url}`)
      const total = first.total ?? (head.tagBytes ? head.id3Bytes + head.tagBytes : null)
      return { head, totalBytes: total }
    })()
    heads.set(url, p)
    p.catch(() => heads.delete(url))
  }
  return p
}

async function fileTotalBytes(url: string, entry: HeadEntry, signal?: AbortSignal): Promise<number> {
  if (entry.totalBytes !== null) return entry.totalBytes
  // HEAD content-length is readable cross-origin (N4)
  const len = await withRetry(url, signal, async (s) => {
    const res = await get(url, s, { method: 'HEAD' })
    if (!res.ok) throw httpError(url, res.status, 'HEAD ')
    return Number(res.headers.get('content-length') ?? NaN)
  })
  if (!Number.isFinite(len)) throw new AudioSourceError('http', url, `media: could not read the size of ${url}`)
  entry.totalBytes = len
  return len
}

/** File time (ms) of the end of a CBR file of `totalBytes`. */
function fileEndMs(head: Mp3Head, totalBytes: number): number {
  const frames = (totalBytes - head.audioStart) / averageFrameBytes(head)
  const { sampleRate: sr, samplesPerFrame: spf } = head.audio
  return ((frames * spf - primingSamples(head)) / sr) * 1000
}

type SourceRequest =
  | { kind: 'whole'; key: string; url: string }
  | { kind: 'slice'; key: string; url: string; head: Mp3Head; plan: SlicePlan; totalBytes: number | null }

/**
 * Shared in-flight work carries the signal of whoever started it: when THAT caller aborts, a caller
 * that did not abort retries with its own signal instead of failing.
 */
async function sharedWork<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (!isAbort(e) || signal?.aborted) throw e
    return run()
  }
}

function loadDecoded(req: SourceRequest, signal?: AbortSignal): Promise<Decoded> {
  return sharedWork(() => loadDecodedOnce(req, signal), signal)
}

function loadDecodedOnce(req: SourceRequest, signal?: AbortSignal): Promise<Decoded> {
  const hit = decodedCache.get(req.key)
  if (hit) return Promise.resolve(hit)
  let p = inFlight.get(req.key)
  if (!p) {
    p = (req.kind === 'whole' ? loadWhole(req.url, signal) : loadSlice(req, signal)).then((d) => {
      decodedCache.set(req.key, d)
      return d
    })
    inFlight.set(req.key, p)
    const forget = () => inFlight.delete(req.key)
    p.then(forget, forget)
  }
  return p
}

async function loadWhole(url: string, signal?: AbortSignal): Promise<Decoded> {
  const bytes = await fetchWhole(url, signal)
  const tag = readTagFrame(bytes, id3v2Size(bytes))
  // AudioToolbox ignores a LAME tag whose CRC is wrong and then keeps the priming; 2 bytes fix it (N3)
  if (tag && resignLameCrc(bytes, tag)) console.info(`[media] ${url}: repaired an invalid LAME tag CRC before decoding`)
  const startMs = tag && !tag.tag ? await untaggedSkewMs(tag.header.sampleRate) : 0
  const buffer = await decode(bytes, url)
  const durationMs = (buffer.length / buffer.sampleRate) * 1000
  return { buffer, span: { startMs, durationMs, usableFromMs: startMs, usableToMs: startMs + durationMs, reachesFileEnd: true } }
}

async function loadSlice(req: Extract<SourceRequest, { kind: 'slice' }>, signal?: AbortSignal): Promise<Decoded> {
  const { url, head, plan } = req
  const r = await fetchRange(url, plan.lo, plan.hi, signal)
  const total = r.total ?? req.totalBytes
  const slice = assembleSlice(head, plan, r.bytes, plan.lo)
  if (slice === 'vbr') {
    throw new AudioSourceError('vbr', url, `media: ${url} changes bitrate inside the requested window (VBR); it cannot be cut with Range requests`)
  }
  if (slice === 'no-sync') throw new AudioSourceError('no-sync', url, `media: no MP3 frame in bytes ${plan.lo}-${plan.hi} of ${url}`)
  // The frame index is rounded from the byte offset: exact while the CBR drift stays under half a frame.
  // Tagged files correct the drift with the tag totals; untagged ones (Yasser) only have this canary.
  const fb = averageFrameBytes(head)
  const residual = slice.firstFrameOffset - (head.audioStart + slice.frameIndex * fb)
  if (Math.abs(residual) > fb / 4) {
    console.warn(`[media] ${url}: frame ${slice.frameIndex} sits ${residual.toFixed(0)} B from its predicted offset; the window may be a frame off`)
  }
  const buffer = await decode(slice.bytes, url)
  const durationMs = (buffer.length / buffer.sampleRate) * 1000
  const eof = r.bytes.length < plan.hi - plan.lo + 1 || (total !== null && plan.hi >= total - 1)
  const reachesFileEnd = eof && slice.hitEnd
  // a raw (untagged) window is decoded like an untagged file: early by the engine's skew
  const startMs = slice.startMs + (head.infoFrame ? 0 : await untaggedSkewMs(head.audio.sampleRate))
  return {
    buffer,
    span: {
      startMs,
      durationMs,
      // the true file start has no warm-up; anywhere else the first 100 ms are not trusted
      usableFromMs: slice.frameIndex === 0 ? startMs : startMs + WARMUP_MS,
      usableToMs: startMs + durationMs - (reachesFileEnd ? 0 : TAIL_GUARD_MS),
      reachesFileEnd,
    },
  }
}

function envelopeOf(d: Decoded): EnvelopeWindow {
  if (!d.env) {
    // Level frames on a grid of whole HOP_MS steps of FILE time: where a window happens to start (or the
    // engine's untagged-MP3 skew) then cannot move a snapped cut.
    const perMs = d.buffer.sampleRate / 1000
    const skip = Math.round((Math.ceil(d.span.startMs / HOP_MS) * HOP_MS - d.span.startMs) * perMs)
    const channels: Float32Array[] = []
    for (let c = 0; c < d.buffer.numberOfChannels; c++) channels.push(d.buffer.getChannelData(c).subarray(skip))
    d.env = {
      levels: frameLevelsDb(channels, d.buffer.sampleRate),
      startMs: d.span.startMs + skip / perMs,
      usableFromMs: d.span.usableFromMs,
      usableToMs: d.span.usableToMs,
    }
  }
  return d.env
}

async function sourceRequestFor(clip: AudioClip, signal?: AbortSignal): Promise<SourceRequest> {
  const url = absoluteAudioUrl(clip.url)
  if (clip.fileKind === 'per_ayah') return { kind: 'whole', key: url, url }
  const entry = await sharedWork(() => loadHead(url, signal), signal)
  const { head } = entry
  if (clip.bitrateKbps !== null && clip.bitrateKbps !== head.audio.bitrateKbps) {
    console.info(`[media] ${url}: catalogue says ${clip.bitrateKbps} kbps, the frames say ${head.audio.bitrateKbps} kbps — using the frames`)
  }
  let before = MARGIN_MS + WARMUP_MS
  let after = MARGIN_MS
  if (clip.snapToPause) {
    before = Math.max(before, SNAP_MARGIN_BEFORE_MS + WARMUP_MS)
    after = Math.max(after, SNAP_MARGIN_AFTER_MS)
  }
  if (clip.extendToSpeechOnset) before = Math.max(before, ONSET_MARGIN_MS + WARMUP_MS)
  const endMs = clip.srcEndMs ?? fileEndMs(head, await fileTotalBytes(url, entry, signal))
  if (endMs - clip.srcStartMs > MAX_WINDOW_MS) {
    throw new AudioSourceError('too-long', url, `media: one clip of ${Math.round((endMs - clip.srcStartMs) / 1000)} s is too long to assemble`)
  }
  const plan = planSlice(head, clip.srcStartMs - before, endMs + after)
  return { kind: 'slice', key: `${url}#${plan.lo}-${plan.hi}`, url, head, plan, totalBytes: entry.totalBytes }
}

/** Runs fn over items with at most `limit` in flight; stops starting new work after the first failure. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch (e) {
        failed = true
        throw e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function createOutputBuffer(length: number): AudioBuffer {
  if (typeof AudioBuffer === 'function') {
    try {
      return new AudioBuffer({ numberOfChannels: 2, length, sampleRate: OUTPUT_RATE })
    } catch {
      // Safari < 14.1 has no AudioBuffer constructor
    }
  }
  return decoder().createBuffer(2, length, OUTPUT_RATE)
}

export async function assembleAudioWeb(
  plan: AudioPlan,
  opts: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {},
): Promise<AssembledAudio> {
  const { signal, onProgress } = opts
  throwIfAborted(signal)
  if (!plan.clips.length) throw new AudioSourceError('empty', '', 'media: the audio plan has no clips')
  onProgress?.(0)

  // 1. what to fetch: one request per clip (chapter heads first), deduplicated by key
  const requests = await pool(plan.clips, CONCURRENCY, (clip) => sourceRequestFor(clip, signal))
  throwIfAborted(signal)
  const unique = [...new Map(requests.map((r) => [r.key, r])).values()]

  // 2. fetch + decode
  let done = 0
  const decoded = new Map<string, Decoded>()
  await pool(unique, CONCURRENCY, async (req) => {
    decoded.set(req.key, await loadDecoded(req, signal))
    throwIfAborted(signal)
    onProgress?.((0.9 * ++done) / unique.length)
  })
  throwIfAborted(signal)

  // 3. per clip: final window, then one sample-exact cut + fade + concatenation
  const perMs = OUTPUT_RATE / 1000
  const pieces: MixPiece[] = []
  const results: ClipResult[] = []
  plan.clips.forEach((clip, i) => {
    const d = decoded.get(requests[i].key)!
    const resolved = resolveClip(clip, d.span, () => envelopeOf(d))
    if (resolved.notes.length) console.info(`[media] clip ${i} (${requests[i].url}): ${resolved.notes.join('; ')}`)
    const { offset, length } = clipSamples(d.span, resolved.srcStartMs, resolved.srcEndMs)
    const channels: Float32Array[] = []
    for (let c = 0; c < d.buffer.numberOfChannels; c++) channels.push(d.buffer.getChannelData(c))
    pieces.push({
      channels,
      offset,
      length,
      fadeIn: Math.max(MIN_FADE_MS, clip.fadeInMs) * perMs,
      fadeOut: Math.max(MIN_FADE_MS, clip.fadeOutMs) * perMs,
    })
    results.push({
      srcStartMs: d.span.startMs + offset / perMs,
      durationMs: length / perMs,
      wordTimingsValid: resolved.wordTimingsValid,
    })
  })
  const total = pieces.reduce((n, p) => n + p.length, 0)
  if (total <= 0) throw new AudioSourceError('empty', plan.clips[0].url, 'media: the selected audio is empty after cutting')
  const out = createOutputBuffer(total)
  mixPieces([out.getChannelData(0), out.getChannelData(1)], pieces)
  onProgress?.(1)
  return { audio: out, clips: results }
}
