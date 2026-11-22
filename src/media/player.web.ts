// Web preview player: the assembled AudioBuffer through an AudioBufferSourceNode on one shared
// AudioContext. The position comes from the AUDIO clock, compensated for output latency
// (research/media-pipeline.md §9.4 rule 3): getOutputTimestamp() gives the context time being heard at
// a performance.now() instant, so the heard position is interpolated from it; fallback
// currentTime − outputLatency.
import type { PcmAudio, PreviewPlayer } from './index'

let shared: AudioContext | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let playingCount = 0
/** suspend the shared context this long after the last playback stops (battery) */
const IDLE_SUSPEND_MS = 4000
/** click-free stop */
const STOP_RAMP_SEC = 0.012

function audioContext(): AudioContext {
  if (!shared || shared.state === 'closed') {
    // iOS: play through the silent switch (Safari 16.4+, feature-detected).
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } }
      if (nav.audioSession) nav.audioSession.type = 'playback'
    } catch {
      // not supported here
    }
    shared = new AudioContext({ latencyHint: 'interactive' })
  }
  return shared
}

function markPlaying(delta: 1 | -1): void {
  playingCount = Math.max(0, playingCount + delta)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (playingCount === 0 && shared) {
    const ctx = shared
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (playingCount === 0 && ctx.state === 'running') ctx.suspend().catch(() => {})
    }, IDLE_SUSPEND_MS)
  }
}

/** Context time (s) of the sample being heard right now. */
function heardContextTime(ctx: AudioContext): number {
  if (typeof ctx.getOutputTimestamp === 'function') {
    const ts = ctx.getOutputTimestamp()
    if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000
    }
  }
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)
}

function asAudioBuffer(audio: PcmAudio): AudioBuffer {
  if (typeof AudioBuffer !== 'undefined' && audio instanceof AudioBuffer) return audio
  throw new TypeError('media: the web preview player needs the AudioBuffer returned by assembleAudio')
}

export function createPreviewPlayerWeb(audio: PcmAudio): PreviewPlayer {
  const buffer = asAudioBuffer(audio)
  const totalMs = buffer.duration * 1000
  const listeners = new Set<() => void>()
  let source: AudioBufferSourceNode | null = null
  let gain: GainNode | null = null
  let playing = false
  let disposed = false
  /** heard position when paused */
  let pausedMs = 0
  /** while playing: position anchorMs is heard at context time anchorCtx */
  let anchorMs = 0
  let anchorCtx = 0
  let generation = 0

  const clampMs = (ms: number) => Math.min(totalMs, Math.max(0, Number.isFinite(ms) ? ms : 0))

  const positionNow = (): number => {
    if (!playing || !shared) return pausedMs
    const t = anchorMs + (heardContextTime(shared) - anchorCtx) * 1000
    return Math.min(totalMs, Math.max(anchorMs, t))
  }

  const stopSource = () => {
    generation++
    const s = source
    const g = gain
    source = null
    gain = null
    if (!s || !g || !shared) return
    const now = shared.currentTime
    try {
      g.gain.setValueAtTime(g.gain.value, now)
      g.gain.linearRampToValueAtTime(0, now + STOP_RAMP_SEC)
      s.stop(now + STOP_RAMP_SEC + 0.005)
    } catch {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    s.onended = () => {
      s.disconnect()
      g.disconnect()
    }
  }

  const setPlaying = (on: boolean) => {
    if (on === playing) return
    playing = on
    markPlaying(on ? 1 : -1)
  }

  const player: PreviewPlayer = {
    play(fromMs?: number): Promise<void> {
      if (disposed) return Promise.resolve()
      // Everything below runs synchronously inside the caller's gesture (autoplay policy, iOS unlock).
      const ctx = audioContext()
      const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume()
      const startMs = clampMs(fromMs ?? (pausedMs >= totalMs - 1 ? 0 : pausedMs))
      stopSource()
      const my = generation
      const g = ctx.createGain()
      g.connect(ctx.destination)
      const s = ctx.createBufferSource()
      s.buffer = buffer
      s.connect(g)
      s.onended = () => {
        if (my !== generation) return
        source = null
        gain = null
        s.disconnect()
        g.disconnect()
        pausedMs = totalMs
        setPlaying(false)
        for (const cb of [...listeners]) cb()
      }
      // While the context is still suspended currentTime is frozen, so the anchor stays right.
      anchorCtx = ctx.currentTime
      anchorMs = startMs
      s.start(anchorCtx, startMs / 1000)
      source = s
      gain = g
      setPlaying(true)
      return resumed.then(
        () => undefined,
        (e: unknown) => {
          if (my === generation) {
            stopSource()
            pausedMs = startMs
            setPlaying(false)
          }
          throw e
        },
      )
    },
    pause() {
      if (!playing) return
      pausedMs = positionNow()
      stopSource()
      setPlaying(false)
    },
    seek(ms: number) {
      const target = clampMs(ms)
      if (playing) {
        player.play(target).catch(() => {})
      } else {
        pausedMs = target
      }
    },
    isPlaying: () => playing,
    currentMs: positionNow,
    durationMs: () => totalMs,
    onEnded(cb: () => void) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    dispose() {
      if (disposed) return
      stopSource()
      setPlaying(false)
      listeners.clear()
      disposed = true
    },
  }
  return player
}
