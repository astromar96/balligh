// Pure level-envelope analysis on decoded PCM: speech threshold, quiet runs, pause snapping (class D) and
// speech-onset extension (finding B). No I/O, no DOM.
//
// Sources: research/audio-timing.md §5/§6 (speechBounds: 10 ms frames, threshold = peak − 30 dB with a
// −50 dBFS floor), "Independent verification" #12 (snap to the LONGEST sub-threshold run in
// [t − 1300, t + 700] ms, fall back to t when no run ≥ 150 ms) and new finding B (speech before a late
// first segment, kept unless separated by a pause ≥ ~700 ms, which marks a reciter repetition).

/** Envelope hop: one level per 10 ms. */
export const HOP_MS = 10

export const SNAP_BEFORE_MS = 1300
export const SNAP_AFTER_MS = 700
export const MIN_PAUSE_MS = 150
/** silence kept before the onset when a clip START is snapped into a pause */
export const SNAP_LEAD_MS = 150
/** reverb kept after the last sound when a clip END is snapped into a pause */
export const SNAP_TAIL_MS = 250
/** a pause at least this long between early speech and the first segment means a repetition: keep the segment start */
export const REPETITION_PAUSE_MS = 700
/** start this much before the detected speech onset */
export const ONSET_LEAD_MS = 50
/** finding B ignores speech closer than this to the first segment */
export const ONSET_GUARD_MS = 60
/** less speech than this before the first segment is a click or breath, not a missed word */
export const MIN_SPEECH_MS = 100

/**
 * Level per 10 ms hop in dBFS (mean power across channels; −120 for digital silence). `channels` must
 * share one length.
 */
export function frameLevelsDb(channels: readonly Float32Array[], sampleRate: number, hopMs = HOP_MS): Float32Array {
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000))
  const len = channels.length ? channels[0].length : 0
  const n = Math.floor(len / hop)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let acc = 0
    const a = f * hop
    for (const ch of channels) for (let i = a; i < a + hop; i++) acc += ch[i] * ch[i]
    const mean = acc / (hop * channels.length)
    out[f] = mean > 1e-12 ? 10 * Math.log10(mean) : -120
  }
  return out
}

/** Speech threshold of research/audio-timing.md speechBounds(): peak − 30 dB, never below −50 dBFS. */
export function speechThresholdDb(levels: Float32Array, relDb = 30, floorDb = -50): number {
  let peak = -120
  for (let i = 0; i < levels.length; i++) if (levels[i] > peak) peak = levels[i]
  return Math.max(peak - relDb, floorDb)
}

export interface Run {
  /** first frame of the run */
  start: number
  /** frame after the last one */
  end: number
}

/**
 * Longest run of frames with level ≤ threshold inside frames [from, to); ties go to the run whose centre
 * is nearest `target`. null when the range holds no quiet frame.
 */
export function longestQuietRun(levels: Float32Array, thresholdDb: number, from: number, to: number, target = from): Run | null {
  const a = Math.max(0, Math.floor(from))
  const b = Math.min(levels.length, Math.ceil(to))
  let best: Run | null = null
  let i = a
  while (i < b) {
    if (levels[i] > thresholdDb) {
      i++
      continue
    }
    let j = i
    while (j < b && levels[j] <= thresholdDb) j++
    const len = j - i
    const bestLen = best ? best.end - best.start : -1
    if (!best || len > bestLen || (len === bestLen && Math.abs((i + j) / 2 - target) < Math.abs((best.start + best.end) / 2 - target))) {
      best = { start: i, end: j }
    }
    i = j
  }
  return best
}

export interface EnvelopeWindow {
  /** dB per hop */
  levels: Float32Array
  /** file time (ms) of the first hop */
  startMs: number
  /** file-time range the result may use (warm-up of a Range window excluded) */
  usableFromMs: number
  usableToMs: number
}

/**
 * Class D boundary snapping (audio-timing.md "Independent verification" #12): the longest sub-threshold
 * run within [t − 1300, t + 700] ms; when it lasts ≥ 150 ms the boundary moves inside it — a START keeps
 * ≤ 150 ms of silence before the speech that ends the run, an END keeps ≤ 250 ms of tail after the speech
 * that starts it (never more than half the run). Otherwise t is returned unchanged.
 */
export function snapToPause(env: EnvelopeWindow, tMs: number, kind: 'start' | 'end'): number {
  const lo = Math.max(tMs - SNAP_BEFORE_MS, env.usableFromMs)
  const hi = Math.min(tMs + SNAP_AFTER_MS, env.usableToMs)
  if (hi - lo < MIN_PAUSE_MS) return tMs
  const thr = speechThresholdDb(env.levels)
  const toFrame = (ms: number) => (ms - env.startMs) / HOP_MS
  const run = longestQuietRun(env.levels, thr, Math.ceil(toFrame(lo)), Math.floor(toFrame(hi)), toFrame(tMs))
  if (!run) return tMs
  const runStartMs = env.startMs + run.start * HOP_MS
  const runEndMs = env.startMs + run.end * HOP_MS
  const len = runEndMs - runStartMs
  if (len < MIN_PAUSE_MS) return tMs
  return kind === 'start' ? runEndMs - Math.min(SNAP_LEAD_MS, len / 2) : runStartMs + Math.min(SNAP_TAIL_MS, len / 2)
}

/**
 * Finding B: a clip that starts at word 1 of an ayah from a word timing may begin after the reciter has
 * already started. Looks for speech in [searchFromMs, firstWordMs − 60]: when there is ≥ 100 ms of it
 * and no pause ≥ 700 ms between its onset and the first word, returns (onset − 50 ms); otherwise null
 * (no speech, a blip, or a repetition separated by a long pause).
 */
