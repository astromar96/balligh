// Threads video posts (Threads API, a long-lived token of the Share Quran profile):
//   POST /<user>/threads media_type=VIDEO, video_url=<this server's one-time media address>, text → container
//   wait ~30 s, GET /<container>?fields=status,error_message until FINISHED
//   POST /<user>/threads_publish creation_id → GET /<media>?fields=permalink
// Threads downloads the video itself, so PUBLIC_URL must reach this server. 250 posts per rolling 24 h
// (threads_publishing_limit). The token lives 60 days; refreshToken() renews it (daily from main.ts) and keeps the
// new one in the store.
import type { MetaAccount } from '../config'
import type { Store } from '../store'
import { defaultSleep, metaError, pollUntil, requestJson, type ClientDeps, type FetchFn } from './http'
import { PublishError, type Publisher, type PublishInput, type PublishResult } from './types'

const TOKEN = 'threads'

export class ThreadsPublisher implements Publisher {
  readonly platform = 'threads' as const
  /** Threads' spec: no edit lists */
  readonly plainMp4 = true
  private account: MetaAccount
  private base: string
  private store: Store
  private f: FetchFn
  private sleep: NonNullable<ClientDeps['sleep']>

  constructor(account: MetaAccount, version: string, store: Store, deps: ClientDeps = {}) {
    this.account = account
    this.base = `https://graph.threads.net/${version}`
    this.store = store
    this.f = deps.fetch ?? fetch
    this.sleep = deps.sleep ?? defaultSleep
  }

  /** the newest token: a refreshed one from the store, else the one in the environment */
  token(): string {
    return this.store.getToken(TOKEN)?.value ?? this.account.token
  }

  private url(path: string, params: Record<string, string> = {}): string {
    return `${this.base}/${path}?${new URLSearchParams({ ...params, access_token: this.token() })}`
  }

  async remaining(): Promise<number | null> {
    const body = await requestJson<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      this.f,
      this.url(`${this.account.id}/threads_publishing_limit`, { fields: 'quota_usage,config' }),
    ).catch((e: unknown) => {
      throw metaError(e)
    })
    const row = body.data?.[0]
    if (!row) return null
    return Math.max(0, (row.config?.quota_total ?? 250) - (row.quota_usage ?? 0))
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const created = await requestJson<{ id: string }>(this.f, `${this.base}/${this.account.id}/threads`, {
        method: 'POST',
        body: new URLSearchParams({ media_type: 'VIDEO', video_url: input.mediaUrl, text: input.caption.text, access_token: this.token() }),
        signal: input.signal,
      })
      await pollUntil(
        async () => {
          const s = await requestJson<{ status?: string; error_message?: string }>(this.f, this.url(created.id, { fields: 'status,error_message' }), {
            signal: input.signal,
          })
          if (s.status === 'FINISHED' || s.status === 'PUBLISHED') return true
          if (s.status === 'ERROR' || s.status === 'EXPIRED') throw new PublishError('failed', `container ${s.status}: ${s.error_message ?? ''}`)
          return undefined
        },
        { sleep: this.sleep, signal: input.signal, firstMs: 30_000, maxStepMs: 30_000, timeoutMs: 6 * 60_000, what: 'Threads processing' },
      )
      const published = await requestJson<{ id: string }>(this.f, `${this.base}/${this.account.id}/threads_publish`, {
        method: 'POST',
        body: new URLSearchParams({ creation_id: created.id, access_token: this.token() }),
        signal: input.signal,
      })
      const media = await requestJson<{ permalink?: string }>(this.f, this.url(published.id, { fields: 'permalink' }), { signal: input.signal })
      return { link: media.permalink ?? `https://www.threads.com/` }
    } catch (error) {
      throw metaError(error)
    }
  }

  /** Renews the 60-day token (it must be at least a day old); keeps the new one. */
  async refreshToken(): Promise<void> {
    const r = await requestJson<{ access_token: string; expires_in?: number }>(
      this.f,
      `https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: 'th_refresh_token', access_token: this.token() })}`,
    )
    this.store.setToken(TOKEN, r.access_token, r.expires_in ? Date.now() + r.expires_in * 1000 : null)
  }
}
