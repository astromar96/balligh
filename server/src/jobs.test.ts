import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PublishPlatform } from '../../src/domain'
import { loadConfig, type Config } from './config'
import { createApi } from './http'
import { Jobs } from './jobs'
import { PublishError, type Publisher, type PublishInput } from './publishers/types'
import { RenderError, type RenderFn, type RenderOptions } from './render'
import { Store } from './store'
import { canonicalQuery } from './validate'

const Q = canonicalQuery('v=1&s=1&a=1-3&r=alafasy') as string

class FakePublisher implements Publisher {
  readonly platform: PublishPlatform
  calls: PublishInput[] = []
  left: number | null = null
  fail: PublishError | null = null
  constructor(platform: PublishPlatform) {
    this.platform = platform
  }
  async remaining() {
    return this.left
  }
  async publish(input: PublishInput) {
    if (this.fail) throw this.fail
    this.calls.push(input)
    expect(existsSync(input.file)).toBe(true)
    return { link: `https://${this.platform}.test/${this.calls.length}` }
  }
}

let dir: string
let cfg: Config
let store: Store
let renders: RenderOptions[]
let renderResult: { durationMs: number; error?: RenderError }
let pubs: Map<PublishPlatform, FakePublisher>
let jobs: Jobs

const fakeRender: RenderFn = async (opts) => {
  renders.push(opts)
  if (renderResult.error) throw renderResult.error
  writeFileSync(opts.out, 'mp4')
  return {
    file: opts.out,
    bytes: 3,
    durationMs: renderResult.durationMs,
    width: 1080,
    height: 1920,
    link: `https://sharequran.app/?${opts.query}`,
    captionParts: { words: '«…»', reference: '— الفاتحة ١–٣', reciter: 'بصوت القارئ', sources: 'المصادر: x', link: 'https://sharequran.app/' },
    reciterName: 'العفاسي',
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'balligh-jobs-'))
  cfg = { ...loadConfig({ DATA_DIR: dir, RATE_PER_HOUR: '3' }) }
  store = new Store(':memory:')
  renders = []
  renderResult = { durationMs: 15_000 }
  pubs = new Map((['instagram', 'facebook', 'threads', 'x'] as PublishPlatform[]).map((p) => [p, new FakePublisher(p)]))
  jobs = new Jobs({ store, cfg, publishers: pubs as Map<PublishPlatform, Publisher>, render: fakeRender })
})

afterEach(async () => {
  await jobs.idle
  store.close()
})

const submit = (platforms: PublishPlatform[], extra: Partial<{ name: string | null; instagram: string | null; ip: string; query: string }> = {}) =>
  jobs.submit({ query: extra.query ?? Q, platforms, credit: { name: extra.name ?? null, instagram: extra.instagram ?? null }, ip: extra.ip ?? '1.1.1.1' })

async function finished(id: string) {
  await jobs.idle
  return jobs.view(id)!
}

