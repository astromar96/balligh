// Settings from the environment (server/.env.example lists them all). A platform is live only when all of its
// credentials are set (for YouTube and X: a refresh token from the consent CLI, in the environment or the store);
// DRY_RUN=1 swaps every platform for the dry-run publisher (nothing leaves the machine).
import { resolve } from 'node:path'

export interface MetaAccount {
  /** Instagram user id / Facebook page id / Threads user id */
  id: string
  token: string
}

export interface Config {
  port: number
  /** the web app the renderer opens: <appUrl>/render?… */
  appUrl: string
  /** this server's public address (Threads fetches the MP4 from <publicUrl>/media/…) */
  publicUrl: string
  allowedOrigins: string[]
  /** read the client address from X-Forwarded-For (behind Caddy) */
  trustProxy: boolean
  dataDir: string
  dryRun: boolean
  /** Playwright browser channel ('chrome' = Google Chrome); CHROME_PATH overrides it */
  chromeChannel: string
  chromePath: string | null
  /** new render jobs per client address per hour */
  perIpPerHour: number
  /** the «ادعمنا» page, added to captions */
  supportUrl: string | null
  turnstileSecret: string | null
  graphVersion: string
  threadsVersion: string
  instagram: MetaAccount | null
  facebook: MetaAccount | null
  threads: MetaAccount | null
  telegram: { botToken: string; channel: string } | null
  youtube: { clientId: string; clientSecret: string; refreshToken: string | null } | null
  x: { clientId: string; clientSecret: string | null; refreshToken: string | null; dailyMax: number } | null
}

type Env = Record<string, string | undefined>

function str(env: Env, key: string): string | null {
  const v = env[key]?.trim()
  return v ? v : null
}

function num(env: Env, key: string, fallback: number): number {
  const v = Number(env[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function meta(env: Env, idKey: string, tokenKey: string): MetaAccount | null {
  const id = str(env, idKey)
  const token = str(env, tokenKey)
  return id && token ? { id, token } : null
}

export function loadConfig(env: Env = process.env): Config {
  const appUrl = (str(env, 'APP_URL') ?? 'https://sharequran.app').replace(/\/+$/, '')
  const port = num(env, 'PORT', 8787)
  const botToken = str(env, 'TELEGRAM_BOT_TOKEN')
  const channel = str(env, 'TELEGRAM_CHANNEL')
  const ytId = str(env, 'YOUTUBE_CLIENT_ID')
  const ytSecret = str(env, 'YOUTUBE_CLIENT_SECRET')
  const xId = str(env, 'X_CLIENT_ID')
  return {
    port,
    appUrl,
    publicUrl: (str(env, 'PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    allowedOrigins: (str(env, 'ALLOWED_ORIGINS') ?? appUrl).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    trustProxy: env.TRUST_PROXY === '1',
    dataDir: resolve(str(env, 'DATA_DIR') ?? 'data'),
    dryRun: env.DRY_RUN === '1',
    chromeChannel: str(env, 'CHROME_CHANNEL') ?? 'chrome',
    chromePath: str(env, 'CHROME_PATH'),
    perIpPerHour: num(env, 'RATE_PER_HOUR', 3),
    supportUrl: str(env, 'SUPPORT_URL'),
    turnstileSecret: str(env, 'TURNSTILE_SECRET'),
    graphVersion: str(env, 'META_GRAPH_VERSION') ?? 'v25.0',
    threadsVersion: str(env, 'THREADS_API_VERSION') ?? 'v1.0',
    instagram: meta(env, 'INSTAGRAM_USER_ID', 'INSTAGRAM_TOKEN'),
    facebook: meta(env, 'FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN'),
    threads: meta(env, 'THREADS_USER_ID', 'THREADS_TOKEN'),
    telegram: botToken && channel ? { botToken, channel } : null,
    youtube:
      ytId && ytSecret
        ? { clientId: ytId, clientSecret: ytSecret, refreshToken: str(env, 'YOUTUBE_REFRESH_TOKEN') }
        : null,
    x: xId
      ? { clientId: xId, clientSecret: str(env, 'X_CLIENT_SECRET'), refreshToken: str(env, 'X_REFRESH_TOKEN'), dailyMax: num(env, 'X_DAILY_MAX', 20) }
      : null,
  }
}
