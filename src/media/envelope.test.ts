import envelopes from './__fixtures__/everyayah-envelopes.json'
import {
  HOP_MS,
  TRIM_KEEP_MS,
  frameLevelsDb,
  longestQuietRun,
  snapToPause,
  speechBounds,
  speechOnsetBefore,
  speechThresholdDb,
  trimSilence,
  type EnvelopeWindow,
} from './envelope'

const SPEECH = -12
const QUIET = -70

/** Envelope from [fromMs, toMs, dB] spans (10 ms hops), everything else speech. */
function envelope(totalMs: number, quiet: [number, number][], startMs = 0, level = QUIET): EnvelopeWindow {
  const levels = new Float32Array(Math.round(totalMs / HOP_MS)).fill(SPEECH)
  for (const [a, b] of quiet) for (let f = Math.round(a / HOP_MS); f < Math.round(b / HOP_MS); f++) levels[f] = level
  return { levels, startMs, usableFromMs: startMs, usableToMs: startMs + totalMs }
}

describe('levels', () => {
  it('measures a sine as its RMS level and silence as −120 dB', () => {
    const sr = 48000
    const sine = new Float32Array(sr / 10)
    for (let i = 0; i < sine.length; i++) sine[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr)
    const lv = frameLevelsDb([sine, sine], sr)
    expect(lv.length).toBe(10)
    expect(lv[3]).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1) // −9.03 dB
    expect(frameLevelsDb([new Float32Array(4800)], sr)[0]).toBe(-120)
  })

  it('thresholds at peak − 30 dB with a −50 dBFS floor', () => {
    expect(speechThresholdDb(Float32Array.from([-12, -40, -90]))).toBe(-42)
    expect(speechThresholdDb(Float32Array.from([-30, -90]))).toBe(-50)
  })

  it('finds the longest quiet run, ties nearest the target', () => {
    const lv = Float32Array.from([0, -90, -90, 0, -90, -90, -90, 0, -90, -90, -90, 0])
    expect(longestQuietRun(lv, -50, 0, lv.length)).toEqual({ start: 4, end: 7 })
    expect(longestQuietRun(lv, -50, 0, lv.length, 10)).toEqual({ start: 8, end: 11 })
    expect(longestQuietRun(lv, -50, 0, 4)).toEqual({ start: 1, end: 3 })
    expect(longestQuietRun(Float32Array.from([0, 0]), -50, 0, 2)).toBeNull()
  })
})

describe('class D pause snapping (window [t − 1300, t + 700], longest run ≥ 150 ms)', () => {
  const env = envelope(12_000, [[5000, 5600]])

  it('moves a late ayah start back into the pause, keeping 150 ms before the onset', () => {
    expect(snapToPause(env, 6200, 'start')).toBe(5450)
  })

  it('moves an early start forward into the pause (the run is clipped at t + 700)', () => {
    expect(snapToPause(env, 4700, 'start')).toBe(5250)
  })

  it('moves an end into the pause, keeping 250 ms of tail', () => {
    expect(snapToPause(env, 5900, 'end')).toBe(5250)
  })

  it('keeps t when only < 150 ms of the pause is inside the window', () => {
    expect(snapToPause(env, 6850, 'start')).toBe(6850) // window starts at 5550: 50 ms of pause
  })

  it('keeps t when there is no pause at all', () => {
    expect(snapToPause(envelope(12_000, []), 6000, 'start')).toBe(6000)
  })

  it('picks the LONGEST run, not the nearest', () => {
    const two = envelope(12_000, [[5900, 6060], [4900, 5500]])
    expect(snapToPause(two, 6000, 'start')).toBe(5350)
  })

  it('never uses the warm-up of a Range window', () => {
    const w = { ...envelope(4000, [[0, 900]], 10_000), usableFromMs: 10_100 }
    expect(snapToPause(w, 10_950, 'start')).toBe(10_750) // run clipped to [10100, 10900]
  })

  it('keeps short pauses balanced (≤ half the run on each side)', () => {
    const short = envelope(12_000, [[6000, 6200]])
    expect(snapToPause(short, 6400, 'start')).toBe(6100)
    expect(snapToPause(short, 6400, 'end')).toBe(6100)
  })
})

