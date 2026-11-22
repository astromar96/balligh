// The HTTP API the export sheet talks to (plain node:http):
//   GET  /status          which platforms are live and how many posts each has left today
//   POST /publish         { query, platforms, name?, instagram?, turnstile? } → the job (202, or 200 when every
//                         platform was answered at once: an earlier post, not live, full)
//   GET  /publish/:id     the job, polled every few seconds
//   GET  /media/:t.mp4    the MP4 of the job now publishing (Threads fetches it); 404 at any other time
//   GET  /health
// CORS is limited to the app's own origins.
import { createReadStream, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Config } from './config'
import type { Jobs } from './jobs'
import { log } from './log'
import { canonicalQuery, parseCredit, parsePlatforms } from './validate'

const MAX_BODY = 8 * 1024

export type TurnstileCheck = (token: string, ip: string) => Promise<boolean>

export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token, remoteip: ip })
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  if (!res.ok) return false
  const data = (await res.json()) as { success?: boolean }
  return data.success === true
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for']
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? 'unknown'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('too-large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function createApi(deps: { cfg: Config; jobs: Jobs; turnstile?: TurnstileCheck }): Server {
  const { cfg, jobs } = deps
  const turnstile: TurnstileCheck | null =
    deps.turnstile ?? (cfg.turnstileSecret ? (token, ip) => verifyTurnstile(cfg.turnstileSecret as string, token, ip) : null)

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log('error', 'request failed', { path: req.url, error: String(error) })
      if (!res.headersSent) send(res, 500, { error: 'internal' })
      else res.end()
    })
  })

  function cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin
    if (origin && cfg.allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Max-Age', '600')
    }
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local')
    const path = url.pathname
    cors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true })

    if (req.method === 'GET' && path === '/status') return send(res, 200, { platforms: await jobs.status() })

    if (req.method === 'POST' && path === '/publish') {
      let body: Record<string, unknown>
      try {
        const parsed = await readJson(req)
        if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
        body = parsed as Record<string, unknown>
      } catch (error) {
        return send(res, (error as Error).message === 'too-large' ? 413 : 400, { error: 'bad-request' })
      }
      const query = canonicalQuery(body.query)
      if (!query) return send(res, 400, { error: 'bad-link' })
      const platforms = parsePlatforms(body.platforms)
      if (!platforms) return send(res, 400, { error: 'bad-platforms' })
      const credit = parseCredit(body.name, body.instagram)
      if (!credit.ok) return send(res, 400, { error: credit.error, problem: credit.problem })
      const ip = clientIp(req, cfg.trustProxy)
      if (turnstile) {
        const token = typeof body.turnstile === 'string' ? body.turnstile : ''
        if (!token || !(await turnstile(token, ip))) return send(res, 403, { error: 'captcha' })
      }
      const result = await jobs.submit({ query, platforms, credit: credit.credit, ip })
      if (!result.ok) return send(res, 429, { error: result.error })
      return send(res, result.job.status === 'queued' ? 202 : 200, jobs.view(result.job.id))
    }

    const jobMatch = path.match(/^\/publish\/([0-9a-f-]{36})$/)
    if (req.method === 'GET' && jobMatch) {
      const view = jobs.view(jobMatch[1])
      return view ? send(res, 200, view) : send(res, 404, { error: 'not-found' })
    }

    const mediaMatch = path.match(/^\/media\/([0-9a-f]{32})\.mp4$/)
    if ((req.method === 'GET' || req.method === 'HEAD') && mediaMatch) {
      const file = jobs.mediaFile(mediaMatch[1])
      if (!file) return send(res, 404, { error: 'not-found' })
      const size = statSync(file).size
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Cache-Control': 'no-store' })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(file).pipe(res)
      return
    }

    send(res, 404, { error: 'not-found' })
  }
}
