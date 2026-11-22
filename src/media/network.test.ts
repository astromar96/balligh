// The web fetch layer (audio.web.ts) and the decoder-skew classifier, on a stubbed fetch: no network.
import { absoluteAudioUrl, AudioSourceError, fetchRange } from './audio.web'
import { classifySkew } from './decoderSkew.web'

describe('audio URLs', () => {
  it('prefixes protocol-relative URLs with https: (v4 recitations 6/11/12, N6)', () => {
    expect(absoluteAudioUrl('//mirrors.quranicaudio.com/everyayah/Husary_64kbps/002255.mp3')).toBe(
      'https://mirrors.quranicaudio.com/everyayah/Husary_64kbps/002255.mp3',
    )
    expect(absoluteAudioUrl('https://verses.quran.com/Alafasy/mp3/002255.mp3')).toBe('https://verses.quran.com/Alafasy/mp3/002255.mp3')
  })
})

describe('untagged-MP3 decoder skew probe (N3)', () => {
  it('classifies the probe peak: Chrome/ffmpeg raw, WebKit 529 early, others, unknown = no correction', () => {
    expect(classifySkew(3311)).toBe(0)
    expect(classifySkew(2782)).toBe(529)
    expect(classifySkew(2786)).toBe(529)
    expect(classifySkew(2735)).toBe(576)
    expect(classifySkew(2206)).toBe(1105)
    expect(classifySkew(1500)).toBe(0)
  })
})

describe('Range fetch: stall watchdog, one retry, abort', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    vi.useRealTimers()
  })

  const partial = (body: number[], total = 1000) =>
    new Response(new Uint8Array(body), { status: 206, headers: { 'content-range': `bytes 0-${body.length - 1}/${total}` } })

  /** never answers; rejects like fetch when its signal aborts */
  const hang = (init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })

  function stub(...answers: ((init?: RequestInit) => Promise<Response> | Response)[]) {
    const calls: RequestInit[] = []
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {})
      const next = answers[Math.min(calls.length, answers.length) - 1]
      return next(init)
    }) as typeof fetch
    return calls
  }

  it('sends a simple Range header (CORS-safelisted: no preflight) without credentials', async () => {
    const calls = stub(() => partial([1, 2, 3]))
    const r = await fetchRange('https://cdn.example/a.mp3', 0, 2)
    expect(Array.from(r.bytes)).toEqual([1, 2, 3])
    expect(r.total).toBe(1000)
    expect(calls[0]).toMatchObject({ headers: { Range: 'bytes=0-2' }, credentials: 'omit', mode: 'cors' })
  })

  it('retries once after a stall (no answer for 15 s) and returns the retry', async () => {
    vi.useFakeTimers()
    const calls = stub(hang, () => partial([7, 8]))
    const p = fetchRange('https://cdn.example/a.mp3', 0, 1)
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(p).resolves.toMatchObject({ total: 1000 })
    expect(calls).toHaveLength(2)
  })

  it('gives up with code "timeout" when the retry stalls too', async () => {
    vi.useFakeTimers()
    const calls = stub(hang)
    const p = fetchRange('https://cdn.example/a.mp3', 0, 1)
    const settled = p.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(30_000)
    const e = await settled
    expect(e).toBeInstanceOf(AudioSourceError)
    expect(e).toMatchObject({ code: 'timeout' })
    expect(calls).toHaveLength(2)
  })

  it('retries a network error and a 5xx once, never a 404', async () => {
    let calls = stub(
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => partial([1]),
    )
    await expect(fetchRange('https://cdn.example/a.mp3', 0, 0)).resolves.toBeTruthy()
    expect(calls).toHaveLength(2)

    calls = stub(() => new Response('', { status: 503 }))
    await expect(fetchRange('https://cdn.example/a.mp3', 0, 0)).rejects.toMatchObject({ code: 'http', status: 503 })
    expect(calls).toHaveLength(2)

    calls = stub(() => new Response('', { status: 404 }))
    await expect(fetchRange('https://cdn.example/a.mp3', 0, 0)).rejects.toMatchObject({ code: 'http', status: 404 })
    expect(calls).toHaveLength(1)
  })

  it("the caller's abort wins: AbortError, no retry", async () => {
    const calls = stub(hang)
    const ctl = new AbortController()
    const p = fetchRange('https://cdn.example/a.mp3', 0, 1, ctl.signal)
    ctl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(1)
    await expect(fetchRange('https://cdn.example/a.mp3', 0, 1, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(1)
  })

  it('accepts a small file whose server ignored Range (200), refuses a large one', async () => {
    stub(() => new Response(new Uint8Array([0, 1, 2, 3, 4, 5]), { status: 200 }))
    const r = await fetchRange('https://cdn.example/small.mp3', 2, 4)
    expect(Array.from(r.bytes)).toEqual([2, 3, 4])
    expect(r.total).toBe(6)

    stub(() => new Response('x', { status: 200, headers: { 'content-length': String(200 * 1024 * 1024) } }))
    await expect(fetchRange('https://cdn.example/big.mp3', 0, 1)).rejects.toMatchObject({ code: 'range-ignored' })
  })
})