describe('finding B: speech before a late first segment', () => {
  it('returns onset − 50 ms when speech runs up to the first segment', () => {
    const env = envelope(8000, [[0, 300]])
    expect(speechOnsetBefore(env, 4000, 0)).toBe(250)
  })

  it('keeps the segment start when a pause ≥ 700 ms separates the early speech (repetition)', () => {
    const env = envelope(8000, [[0, 300], [1500, 2300]])
    expect(speechOnsetBefore(env, 4000, 0)).toBeNull()
  })

  it('accepts short pauses inside the early speech', () => {
    const env = envelope(8000, [[0, 300], [1500, 1900]])
    expect(speechOnsetBefore(env, 4000, 0)).toBe(250)
  })

  it('ignores a blip shorter than 100 ms and silence right before the segment', () => {
    const blip = envelope(8000, [[0, 3000], [3050, 8000]])
    expect(speechOnsetBefore(blip, 6000, 0)).toBeNull()
    const quiet = envelope(8000, [[0, 3960]])
    expect(speechOnsetBefore(quiet, 4000, 0)).toBeNull() // speech only within the 60 ms guard
  })

  it('never searches before searchFromMs', () => {
    const env = envelope(8000, [[2000, 2300]], 0)
    expect(speechOnsetBefore(env, 4000, 2000)).toBe(2250)
  })
})

describe('speech bounds', () => {
  it('finds the first and last speech hop', () => {
    expect(speechBounds(envelope(5000, [[0, 420], [3700, 5000]]))).toEqual({ startMs: 420, endMs: 3700 })
    expect(speechBounds({ levels: new Float32Array(10).fill(-120), startMs: 0, usableFromMs: 0, usableToMs: 100 })).toBeNull()
  })
})

/** Envelope from consecutive [fromMs, toMs, dB] spans. */
function shape(spans: [number, number, number][], startMs = 0): EnvelopeWindow {
  const totalMs = spans[spans.length - 1][1]
  const levels = new Float32Array(Math.round(totalMs / HOP_MS))
  for (const [a, b, db] of spans) for (let f = Math.round(a / HOP_MS); f < Math.round(b / HOP_MS); f++) levels[f] = db
  return { levels, startMs, usableFromMs: startMs, usableToMs: startMs + totalMs }
}

