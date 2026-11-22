// Live check (run once with LIVE=1): the committed MP3 fixtures still match the CDNs byte for byte, the real
// fetch layer (audio.web.ts fetchRange) gets Range windows, a live 7000 s window lands on the frame ffmpeg
// found, and the protocol-relative v4 URLs (N6) work once prefixed. Skipped in normal runs.
import fixtures from './__fixtures__/mp3-bytes.json'
import { absoluteAudioUrl, fetchRange } from './audio.web'
import { assembleSlice, id3v2Size, parseFrameHeader, parseMp3Head, planSlice } from './mp3'

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i
  return -1
}

describe.skipIf(!process.env.LIVE)('live audio CDNs (LIVE=1)', () => {
  it('every committed MP3 fixture still matches its CDN bytes (ID3 bodies were zeroed) and file size', async () => {
    for (const [name, f] of Object.entries(fixtures.files)) {
      const want = fromBase64(f.base64)
      const got = await fetchRange(f.url, f.offset, f.offset + f.bytes - 1)
      const skip = f.offset === 0 ? id3v2Size(want) : 0
      expect(got.bytes.length, name).toBe(f.bytes)
      expect(firstDifference(got.bytes.subarray(skip), want.subarray(skip)), name).toBe(-1)
      // Node sees Content-Range (browsers do not: BunnyCDN does not expose it)
      expect(got.total, name).toBe(Number(f.contentRange.split('/')[1]))
    }
  }, 120_000)

  it('QDC Alafasy ch 2: a live window at 7000 s walks onto the frame ffmpeg found at byte 111,999,590', async () => {
    const url = fixtures.files['alafasy-qdc7-2-head'].url
    const headBytes = (await fetchRange(url, 0, 64 * 1024 - 1)).bytes
    const head = parseMp3Head(headBytes, 0, id3v2Size(headBytes))
    if (typeof head === 'string') throw new Error(head)
    const plan = planSlice(head, 7_000_000 - 1100, 7_000_000 + 1000)
    const win = await fetchRange(url, plan.lo, plan.hi)
    const s = assembleSlice(head, plan, win.bytes, plan.lo)
    if (typeof s === 'string') throw new Error(s)
    let o = s.firstFrameOffset - plan.lo
    for (let k = s.frameIndex; k < 267967; k++) o += parseFrameHeader(win.bytes, o)!.frameBytes
    expect(plan.lo + o).toBe(111_999_590)
  }, 60_000)

  it('Yasser Ad-Dosari (QDC 97, class B) ch 2 is still an untagged CBR 128 kbps file', async () => {
    const r = await fetch('https://api.quran.com/api/qdc/audio/reciters/97/audio_files?chapter=2')
    const url = ((await r.json()) as { audio_files: { audio_url: string }[] }).audio_files[0].audio_url
    const bytes = (await fetchRange(url, 0, 64 * 1024 - 1)).bytes
    expect(parseMp3Head(bytes, 0, id3v2Size(bytes))).toMatchObject({ tag: null, infoFrame: null, audio: { bitrateKbps: 128, sampleRate: 44100 } })
  }, 60_000)

  it('v4 recitation 6 still returns a protocol-relative URL that works once prefixed with https: (N6)', async () => {
    const r = await fetch('https://api.quran.com/api/v4/recitations/6/by_ayah/2:255')
    const raw = ((await r.json()) as { audio_files: { url: string }[] }).audio_files[0].url
    expect(raw.startsWith('//')).toBe(true)
    const res = await fetch(absoluteAudioUrl(raw), { headers: { Range: 'bytes=0-1023' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    await res.body?.cancel()
  }, 60_000)
})