export function speechOnsetBefore(env: EnvelopeWindow, firstWordMs: number, searchFromMs: number): number | null {
  const fromMs = Math.max(searchFromMs, env.usableFromMs)
  const toMs = Math.min(firstWordMs - ONSET_GUARD_MS, env.usableToMs)
  if (toMs - fromMs < MIN_SPEECH_MS) return null
  const thr = speechThresholdDb(env.levels)
  const f0 = Math.max(0, Math.ceil((fromMs - env.startMs) / HOP_MS))
  const f1 = Math.min(env.levels.length, Math.floor((toMs - env.startMs) / HOP_MS))
  let onset = -1
  let speech = 0
  for (let f = f0; f < f1; f++) {
    if (env.levels[f] > thr) {
      if (onset < 0) onset = f
      speech++
    }
  }
  if (onset < 0 || speech * HOP_MS < MIN_SPEECH_MS) return null
  const pause = longestQuietRun(env.levels, thr, onset, f1)
  if (pause && (pause.end - pause.start) * HOP_MS >= REPETITION_PAUSE_MS) return null
  return Math.max(fromMs, env.startMs + onset * HOP_MS - ONSET_LEAD_MS)
}

/** quiet kept before the first and after the last sound when a whole file is trimmed (AudioClip.trimSilence) */
export const TRIM_KEEP_MS = 80
/** a softer sound next to the speech is kept when it rises this far above the quiet around it */
export const TRIM_NOISE_MARGIN_DB = 6
/** ...and never followed down further than this below the speech threshold */
export const TRIM_SOFT_RANGE_DB = 30
/** dips up to this long inside a soft onset/ending are bridged (a stop closure, a breath before the voice) */
export const TRIM_BRIDGE_MS = 30
/** frames at or below this are digital silence (encoder padding), not the room's quiet */
const DIGITAL_SILENCE_DB = -100

function median(values: number[]): number {
  if (!values.length) return -120
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Leading/trailing silence of a whole per-ayah file played without word timings (AudioClip.trimSilence — class C,
 * ayah-level fallbacks, the isti'adha). Speech is what rises above speechThresholdDb (peak − 30 dB of THIS file,
 * floor −50 dBFS: research/audio-timing.md §6 speechBounds). Never cuts speech: from the first/last speech frame
 * the edge follows any softer sound that still stands TRIM_NOISE_MARGIN_DB above the median quiet on that side (a
 * soft «ه» onset, a breathy final «هْ», the reverb tail), bridging dips up to 30 ms; then TRIM_KEEP_MS (80 ms) of
 * the quiet is kept. Only shrinks [fromMs, toMs] (and stays in the usable range); null when the window holds no
 * speech or there is nothing to trim.
 */
export function trimSilence(env: EnvelopeWindow, fromMs: number, toMs: number): { startMs: number; endMs: number } | null {
  const lo = Math.max(fromMs, env.usableFromMs)
  const hi = Math.min(toMs, env.usableToMs)
  const f0 = Math.max(0, Math.ceil((lo - env.startMs) / HOP_MS))
  const f1 = Math.min(env.levels.length, Math.floor((hi - env.startMs) / HOP_MS))
  if (f1 - f0 < 2) return null
  const { levels } = env
  const thr = speechThresholdDb(levels)
  let first = -1
  let last = -1
  for (let f = f0; f < f1; f++) {
    if (levels[f] > thr) {
      if (first < 0) first = f
      last = f
    }
  }
  if (first < 0) return null

  const softBelow = (from: number, to: number): number => {
    const quiet: number[] = []
    for (let f = from; f < to; f++) if (levels[f] > DIGITAL_SILENCE_DB) quiet.push(levels[f])
    return Math.min(thr, Math.max(median(quiet) + TRIM_NOISE_MARGIN_DB, thr - TRIM_SOFT_RANGE_DB))
  }
  const bridge = Math.round(TRIM_BRIDGE_MS / HOP_MS)
  // follow soft sound outward: the nearest louder-than-quiet frame within the bridge becomes the new edge
  const softLead = softBelow(f0, first)
  for (let moved = true; moved; ) {
    moved = false
    for (let f = first - 1; f >= Math.max(f0, first - 1 - bridge); f--) {
      if (levels[f] > softLead) {
        first = f
        moved = true
        break
      }
    }
  }
  const softTail = softBelow(last + 1, f1)
  for (let moved = true; moved; ) {
    moved = false
    for (let f = last + 1; f <= Math.min(f1 - 1, last + 1 + bridge); f++) {
      if (levels[f] > softTail) {
        last = f
        moved = true
        break
      }
    }
  }

  const startMs = Math.max(lo, env.startMs + first * HOP_MS - TRIM_KEEP_MS)
  const endMs = Math.min(hi, env.startMs + (last + 1) * HOP_MS + TRIM_KEEP_MS)
  if (startMs <= fromMs && endMs >= toMs) return null
  return { startMs: Math.max(startMs, fromMs), endMs: Math.min(endMs, toMs) }
}

/** First and last speech of the whole envelope (speechBounds()), in file ms; null when all of it is quiet. */
export function speechBounds(env: EnvelopeWindow): { startMs: number; endMs: number } | null {
  const thr = speechThresholdDb(env.levels)
  let first = -1
  let last = -1
  for (let f = 0; f < env.levels.length; f++) {
    if (env.levels[f] > thr) {
      if (first < 0) first = f
      last = f
    }
  }
  if (first < 0) return null
  return { startMs: env.startMs + first * HOP_MS, endMs: env.startMs + (last + 1) * HOP_MS }
}
