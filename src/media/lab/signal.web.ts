// Signal helpers of the media lab (dev only, web only): cross-correlation, PCM interleaving for the headless
// harness, an uncorrected whole-file decode and RMS levels. Nothing runs at import time.

/** Best normalised cross-correlation of a[aFrom, aFrom + n) against b around bCenter (±radius samples). */
export function xcorr(a: Float32Array, aFrom: number, n: number, b: Float32Array, bCenter: number, radius: number): { lag: number; corr: number } {
  let best = { lag: 0, corr: -2 }
  let ea = 0
  for (let i = 0; i < n; i++) ea += a[aFrom + i] * a[aFrom + i]
  for (let lag = -radius; lag <= radius; lag++) {
    const o = bCenter + lag
    if (o < 0 || o + n > b.length) continue
    let dot = 0
    let eb = 0
    for (let i = 0; i < n; i++) {
      const y = b[o + i]
      dot += a[aFrom + i] * y
      eb += y * y
    }
    const corr = dot / Math.sqrt(ea * eb || 1)
    if (corr > best.corr) best = { lag, corr }
  }
  return { lag: best.lag, corr: +best.corr.toFixed(6) }
}

/** The engine's own decode of a whole file at 48 kHz, uncorrected (WebKit: untagged files 529 samples early). */
export async function decodeWholeRaw(url: string): Promise<AudioBuffer> {
  const bytes = await (await fetch(url, { mode: 'cors', credentials: 'omit' })).arrayBuffer()
  return new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes)
}

/** Interleaved f32le stereo (what the harness compares with ffmpeg). */
export function interleave(buf: AudioBuffer): Float32Array {
  const l = buf.getChannelData(0)
  const r = buf.getChannelData(Math.min(1, buf.numberOfChannels - 1))
  const out = new Float32Array(l.length * 2)
  for (let i = 0; i < l.length; i++) {
    out[2 * i] = l[i]
    out[2 * i + 1] = r[i]
  }
  return out
}

export function rmsDb(x: Float32Array, from: number, to: number): number {
  let acc = 0
  for (let i = from; i < to; i++) acc += x[i] * x[i]
  return +(10 * Math.log10(acc / Math.max(1, to - from) + 1e-12)).toFixed(1)
}
