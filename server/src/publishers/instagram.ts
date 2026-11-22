// Instagram Reels through the Instagram Graph API (Facebook Login, a system-user token of the business that owns the
// account — Standard Access, no App Review for our own account):
//   POST /<ig>/media (REELS, upload_type=resumable, caption, collaborators) → { id, uri }
//   POST <uri> on rupload.facebook.com with the bytes (Authorization: OAuth, offset 0, file_size)
//   GET  /<container>?fields=status_code until FINISHED → POST /<ig>/media_publish → GET /<media>?fields=permalink
// The publisher's Instagram username goes out as a collaborator invite; when Instagram refuses the container with it,
// the container is made again without it (note 'invite-failed'). 50 posts per rolling 24 h, read from content_publishing_limit.
import { readFile } from 'node:fs/promises'
import type { MetaAccount } from '../config'
import { ApiError, defaultSleep, metaError, pollUntil, requestJson, type ClientDeps, type FetchFn } from './http'
import { PublishError, type Publisher, type PublishInput, type PublishResult } from './types'

/** media_publish's "maximum number of posts" answer (code 9) */
const FULL = { subcodes: [2207042], codes: [9] }
const NOT_READY = 2207027

export class InstagramPublisher implements Publisher {
  readonly platform = 'instagram' as const
  /** Instagram's spec: no edit lists */
  readonly plainMp4 = true
  private account: MetaAccount
  private graph: string
  private f: FetchFn
  private sleep: NonNullable<ClientDeps['sleep']>

  constructor(account: MetaAccount, graphVersion: string, deps: ClientDeps = {}) {
    this.account = account
    this.graph = `https://graph.facebook.com/${graphVersion}`
    this.f = deps.fetch ?? fetch
    this.sleep = deps.sleep ?? defaultSleep
  }

  private url(path: string, params: Record<string, string> = {}): string {
    return `${this.graph}/${path}?${new URLSearchParams({ ...params, access_token: this.account.token })}`
  }

  async remaining(): Promise<number | null> {
    const body = await requestJson<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      this.f,
      this.url(`${this.account.id}/content_publishing_limit`, { fields: 'config,quota_usage' }),
    ).catch((e: unknown) => {
      throw metaError(e)
    })
    const row = body.data?.[0]
    if (!row) return null
    const total = row.config?.quota_total ?? 50
    return Math.max(0, total - (row.quota_usage ?? 0))
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const bytes = await readFile(input.file)
      const { container, inviteFailed } = await this.makeReel(input, bytes)
      const mediaId = await this.publishContainer(container, input.signal)
      const media = await requestJson<{ permalink?: string }>(this.f, this.url(mediaId, { fields: 'permalink' }), { signal: input.signal })
      const link = media.permalink ?? `https://www.instagram.com/reel/${mediaId}/`
      return inviteFailed ? { link, note: 'invite-failed' } : { link }
    } catch (error) {
      throw metaError(error, FULL)
    }
  }

  /** container → upload → FINISHED */
  private async makeReel(input: PublishInput, bytes: Buffer): Promise<{ container: string; inviteFailed: boolean }> {
    const create = (collaborator: string | null) => {
      const form = new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: input.caption.text, access_token: this.account.token })
      if (collaborator) form.set('collaborators', collaborator)
      return requestJson<{ id: string; uri?: string }>(this.f, `${this.graph}/${this.account.id}/media`, { method: 'POST', body: form, signal: input.signal })
    }
    let created: { id: string; uri?: string }
    let inviteFailed = false
    try {
      created = await create(input.credit.instagram)
    } catch (error) {
      // a refused collaborator must not cost the user the post: once more without the invite
      if (!input.credit.instagram || metaError(error, FULL).kind !== 'failed') throw error
      created = await create(null)
      inviteFailed = true
    }
    const uri = created.uri ?? `https://rupload.facebook.com/ig-api-upload/${this.graph.split('/').pop()}/${created.id}`
    await requestJson(this.f, uri, {
      method: 'POST',
      headers: { Authorization: `OAuth ${this.account.token}`, offset: '0', file_size: String(bytes.length) },
      body: new Uint8Array(bytes),
      signal: input.signal,
    })
    await pollUntil(
      async () => {
        const s = await requestJson<{ status_code?: string; status?: string }>(this.f, this.url(created.id, { fields: 'status_code,status' }), { signal: input.signal })
        if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return true
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new PublishError('failed', `container ${s.status_code}: ${s.status ?? ''}`)
        return undefined
      },
      { sleep: this.sleep, signal: input.signal, firstMs: 5000, maxStepMs: 30_000, timeoutMs: 10 * 60_000, what: 'Instagram processing' },
    )
    return { container: created.id, inviteFailed }
  }

  private async publishContainer(container: string, signal: AbortSignal): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await requestJson<{ id: string }>(this.f, `${this.graph}/${this.account.id}/media_publish`, {
          method: 'POST',
          body: new URLSearchParams({ creation_id: container, access_token: this.account.token }),
          signal,
        })
        return r.id
      } catch (error) {
        if (error instanceof ApiError && error.subcode === NOT_READY && attempt < 3) {
          await this.sleep(15_000, signal)
          continue
        }
        throw error
      }
    }
  }
}
