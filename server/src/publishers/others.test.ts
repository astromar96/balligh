import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../store'
import { TelegramPublisher } from './telegram'
import type { PublishInput } from './types'
import { XPublisher } from './x'
import { YouTubePublisher } from './youtube'

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> }
type Handler = (url: URL, init: RequestInit) => Reply | undefined

function fakeFetch(handlers: Handler[]) {
  const calls: { method: string; url: URL; init: RequestInit }[] = []
  const f = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ method: init.method ?? 'GET', url, init })
    for (const h of handlers) {
      const r = h(url, init)
      if (r) return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers })
    }
    return new Response(JSON.stringify({ error: { message: `unhandled ${url}` } }), { status: 500 })
  }
  return { fetch: f as typeof fetch, calls }
}

const noSleep = async () => {}
let input: PublishInput
let store: Store

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'balligh-pub-'))
  const file = join(dir, 'clip.mp4')
  writeFileSync(file, Buffer.alloc(9 * 1024 * 1024, 1))
  store = new Store(':memory:')
  input = {
    jobId: 'job',
    file,
    bytes: 9 * 1024 * 1024,
    durationMs: 15_400,
    width: 1080,
    height: 1920,
    caption: { text: 'نص', title: 'الفاتحة ١ | العفاسي #Shorts' },
    credit: { name: null, instagram: null },
    mediaUrl: 'https://api.sharequran.app/media/x.mp4',
    signal: new AbortController().signal,
  }
})

afterEach(() => store.close())

