import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../store'
import { FacebookPublisher } from './facebook'
import { InstagramPublisher } from './instagram'
import { ThreadsPublisher } from './threads'
import { PublishError, type PublishInput } from './types'

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown } | undefined

/** a fetch that answers from a list of handlers and records every call */
function fakeFetch(handlers: Handler[]) {
  const calls: { method: string; url: URL; init: RequestInit }[] = []
  const f = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ method: init.method ?? 'GET', url, init })
    for (const h of handlers) {
      const r = h(url, init)
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
    }
    return new Response(JSON.stringify({ error: { message: `unhandled ${url}` } }), { status: 500 })
  }
  return { fetch: f as typeof fetch, calls }
}

const noSleep = async () => {}
const graphError = (code: number, subcode: number | null, message = 'nope') => ({ status: 400, body: { error: { message, code, error_subcode: subcode } } })
const form = (init: RequestInit) => new URLSearchParams(String(init.body))

let file: string
let input: PublishInput

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'balligh-meta-'))
  file = join(dir, 'clip.mp4')
  writeFileSync(file, Buffer.from('MP4BYTES'))
  input = {
    jobId: 'job',
    file,
    bytes: 8,
    durationMs: 15_000,
    width: 1080,
    height: 1920,
    caption: { text: 'نص\n#القرآن_الكريم' },
    credit: { name: 'عمر', instagram: 'omar.k' },
    mediaUrl: 'https://api.sharequran.app/media/abc.mp4',
    signal: new AbortController().signal,
  }
})

