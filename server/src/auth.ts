// One-time consent for the platforms that post with a user's refresh token: run on a machine with a browser,
//   npm run auth -- youtube     (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET of a "Desktop app" OAuth client)
//   npm run auth -- x           (X_CLIENT_ID [/ X_CLIENT_SECRET]; http://127.0.0.1:8789/callback registered in the X app)
// sign in as the Share Quran account, and copy the printed line into the server's .env.
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { loadConfig } from './config'

const which = process.argv[2]
const port = Number(process.env.AUTH_PORT ?? 8789)
const redirectUri = `http://127.0.0.1:${port}/callback`
const cfg = loadConfig()
const state = randomBytes(16).toString('hex')
const verifier = randomBytes(48).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

interface Flow {
  authorizeUrl: string
  exchange(code: string): Promise<{ refresh_token?: string }>
  envName: string
}

async function postForm(url: string, body: URLSearchParams, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) fail(`token exchange failed (${res.status}): ${JSON.stringify(json)}`)
  return json
}

function flow(): Flow {
  if (which === 'youtube') {
    const yt = cfg.youtube ?? fail('set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first')
    return {
      envName: 'YOUTUBE_REFRESH_TOKEN',
      authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: yt.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.upload',
        access_type: 'offline',
        prompt: 'consent',
        state,
      })}`,
      exchange: (code) =>
        postForm(
          'https://oauth2.googleapis.com/token',
          new URLSearchParams({ code, client_id: yt.clientId, client_secret: yt.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
        ),
    }
  }
  if (which === 'x') {
    const x = cfg.x ?? fail('set X_CLIENT_ID (and X_CLIENT_SECRET for a confidential client) first')
    const basic: Record<string, string> = x.clientSecret ? { Authorization: `Basic ${Buffer.from(`${x.clientId}:${x.clientSecret}`).toString('base64')}` } : {}
    return {
      envName: 'X_REFRESH_TOKEN',
      authorizeUrl: `https://x.com/i/oauth2/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: x.clientId,
        redirect_uri: redirectUri,
        scope: 'tweet.read tweet.write users.read media.write offline.access',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`,
      // X's code is valid for 30 seconds: exchanged the moment the browser comes back
      exchange: (code) =>
        postForm(
          'https://api.x.com/2/oauth2/token',
          new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier, client_id: x.clientId }),
          basic,
        ),
    }
  }
  return fail('usage: npm run auth -- youtube|x')
}

const f = flow()
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', redirectUri)
  if (url.pathname !== '/callback') {
    res.writeHead(404).end()
    return
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('state mismatch')
    return
  }
  const code = url.searchParams.get('code')
  if (!code) {
    res.writeHead(400).end(`no code: ${url.searchParams.get('error') ?? ''}`)
    return
  }
  f.exchange(code).then((tokens) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Done — you can close this tab.')
    if (!tokens.refresh_token) fail('no refresh token came back (for YouTube: revoke the app at myaccount.google.com/permissions and run again)')
    console.log(`\nAdd this line to server/.env:\n\n${f.envName}=${tokens.refresh_token}\n`)
    server.close()
  })
})
server.listen(port, '127.0.0.1', () => {
  console.log(`Open this address, sign in as the Share Quran account and allow access:\n\n${f.authorizeUrl}\n`)
})