describe('trimSilence: leading/trailing silence of a whole file (keep 80 ms, never cut speech)', () => {
  it('trims both ends to 80 ms of quiet', () => {
    const env = shape([[0, 1000, -90], [1000, 4000, -12], [4000, 5500, -90]])
    expect(trimSilence(env, 0, 5500)).toEqual({ startMs: 1000 - TRIM_KEEP_MS, endMs: 4000 + TRIM_KEEP_MS })
  })

  it('keeps a soft onset that stands above the quiet (a soft «ه» before the vowel)', () => {
    const env = shape([[0, 900, -70], [900, 1000, -55], [1000, 3000, -12], [3000, 4000, -70]])
    expect(trimSilence(env, 0, 4000)).toEqual({ startMs: 820, endMs: 3080 })
  })

  it('keeps a breathy ending as it decays into the room tone (a final «هْ»)', () => {
    const env = shape([[0, 500, -80], [500, 3000, -12], [3000, 3100, -30], [3100, 3200, -40], [3200, 3300, -48], [3300, 3400, -56], [3400, 4500, -66]])
    expect(trimSilence(env, 0, 4500)).toEqual({ startMs: 420, endMs: 3480 })
  })

  it("treats hiss as quiet relative to the file's own level, loud or quiet recording", () => {
    const loud = shape([[0, 800, -52], [800, 3000, -10], [3000, 4000, -52]])
    expect(trimSilence(loud, 0, 4000)).toEqual({ startMs: 720, endMs: 3080 })
    const quiet = shape([[0, 800, -72], [800, 3000, -30], [3000, 4000, -72]])
    expect(trimSilence(quiet, 0, 4000)).toEqual({ startMs: 720, endMs: 3080 })
  })

  it('bridges a 20 ms dip inside a soft onset, not a 100 ms gap', () => {
    const dip = shape([[0, 600, -75], [600, 700, -50], [700, 720, -75], [720, 800, -55], [800, 3000, -12], [3000, 3500, -75]])
    expect(trimSilence(dip, 0, 3500)?.startMs).toBe(520)
    const gap = shape([[0, 600, -75], [600, 700, -50], [700, 800, -75], [800, 3000, -12], [3000, 3500, -75]])
    expect(trimSilence(gap, 0, 3500)?.startMs).toBe(720)
  })

  it('ignores digital silence (encoder padding) when it measures the quiet', () => {
    const env = shape([[0, 40, -120], [40, 1000, -60], [1000, 3000, -12], [3000, 3500, -120]])
    expect(trimSilence(env, 0, 3500)).toEqual({ startMs: 920, endMs: 3080 })
  })

  it('returns null without speech or when there is nothing to trim', () => {
    expect(trimSilence(shape([[0, 3000, -75]]), 0, 3000)).toBeNull()
    expect(trimSilence(shape([[0, 30, -90], [30, 2970, -12], [2970, 3000, -90]]), 0, 3000)).toBeNull()
  })

  it('only shrinks the window and stays in the usable range', () => {
    const env = shape([[0, 1000, -90], [1000, 4000, -12], [4000, 5000, -90]])
    expect(trimSilence(env, 1500, 4500)).toEqual({ startMs: 1500, endMs: 4080 })
    expect(trimSilence({ ...env, usableFromMs: 950 }, 0, 5000)).toEqual({ startMs: 950, endMs: 4080 })
    const late = shape([[0, 1000, -90], [1000, 4000, -12], [4000, 5000, -90]], 20_000) // a window of a chapter file
    expect(trimSilence(late, 20_000, 25_000)).toEqual({ startMs: 20_920, endMs: 24_080 })
  })
})

describe('trimSilence on real EveryAyah files (10 ms envelopes of the ffmpeg = Chrome decode)', () => {
  const run = (key: keyof typeof envelopes.files) => {
    const f = envelopes.files[key]
    const env: EnvelopeWindow = { levels: Float32Array.from(f.levelsDb), startMs: 0, usableFromMs: 0, usableToMs: f.levelsDb.length * HOP_MS }
    const trimmed = trimSilence(env, 0, f.durationMs)
    const speech = speechBounds(env)
    if (!trimmed || !speech) throw new Error(`${key}: nothing trimmed`)
    // never tighter than the research's speechBounds (peak − 30 dB) plus the 80 ms kept
    expect(trimmed.startMs).toBeLessThanOrEqual(Math.max(0, speech.startMs - TRIM_KEEP_MS))
    expect(trimmed.endMs).toBeGreaterThanOrEqual(Math.min(f.durationMs, speech.endMs + TRIM_KEEP_MS))
    return { ...trimmed, durationMs: f.durationMs }
  }

  it('Husary 101:10 «مَا هِيَهْ»: trims 200 ms before and 465 ms after, the breathy هْ stays', () => {
    const r = run('husary-101010')
    expect(r).toEqual({ startMs: 200, endMs: 6510, durationMs: 6975 })
  })

  it('Husary 59:22 «هُوَ ٱللَّهُ»: the soft ه 60 ms before the vowel stays; so does the reverb plateau at the end', () => {
    const r = run('husary-059022')
    expect(r.startMs).toBe(320) // first sound above the −62 dBFS room tone at 400 ms, vowel at 460 ms
    expect(r.endMs).toBe(15_910) // reverb at −43…−49 dBFS until 15.83 s, then −53 and falling
    expect(r.durationMs - r.endMs).toBeGreaterThan(1200)
  })

  it('Hudhaify 112:1: the decaying hiss before «قُلْ» goes, the word stays', () => {
    expect(run('hudhaify-112001')).toEqual({ startMs: 450, endMs: 3160, durationMs: 3474 })
  })
})
