// X posts with a video (API v2, OAuth 2.0 user token of the Share Quran account; scopes tweet.write tweet.read
// users.read media.write offline.access):
//   POST /2/media/upload/initialize { media_type, total_bytes, media_category: tweet_video } → id
//   POST /2/media/upload/<id>/append (multipart: media, segment_index), 4 MB segments
//   POST /2/media/upload/<id>/finalize → processing_info; GET /2/media/upload?command=STATUS&media_id=… until succeeded
//   POST /2/tweets { text, media: { media_ids } } → x.com/i/status/<id>
// Every post is paid (pay-per-use): the caption carries no URL ($0.015 a post instead of $0.20, captions.ts), and
// X_DAILY_MAX caps the posts a day.
import { readFile } from 'node:fs/promises'
import type { Config } from '../config'
import type { Store } from '../store'
import { ApiError, requestJson, type ClientDeps, type FetchFn, defaultSleep } from './http'
import { RefreshingToken } from './oauth'
import { PublishError, type Publisher, type PublishInput, type PublishResult } from './types'

const API = 'https://api.x.com/2'
const SEGMENT = 4 * 1024 * 1024
const PROCESSING_TIMEOUT_MS = 5 * 60_000

interface ProcessingInfo {
  state?: 'pending' | 'in_progress' | 'succeeded' | 'failed'
  check_after_secs?: number
  error?: { message?: string }
}

function xError(error: unknown): PublishError {
  if (error instanceof PublishError) return error
  if (error instanceof ApiError) {
    // 402: the prepaid credits are spent — nothing more can be posted until Omar tops them up
    if (error.status === 402) return new PublishError('full', 'x: credits spent')
    if (error.status === 401 || error.status === 403) return new PublishError('auth', `x ${error.status}: ${error.message}`)
    const detail = (error.body as { detail?: string; title?: string } | null)?.detail
    return new PublishError('failed', `x ${error.status}: ${detail ?? error.message}`)
  }
  return new PublishError('failed', error instanceof Error ? error.message : String(error))
}

export class XPublisher implements Publisher {
  readonly platform = 'x' as const
  readonly plainMp4 = false
  private token: RefreshingToken
  private dailyMax: number
  private postsLastDay: () => number
  private f: FetchFn
  private sleep: NonNullable<ClientDeps['sleep']>

  constructor(account: NonNullable<Config['x']>, store: Store, postsLastDay: () => number, deps: ClientDeps = {}) {
    this.f = deps.fetch ?? fetch
    this.sleep = deps.sleep ?? defaultSleep
    this.dailyMax = account.dailyMax
    this.postsLastDay = postsLastDay
    this.token = new RefreshingToken(
      { tokenUrl: `${API}/oauth2/token`, clientId: account.clientId, clientSecret: account.clientSecret, basicAuth: true },
      store,
      'x',
      account.refreshToken,
      this.f,
    )
  }

  async remaining(): Promise<number | null> {
    return Math.max(0, this.dailyMax - this.postsLastDay())
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const bytes = await readFile(input.file)
      const auth = { Authorization: `Bearer ${await this.token.get(input.signal)}` }
      const init = await requestJson<{ data: { id: string } }>(this.f, `${API}/media/upload/initialize`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'video/mp4', total_bytes: bytes.length, media_category: 'tweet_video' }),
        signal: input.signal,
      })
      const id = init.data.id
      for (let i = 0, offset = 0; offset < bytes.length; i++, offset += SEGMENT) {
        const form = new FormData()
        form.set('segment_index', String(i))
        form.set('media', new Blob([new Uint8Array(bytes.subarray(offset, offset + SEGMENT))], { type: 'application/octet-stream' }), `part${i}`)
        await requestJson(this.f, `${API}/media/upload/${id}/append`, { method: 'POST', headers: auth, body: form, signal: input.signal })
      }
      const fin = await requestJson<{ data: { processing_info?: ProcessingInfo } }>(this.f, `${API}/media/upload/${id}/finalize`, {
        method: 'POST',
        headers: auth,
        signal: input.signal,
      })
      await this.waitProcessed(id, fin.data.processing_info, auth, input.signal)
      const post = await requestJson<{ data: { id: string } }>(this.f, `${API}/tweets`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.caption.text, media: { media_ids: [id] } }),
        signal: input.signal,
      })
      return { link: `https://x.com/i/status/${post.data.id}` }
    } catch (error) {
      throw xError(error)
    }
  }

  private async waitProcessed(id: string, first: ProcessingInfo | undefined, auth: Record<string, string>, signal: AbortSignal): Promise<void> {
    let info = first
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS
    while (info && info.state !== 'succeeded') {
      if (info.state === 'failed') throw new PublishError('failed', `x media processing failed: ${info.error?.message ?? ''}`)
      if (Date.now() > deadline) throw new PublishError('failed', 'x media still processing')
      await this.sleep(Math.max(1, info.check_after_secs ?? 2) * 1000, signal)
      const s = await requestJson<{ data: { processing_info?: ProcessingInfo } }>(this.f, `${API}/media/upload?command=STATUS&media_id=${id}`, { headers: auth, signal })
      info = s.data.processing_info
    }
  }
}
