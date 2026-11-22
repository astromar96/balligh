// How this browser's decodeAudioData treats an UNTAGGED MP3 (no Xing/Info frame), measured once with a
// 627-byte probe instead of guessing from the user agent. research/media-pipeline.md "Independent
// verification" N3: Chrome == ffmpeg (the timeline the word timings were computed on) decodes untagged
// files raw; WebKit/AudioToolbox drops the 529-sample decoder delay, so its audio lands 12 ms (44.1 kHz)
// / 24 ms (22.05 kHz) early. Tagged files decode identically in both once the LAME CRC is valid.

/**
 * Untagged MPEG-1 Layer III, 44.1 kHz mono 32 kbps, 6 frames, made with ffmpeg 9.0.1 / libmp3lame
 * (`-write_xing 0`, no ID3) from a 3-sample impulse at input sample 2205. ffmpeg decodes the peak at
 * sample 3311 = 2206 + 576 (encoder delay) + 529 (decoder delay).
 */
const PROBE_MP3 =
  '//sQxAADwAABpAAAACAAADSAAAAE8cbxYrxhfihP4sUJ/xxQkf/xQlxRf/3FFMKL/BoFgZPf5YJVMuryrqSqAAVAKGWVkVkKHVULKyK1UIoKAlGoU7xL1neJes7yqkxBTUU0LjCqqqr/+xLEKYPAAAGkAAAAIAAANIKAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xDEU4AEbJ1wGCEAAJQGrPuSMASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7EsRYg8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7EMSCg8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//sSxKwDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
const PROBE_PEAK = 3311
/** decoder behaviours seen in the wild: raw (0), decoder delay dropped (529), encoder delay (576), both (1105) */
const KNOWN_SKEWS = [0, 529, 576, 1105]

let measured: Promise<number> | null = null

/** Pure part: classify the probe's peak position into a known skew (0 when unrecognised). */
export function classifySkew(peakIndex: number): number {
  const d = PROBE_PEAK - peakIndex
  return KNOWN_SKEWS.find((k) => Math.abs(d - k) <= 8) ?? 0
}

/**
 * Samples (at the file's own rate) this engine drops from the start of an untagged MP3 compared with the
 * ffmpeg/Chrome reference: 0 in Chrome, 529 in WebKit. Decoded sample 0 of an untagged file then sits at
 * reference time skew / sampleRate. Measured once per page; 0 when the probe cannot run.
 */
export function untaggedDecoderSkew(): Promise<number> {
  if (!measured) {
    measured = (async () => {
      try {
        const bin = atob(PROBE_MP3)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes.buffer)
        const x = buf.getChannelData(0)
        let peak = 0
        for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[peak])) peak = i
        const skew = classifySkew(peak)
        if (skew) console.info(`[media] this browser decodes untagged MP3s ${skew} samples early; compensating`)
        return skew
      } catch {
        return 0
      }
    })()
  }
  return measured
}
