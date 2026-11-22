// Facebook Page Reels (Reels Publishing API, a Page token from the business's system user):
//   POST /<page>/video_reels upload_phase=start → { video_id, upload_url }
//   POST rupload.facebook.com/video-upload/<v>/<video_id> with the bytes (Authorization: OAuth, offset 0, file_size)
//   POST /<page>/video_reels upload_phase=finish, video_state=PUBLISHED, description
//   GET  /<video_id>?fields=status until published → the reel's address (permalink_url, else facebook.com/reel/<id>)
// 30 reels per rolling 24 h, 3–90 s. Meta gives no endpoint for the count, so it is counted from Balligh's own posts.
import { readFile } from 'node:fs/promises'
import { PLATFORM_RULES } from '../../../src/domain'
import type { MetaAccount } from '../config'
import { defaultSleep, metaError, pollUntil, requestJson, type ClientDeps, type FetchFn } from './http'
import { PublishError, type Publisher, type PublishInput, type PublishResult } from './types'

/** "Calls to this api have exceeded the rate limit" — the reels cap */
const FULL = { codes: [613] }

interface VideoStatus {
  video_status?: string
  processing_phase?: { status?: string; error?: { message?: string } }
  publishing_phase?: { status?: string; publish_status?: string; error?: { message?: string } }
  uploading_phase?: { status?: string }
}

export class FacebookPublisher implements Publisher {
  readonly platform = 'facebook' as const
  readonly plainMp4 = false
  private account: MetaAccount
  private version: string
  private graph: string
  private postsLastDay: () => number
  private f: FetchFn
  private sleep: NonNullable<ClientDeps['sleep']>

  constructor(account: MetaAccount, graphVersion: string, postsLastDay: () => number, deps: ClientDeps = {}) {
    this.account = account
    this.version = graphVersion
    this.graph = `https://graph.facebook.com/${graphVersion}`
    this.postsLastDay = postsLastDay
    this.f = deps.fetch ?? fetch
    this.sleep = deps.sleep ?? defaultSleep
  }

  async remaining(): Promise<number | null> {
    return Math.max(0, (PLATFORM_RULES.facebook.dailyPosts ?? 30) - this.postsLastDay())
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const bytes = await readFile(input.file)
      const reels = `${this.graph}/${this.account.id}/video_reels`
      const start = await requestJson<{ video_id: string; upload_url?: string }>(this.f, reels, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_phase: 'start', access_token: this.account.token }),
        signal: input.signal,
      })
      await requestJson(this.f, start.upload_url ?? `https://rupload.facebook.com/video-upload/${this.version}/${start.video_id}`, {
        method: 'POST',
        headers: { Authorization: `OAuth ${this.account.token}`, offset: '0', file_size: String(bytes.length), 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(bytes),
        signal: input.signal,
      })
      await requestJson(this.f, reels, {
        method: 'POST',
        body: new URLSearchParams({
          upload_phase: 'finish',
          video_id: start.video_id,
          video_state: 'PUBLISHED',
          description: input.caption.text,
          access_token: this.account.token,
        }),
        signal: input.signal,
      })
      await pollUntil(
        async () => {
          const v = await requestJson<{ status?: VideoStatus }>(this.f, this.url(start.video_id, { fields: 'status' }), { signal: input.signal })
          const s = v.status ?? {}
          const failed = s.video_status === 'error' || s.video_status === 'upload_failed' || s.processing_phase?.status === 'error' || s.publishing_phase?.status === 'error'
          if (failed) {
            const why = s.publishing_phase?.error?.message ?? s.processing_phase?.error?.message ?? s.video_status
            throw new PublishError('failed', `reel ${why}`)
          }
          if (s.publishing_phase?.publish_status === 'published' || s.publishing_phase?.status === 'complete' || s.publishing_phase?.status === 'completed') return true
          return undefined
        },
        { sleep: this.sleep, signal: input.signal, firstMs: 5000, maxStepMs: 30_000, timeoutMs: 10 * 60_000, what: 'Facebook processing' },
      )
      return { link: await this.permalink(start.video_id, input.signal) }
    } catch (error) {
      throw metaError(error, FULL)
    }
  }

  private url(path: string, params: Record<string, string> = {}): string {
    return `${this.graph}/${path}?${new URLSearchParams({ ...params, access_token: this.account.token })}`
  }

  private async permalink(videoId: string, signal: AbortSignal): Promise<string> {
    const fallback = `https://www.facebook.com/reel/${videoId}`
    try {
      const v = await requestJson<{ permalink_url?: string }>(this.f, this.url(videoId, { fields: 'permalink_url' }), { signal })
      const p = v.permalink_url
      if (!p) return fallback
      return p.startsWith('http') ? p : `https://www.facebook.com${p.startsWith('/') ? '' : '/'}${p}`
    } catch {
      return fallback
    }
  }
}
