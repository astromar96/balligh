// Access tokens from a stored refresh token (YouTube, X). The refresh token comes from the one-time consent CLI
// (server/src/auth.ts) through the environment; when a platform hands out a new one (X rotates them), it is kept in
// the store and wins over the environment from then on.
import type { Store } from '../store'
import { ApiError, requestJson, type FetchFn } from './http'
import { PublishError } from './types'

export interface OAuthClient {
  tokenUrl: string
  clientId: string
  clientSecret: string | null
  /** send the client credentials as HTTP Basic (X confidential clients) instead of in the body (Google) */
  basicAuth: boolean
}

export class RefreshingToken {
  private client: OAuthClient
  private store: Store
  private name: string
  private envRefresh: string | null
  private f: FetchFn
  private access: { value: string; expiresAt: number } | null = null

  constructor(client: OAuthClient, store: Store, name: string, envRefresh: string | null, f: FetchFn) {
    this.client = client
    this.store = store
    this.name = name
    this.envRefresh = envRefresh
    this.f = f
  }

  private refreshToken(): string | null {
    return this.store.getToken(`${this.name}.refresh`)?.value ?? this.envRefresh
  }

  /** a valid access token, refreshed when it has less than a minute left */
  async get(signal?: AbortSignal): Promise<string> {
    if (this.access && this.access.expiresAt - Date.now() > 60_000) return this.access.value
    const refresh = this.refreshToken()
    if (!refresh) throw new PublishError('auth', `${this.name}: no refresh token (run the consent CLI, server/README.md)`)
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: this.client.clientId })
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
    if (this.client.clientSecret) {
      if (this.client.basicAuth) headers.Authorization = `Basic ${Buffer.from(`${this.client.clientId}:${this.client.clientSecret}`).toString('base64')}`
      else body.set('client_secret', this.client.clientSecret)
    }
    let r: { access_token: string; expires_in?: number; refresh_token?: string }
    try {
      r = await requestJson(this.f, this.client.tokenUrl, { method: 'POST', headers, body, signal })
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0
      throw new PublishError(status === 400 || status === 401 ? 'auth' : 'failed', `${this.name} token refresh: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (r.refresh_token && r.refresh_token !== refresh) this.store.setToken(`${this.name}.refresh`, r.refresh_token, null)
    this.access = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
    return r.access_token
  }
}