describe('TelegramPublisher', () => {
  it('sends the video to the channel with its caption and links the message', async () => {
    const f = fakeFetch([(u) => (u.pathname === '/botBOT/sendVideo' ? { body: { ok: true, result: { message_id: 42, chat: { id: -1001, username: 'ShareQuran' } } } } : undefined)])
    const pub = new TelegramPublisher({ botToken: 'BOT', channel: '@ShareQuran' }, { fetch: f.fetch, sleep: noSleep })
    expect(await pub.publish(input)).toEqual({ link: 'https://t.me/ShareQuran/42' })
    const form = f.calls[0].init.body as FormData
    expect(form.get('chat_id')).toBe('@ShareQuran')
    expect(form.get('caption')).toBe('نص')
    expect(form.get('duration')).toBe('15')
    expect((form.get('video') as Blob).size).toBe(input.bytes)
  })

  it('waits once on 429 and reports a bad token as auth', async () => {
    let first = true
    const f = fakeFetch([
      () => {
        if (first) {
          first = false
          return { status: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 } } }
        }
        return { body: { ok: true, result: { message_id: 7, chat: { id: -1002345 } } } }
      },
    ])
    const pub = new TelegramPublisher({ botToken: 'BOT', channel: '-1002345' }, { fetch: f.fetch, sleep: noSleep })
    expect(await pub.publish(input)).toEqual({ link: 'https://t.me/c/2345/7' })
    const bad = fakeFetch([() => ({ status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } })])
    await expect(new TelegramPublisher({ botToken: 'X', channel: '@c' }, { fetch: bad.fetch }).publish(input)).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('YouTubePublisher', () => {
  const account = { clientId: 'CID', clientSecret: 'CS', refreshToken: 'RT' }
  const token: Handler = (u) => (u.hostname === 'oauth2.googleapis.com' ? { body: { access_token: 'AT', expires_in: 3599, token_type: 'Bearer' } } : undefined)

  it('refreshes the access token, opens a resumable upload with the metadata, puts the bytes, links the Short', async () => {
    const f = fakeFetch([
      token,
      (u, i) => (u.pathname === '/upload/youtube/v3/videos' && i.method === 'POST' ? { headers: { Location: 'https://upload.test/session/1' } } : undefined),
      (u) => (u.hostname === 'upload.test' ? { body: { id: 'VID', status: { uploadStatus: 'uploaded', privacyStatus: 'public' } } } : undefined),
    ])
    const pub = new YouTubePublisher(account, store, () => 99, { fetch: f.fetch })
    expect(await pub.remaining()).toBe(1)
    expect(await pub.publish(input)).toEqual({ link: 'https://www.youtube.com/shorts/VID' })
    const refresh = new URLSearchParams(String(f.calls[0].init.body))
    expect(Object.fromEntries(refresh)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT', client_id: 'CID', client_secret: 'CS' })
    const meta = JSON.parse(String(f.calls[1].init.body))
    expect(meta.snippet.title).toBe(input.caption.title)
    expect(meta.status.privacyStatus).toBe('public')
    expect(f.calls[1].init.headers).toMatchObject({ Authorization: 'Bearer AT', 'X-Upload-Content-Length': String(input.bytes) })
    expect(f.calls[2].method).toBe('PUT')
  })

  it('maps quotaExceeded to full and an upload that came back private to failed', async () => {
    const quota = fakeFetch([token, () => ({ status: 403, body: { error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } } })])
    await expect(new YouTubePublisher(account, store, () => 0, { fetch: quota.fetch }).publish(input)).rejects.toMatchObject({ kind: 'full' })
    const priv = fakeFetch([
      token,
      (u, i) => (i.method === 'POST' && u.hostname === 'www.googleapis.com' ? { headers: { Location: 'https://upload.test/s' } } : undefined),
      () => ({ body: { id: 'V', status: { uploadStatus: 'uploaded', privacyStatus: 'private' } } }),
    ])
    await expect(new YouTubePublisher(account, store, () => 0, { fetch: priv.fetch }).publish(input)).rejects.toMatchObject({ kind: 'failed' })
  })

  it('needs Omar when the refresh token is refused', async () => {
    const f = fakeFetch([() => ({ status: 400, body: { error: 'invalid_grant' } })])
    await expect(new YouTubePublisher(account, store, () => 0, { fetch: f.fetch }).publish(input)).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('XPublisher', () => {
  const account = { clientId: 'XID', clientSecret: 'XS', refreshToken: 'XR1', dailyMax: 20 }

  it('uploads the video in 4 MB segments, waits for processing, posts it, and keeps the rotated refresh token', async () => {
    let polls = 0
    const f = fakeFetch([
      (u) => (u.pathname === '/2/oauth2/token' ? { body: { access_token: 'XA', expires_in: 7200, refresh_token: 'XR2' } } : undefined),
      (u) => (u.pathname === '/2/media/upload/initialize' ? { body: { data: { id: 'MID', media_key: '13_MID' } } } : undefined),
      (u) => (u.pathname === '/2/media/upload/MID/append' ? { body: { data: { expires_at: 1 } } } : undefined),
      (u) => (u.pathname === '/2/media/upload/MID/finalize' ? { body: { data: { id: 'MID', processing_info: { state: 'pending', check_after_secs: 1 } } } } : undefined),
      (u) =>
        u.pathname === '/2/media/upload' && u.searchParams.get('command') === 'STATUS'
          ? { body: { data: { processing_info: { state: ++polls < 2 ? 'in_progress' : 'succeeded' } } } }
          : undefined,
      (u) => (u.pathname === '/2/tweets' ? { status: 201, body: { data: { id: '1900', text: 'نص' } } } : undefined),
    ])
    const pub = new XPublisher(account, store, () => 5, { fetch: f.fetch, sleep: noSleep })
    expect(await pub.remaining()).toBe(15)
    expect(await pub.publish(input)).toEqual({ link: 'https://x.com/i/status/1900' })
    expect(f.calls[0].init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('XID:XS').toString('base64')}` })
    expect(store.getToken('x.refresh')?.value).toBe('XR2')
    const appends = f.calls.filter((c) => c.url.pathname.endsWith('/append'))
    expect(appends.map((c) => (c.init.body as FormData).get('segment_index'))).toEqual(['0', '1', '2'])
    expect(JSON.parse(String(f.calls.at(-1)!.init.body))).toEqual({ text: 'نص', media: { media_ids: ['MID'] } })
  })

  it('treats spent credits as full', async () => {
    const f = fakeFetch([
      (u) => (u.pathname === '/2/oauth2/token' ? { body: { access_token: 'XA', expires_in: 7200 } } : undefined),
      () => ({ status: 402, body: { title: 'Payment Required' } }),
    ])
    await expect(new XPublisher(account, store, () => 0, { fetch: f.fetch, sleep: noSleep }).publish(input)).rejects.toMatchObject({ kind: 'full' })
  })
})