describe('Jobs', () => {
  it('renders once and posts to each platform, then forgets the credit and deletes the MP4', async () => {
    const r = await submit(['instagram', 'facebook'], { name: 'عمر' })
    expect(r.ok && r.job.status).toBe('queued')
    if (!r.ok) return
    const v = await finished(r.job.id)
    expect(v.status).toBe('done')
    expect(v.platforms).toEqual({ instagram: { state: 'done', link: 'https://instagram.test/1' }, facebook: { state: 'done', link: 'https://facebook.test/1' } })
    expect(renders).toHaveLength(1)
    expect(pubs.get('instagram')!.calls[0].caption.text).toContain('نشرها: عمر')
    expect(store.getJob(r.job.id)!.credit).toBeNull()
    expect(existsSync(renders[0].out)).toBe(false)
  })

  it('answers an already-posted clip with its link, without rendering or counting against the rate limit', async () => {
    const first = await submit(['facebook'])
    if (first.ok) await finished(first.job.id)
    const again = await submit(['facebook'], { ip: '2.2.2.2' })
    expect(again.ok && again.job.status).toBe('done')
    if (!again.ok) return
    expect(jobs.view(again.job.id)!.platforms.facebook).toEqual({ state: 'done', link: 'https://facebook.test/1', reused: true })
    expect(renders).toHaveLength(1)
    expect(store.hitsLastHour('2.2.2.2')).toBe(0)
  })

  it('posts a new Instagram reel when an Instagram username comes with it (an invite needs a new post)', async () => {
    const first = await submit(['instagram'])
    if (first.ok) await finished(first.job.id)
    const again = await submit(['instagram'], { instagram: 'omar' })
    if (!again.ok) throw new Error('refused')
    expect(again.job.status).toBe('queued')
    expect((await finished(again.job.id)).platforms.instagram).toEqual({ state: 'done', link: 'https://instagram.test/2' })
  })

  it('says full before rendering when a platform has no posts left, and skips platforms that are not live', async () => {
    pubs.get('facebook')!.left = 0
    const r = await submit(['facebook', 'telegram'])
    if (!r.ok) throw new Error('refused')
    expect(r.job.status).toBe('done')
    expect(r.job.platforms).toEqual({ facebook: { state: 'full' }, telegram: { state: 'skipped', reason: 'not-live' } })
    expect(renders).toHaveLength(0)
  })

  it('skips the platforms the clip is too long for', async () => {
    renderResult = { durationMs: 150_000 }
    const r = await submit(['instagram', 'facebook', 'x'])
    if (!r.ok) throw new Error('refused')
    const v = await finished(r.job.id)
    expect(v.platforms.facebook).toEqual({ state: 'skipped', reason: 'too-long' })
    expect(v.platforms.x?.state).toBe('done')
    expect(v.platforms.instagram?.state).toBe('done')
  })

  it('limits new renders per address per hour', async () => {
    for (const s of [1, 2, 3]) {
      const r = await submit(['facebook'], { query: canonicalQuery(`v=1&s=1&a=${s}&r=alafasy`) as string })
      expect(r.ok).toBe(true)
    }
    const fourth = await submit(['facebook'], { query: canonicalQuery('v=1&s=1&a=4&r=alafasy') as string })
    expect(fourth).toEqual({ ok: false, error: 'rate-limited' })
    expect((await submit(['facebook'], { query: canonicalQuery('v=1&s=1&a=4&r=alafasy') as string, ip: '9.9.9.9' })).ok).toBe(true)
  })

  it('fails every waiting platform with the render error', async () => {
    renderResult = { durationMs: 0, error: new RenderError('cut-warning', 'starts-mid-phrase') }
    const r = await submit(['instagram', 'facebook'])
    if (!r.ok) throw new Error('refused')
    const v = await finished(r.job.id)
    expect(v.status).toBe('failed')
    expect(v.error).toBe('cut-warning')
    expect(v.platforms.instagram).toEqual({ state: 'failed', reason: 'cut-warning' })
  })

  it('keeps going when one platform fails, and maps a limit error to full', async () => {
    pubs.get('instagram')!.fail = new PublishError('full', 'limit')
    pubs.get('threads')!.fail = new PublishError('auth', 'token')
    const r = await submit(['instagram', 'threads', 'facebook'])
    if (!r.ok) throw new Error('refused')
    const v = await finished(r.job.id)
    expect(v.platforms.instagram).toEqual({ state: 'full' })
    expect(v.platforms.threads).toEqual({ state: 'failed', reason: 'auth' })
    expect(v.platforms.facebook?.state).toBe('done')
  })

  it('serves the MP4 at a one-time address only while publishing', async () => {
    let seen: string | null = null
    pubs.get('threads')!.publish = async function (input) {
      seen = jobs.mediaFile(input.mediaUrl.match(/media\/([0-9a-f]+)\.mp4$/)![1])
      return { link: 'https://threads.test/1' }
    }
    const r = await submit(['threads'])
    if (!r.ok) throw new Error('refused')
    await finished(r.job.id)
    expect(seen).toMatch(/\.mp4$/)
    expect(jobs.mediaFile('0'.repeat(32))).toBeNull()
  })
})

describe('HTTP API', () => {
  async function serve() {
    const server = createApi({ cfg: { ...cfg, allowedOrigins: ['https://sharequran.app'] }, jobs })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return { base, close: () => new Promise<void>((r) => server.close(() => r())) }
  }
  const post = (base: string, body: unknown) =>
    fetch(`${base}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://sharequran.app' }, body: JSON.stringify(body) })

  it('takes a publish request and reports the job', async () => {
    const { base, close } = await serve()
    try {
      const res = await post(base, { query: 'v=1&s=1&a=1-3&r=alafasy', platforms: ['facebook'], name: 'عمر' })
      expect(res.status).toBe(202)
      expect(res.headers.get('access-control-allow-origin')).toBe('https://sharequran.app')
      const job = (await res.json()) as { id: string }
      await jobs.idle
      const view = (await (await fetch(`${base}/publish/${job.id}`)).json()) as { status: string; platforms: Record<string, { state: string }> }
      expect(view.status).toBe('done')
      expect(view.platforms.facebook.state).toBe('done')
    } finally {
      await close()
    }
  })

  it('refuses bad links, platforms and names with a reason', async () => {
    const { base, close } = await serve()
    try {
      expect(await (await post(base, { query: 'nope', platforms: ['facebook'] })).json()).toEqual({ error: 'bad-link' })
      expect((await post(base, { query: Q, platforms: ['tiktok'] })).status).toBe(400)
      expect(await (await post(base, { query: Q, platforms: ['facebook'], name: 'x.com/spam' })).json()).toEqual({ error: 'name', problem: 'characters' })
      expect((await fetch(`${base}/publish`, { method: 'POST', body: 'x'.repeat(9000) })).status).toBe(413)
    } finally {
      await close()
    }
  })

  it('answers the status of every platform and no CORS for other origins', async () => {
    pubs.get('facebook')!.left = 7
    const { base, close } = await serve()
    try {
      const res = await fetch(`${base}/status`, { headers: { Origin: 'https://evil.example' } })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
      const body = (await res.json()) as { platforms: Record<string, { live: boolean; remaining: number | null }> }
      expect(body.platforms.facebook).toEqual({ live: true, remaining: 7 })
      expect(body.platforms.telegram).toEqual({ live: false, remaining: 0 })
      expect((await fetch(`${base}/media/${'0'.repeat(32)}.mp4`)).status).toBe(404)
    } finally {
      await close()
    }
  })

  it('checks Turnstile when it is configured', async () => {
    const server = createApi({ cfg, jobs, turnstile: async (token) => token === 'good' })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      expect((await post(base, { query: Q, platforms: ['facebook'], turnstile: 'bad' })).status).toBe(403)
      expect((await post(base, { query: Q, platforms: ['facebook'], turnstile: 'good' })).status).toBe(202)
      await jobs.idle
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})