describe('InstagramPublisher', () => {
  const ig = (handlers: Handler[]) => {
    const f = fakeFetch(handlers)
    return { pub: new InstagramPublisher({ id: '178', token: 'TOKEN' }, 'v25.0', { fetch: f.fetch, sleep: noSleep }), calls: f.calls }
  }
  let polls = 0
  const happy: Handler[] = [
    (u, i) => (u.pathname === '/v25.0/178/media' && i.method === 'POST' ? { body: { id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/v25.0/C1' } } : undefined),
    (u) => (u.hostname === 'rupload.facebook.com' ? { body: { success: true } } : undefined),
    (u) => (u.pathname === '/v25.0/C1' ? { body: { status_code: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' } } : undefined),
    (u) => (u.pathname === '/v25.0/178/media_publish' ? { body: { id: 'M1' } } : undefined),
    (u) => (u.pathname === '/v25.0/M1' ? { body: { permalink: 'https://www.instagram.com/reel/abc/' } } : undefined),
  ]

  beforeEach(() => {
    polls = 0
  })

  it('makes a resumable REELS container with the caption and the collaborator, uploads, waits, publishes', async () => {
    const { pub, calls } = ig(happy)
    expect(await pub.publish(input)).toEqual({ link: 'https://www.instagram.com/reel/abc/' })
    const create = form(calls[0].init)
    expect(Object.fromEntries(create)).toMatchObject({ media_type: 'REELS', upload_type: 'resumable', caption: input.caption.text, collaborators: 'omar.k' })
    const upload = calls[1]
    expect(upload.init.headers).toMatchObject({ Authorization: 'OAuth TOKEN', offset: '0', file_size: '8' })
    expect(Buffer.from(upload.init.body as Uint8Array).toString()).toBe('MP4BYTES')
    expect(calls.filter((c) => c.url.pathname === '/v25.0/C1')).toHaveLength(2)
    expect(form(calls.find((c) => c.url.pathname.endsWith('media_publish'))!.init).get('creation_id')).toBe('C1')
  })

  it('posts without the invite when Instagram refuses the collaborator', async () => {
    let first = true
    const { pub, calls } = ig([
      (u, i) => {
        if (u.pathname !== '/v25.0/178/media' || i.method !== 'POST') return undefined
        if (first && form(i).get('collaborators')) {
          first = false
          return graphError(100, 2207058, 'collaborator')
        }
        return { body: { id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/v25.0/C1' } }
      },
      ...happy.slice(1),
    ])
    expect(await pub.publish(input)).toEqual({ link: 'https://www.instagram.com/reel/abc/', note: 'invite-failed' })
    expect(form(calls[1].init).get('collaborators')).toBeNull()
  })

  it('says full when the daily limit is reached, and reads what is left', async () => {
    const { pub } = ig([
      (u) => (u.pathname === '/v25.0/178/content_publishing_limit' ? { body: { data: [{ quota_usage: 48, config: { quota_total: 50, quota_duration: 86400 } }] } } : undefined),
      ...happy.slice(0, 3),
      (u) => (u.pathname === '/v25.0/178/media_publish' ? graphError(9, 2207042) : undefined),
    ])
    expect(await pub.remaining()).toBe(2)
    await expect(pub.publish(input)).rejects.toMatchObject({ kind: 'full' })
  })

  it('turns a dead token into an auth error and a failed container into failed', async () => {
    await expect(ig([(u) => (u.pathname.endsWith('/media') ? graphError(190, null) : undefined)]).pub.publish({ ...input, credit: { name: null, instagram: null } })).rejects.toMatchObject({
      kind: 'auth',
    })
    const failed = ig([happy[0], happy[1], (u) => (u.pathname === '/v25.0/C1' ? { body: { status_code: 'ERROR', status: '2207026' } } : undefined)])
    await expect(failed.pub.publish(input)).rejects.toBeInstanceOf(PublishError)
  })
})

describe('FacebookPublisher', () => {
  it('starts, uploads, finishes as PUBLISHED with the caption, waits for publishing, and links the reel', async () => {
    let polls = 0
    const f = fakeFetch([
      (u, i) => {
        if (u.pathname !== '/v25.0/PAGE/video_reels') return undefined
        const json = i.headers && (i.headers as Record<string, string>)['Content-Type'] === 'application/json'
        return json ? { body: { video_id: 'V1', upload_url: 'https://rupload.facebook.com/video-upload/v25.0/V1' } } : { body: { success: true } }
      },
      (u) => (u.hostname === 'rupload.facebook.com' ? { body: { success: true } } : undefined),
      (u) =>
        u.pathname === '/v25.0/V1' && u.searchParams.get('fields') === 'status'
          ? { body: { status: { video_status: 'processing', publishing_phase: { status: ++polls < 2 ? 'in_progress' : 'complete', publish_status: polls < 2 ? 'draft' : 'published' } } } }
          : undefined,
      (u) => (u.pathname === '/v25.0/V1' ? { body: { permalink_url: '/reel/V1' } } : undefined),
    ])
    const pub = new FacebookPublisher({ id: 'PAGE', token: 'PT' }, 'v25.0', () => 28, { fetch: f.fetch, sleep: noSleep })
    expect(await pub.remaining()).toBe(2)
    expect(await pub.publish(input)).toEqual({ link: 'https://www.facebook.com/reel/V1' })
    const finish = form(f.calls[2].init)
    expect(Object.fromEntries(finish)).toMatchObject({ upload_phase: 'finish', video_id: 'V1', video_state: 'PUBLISHED', description: input.caption.text })
    expect(f.calls[1].init.headers).toMatchObject({ Authorization: 'OAuth PT', offset: '0', file_size: '8' })
  })

  it('maps the reels rate limit to full', async () => {
    const f = fakeFetch([(u) => (u.pathname === '/v25.0/PAGE/video_reels' ? graphError(613, null, 'Calls to this api have exceeded the rate limit.') : undefined)])
    const pub = new FacebookPublisher({ id: 'PAGE', token: 'PT' }, 'v25.0', () => 0, { fetch: f.fetch, sleep: noSleep })
    await expect(pub.publish(input)).rejects.toMatchObject({ kind: 'full' })
  })
})

describe('ThreadsPublisher', () => {
  it('posts the video from the one-time address with the caption, then links it', async () => {
    const store = new Store(':memory:')
    let polls = 0
    const f = fakeFetch([
      (u, i) => (u.pathname === '/v1.0/TU/threads' && i.method === 'POST' ? { body: { id: 'TC' } } : undefined),
      (u) => (u.pathname === '/v1.0/TC' ? { body: { status: ++polls < 2 ? 'IN_PROGRESS' : 'FINISHED' } } : undefined),
      (u) => (u.pathname === '/v1.0/TU/threads_publish' ? { body: { id: 'TM' } } : undefined),
      (u) => (u.pathname === '/v1.0/TM' ? { body: { permalink: 'https://www.threads.com/@sharequran/post/x' } } : undefined),
      (u) => (u.pathname === '/refresh_access_token' ? { body: { access_token: 'NEW', token_type: 'bearer', expires_in: 5183944 } } : undefined),
    ])
    const pub = new ThreadsPublisher({ id: 'TU', token: 'OLD' }, 'v1.0', store, { fetch: f.fetch, sleep: noSleep })
    expect(await pub.publish(input)).toEqual({ link: 'https://www.threads.com/@sharequran/post/x' })
    expect(Object.fromEntries(form(f.calls[0].init))).toMatchObject({ media_type: 'VIDEO', video_url: input.mediaUrl, text: input.caption.text, access_token: 'OLD' })
    await pub.refreshToken()
    expect(pub.token()).toBe('NEW')
    expect(f.calls.at(-1)!.url.searchParams.get('grant_type')).toBe('th_refresh_token')
    store.close()
  })
})
