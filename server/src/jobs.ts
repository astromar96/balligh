// Publish jobs: what each requested platform needs (an earlier post of the same clip, not live, full today, or a new
// post), then one job at a time renders the clip and posts it platform by platform. The MP4 lives on disk only while
// its job runs (QF terms: recitation files are never kept or rehosted — 00-gaps §2.9); the publisher credit is dropped
// when the job ends.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { platformRefusal, PUBLISH_PLATFORMS, type PublisherCredit, type PublishPlatform } from '../../src/domain'
import { buildCaption } from './captions'
import type { Config } from './config'
import { log } from './log'
import { stripEditLists } from './mp4'
import { PublishError, type Publisher } from './publishers/types'
import { RenderError, type RenderFn } from './render'
import type { Job, PlatformState, Store } from './store'

export interface SubmitInput {
  /** canonical query (validate.canonicalQuery) */
  query: string
  platforms: PublishPlatform[]
  credit: PublisherCredit
  ip: string
}

export interface JobView {
  id: string
  status: Job['status']
  /** place in the queue, 1 = next; 0 when not queued */
  position: number
  phase: string | null
  progress: number
  error: string | null
  /** the clip's deep link in the app */
  link: string | null
  platforms: Job['platforms']
}

export interface PlatformStatus {
  live: boolean
  /** posts left today; null = no known cap */
  remaining: number | null
}

const REMAINING_TTL_MS = 60_000

export class Jobs {
  private store: Store
  private cfg: Config
  private publishers: Map<PublishPlatform, Publisher>
  private render: RenderFn
  private running = false
  private media = new Map<string, string>()
  private remainingCache = new Map<PublishPlatform, { at: number; value: number | null }>()
  private current: AbortController | null = null
  /** resolves when the worker goes idle (tests) */
  idle: Promise<void> = Promise.resolve()

  constructor(deps: { store: Store; cfg: Config; publishers: Map<PublishPlatform, Publisher>; render: RenderFn }) {
    this.store = deps.store
    this.cfg = deps.cfg
    this.publishers = deps.publishers
    this.render = deps.render
  }

  /** posts left today on a platform, cached for a minute (Instagram's count is an API call) */
  async remaining(platform: PublishPlatform, fresh = false): Promise<number | null> {
    const pub = this.publishers.get(platform)
    if (!pub) return 0
    const hit = this.remainingCache.get(platform)
    if (!fresh && hit && Date.now() - hit.at < REMAINING_TTL_MS) return hit.value
    let value: number | null
    try {
      value = await pub.remaining()
    } catch (error) {
      log('warn', 'remaining() failed', { platform, error: String(error) })
      value = null
    }
    this.remainingCache.set(platform, { at: Date.now(), value })
    return value
  }

  async status(): Promise<Record<PublishPlatform, PlatformStatus>> {
    const out = {} as Record<PublishPlatform, PlatformStatus>
    for (const p of PUBLISH_PLATFORMS) out[p] = this.publishers.has(p) ? { live: true, remaining: await this.remaining(p) } : { live: false, remaining: 0 }
    return out
  }

  async submit(input: SubmitInput): Promise<{ ok: true; job: Job } | { ok: false; error: 'rate-limited' }> {
    const platforms: Job['platforms'] = {}
    for (const p of input.platforms) {
      // an invite can only go out with a new reel, so an Instagram username always makes a new Instagram post
      const reusable = !(p === 'instagram' && input.credit.instagram)
      const earlier = reusable ? this.store.findPost(p, input.query) : null
      if (earlier) platforms[p] = { state: 'done', link: earlier, reused: true }
      else if (!this.publishers.has(p)) platforms[p] = { state: 'skipped', reason: 'not-live' }
      else platforms[p] = (await this.remaining(p)) === 0 ? { state: 'full' } : { state: 'waiting' }
    }
    const needsRender = Object.values(platforms).some((s) => s.state === 'waiting')
    if (needsRender) {
      if (this.store.hitsLastHour(input.ip) >= this.cfg.perIpPerHour) return { ok: false, error: 'rate-limited' }
      this.store.addHit(input.ip)
    }
    const job = this.store.insertJob({
      id: randomUUID(),
      status: needsRender ? 'queued' : 'done',
      query: input.query,
      key: input.query,
      platforms,
      credit: needsRender ? input.credit : null,
      ip: null,
      phase: null,
      progress: 0,
      error: null,
      // the render route reports the same link; a job answered at once never renders
      link: `${this.cfg.appUrl}/?${input.query}`,
    })
    if (needsRender) this.kick()
    return { ok: true, job }
  }

  view(id: string): JobView | null {
    const job = this.store.getJob(id)
    if (!job) return null
    return {
      id: job.id,
      status: job.status,
      position: this.store.queuePosition(job.id),
      phase: job.phase,
      progress: job.progress,
      error: job.error,
      link: job.link,
      platforms: job.platforms,
    }
  }

  /** the MP4 behind a one-time media address, while its job is publishing */
  mediaFile(token: string): string | null {
    return this.media.get(token) ?? null
  }

  kick(): void {
    if (this.running) return
    this.running = true
    this.idle = this.loop().finally(() => {
      this.running = false
    })
  }

  stop(): void {
    this.current?.abort()
  }

  private async loop(): Promise<void> {
    for (let job = this.store.nextQueued(); job; job = this.store.nextQueued()) {
      try {
        await this.run(job)
      } catch (error) {
        log('error', 'job crashed', { job: job.id, error: String(error) })
        this.store.updateJob(job.id, { status: 'failed', error: 'internal', credit: null })
      }
    }
  }

  private async run(job: Job): Promise<void> {
    const { store, cfg } = this
    const dir = join(cfg.dataDir, 'media')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${job.id}.mp4`)
    const plain = join(dir, `${job.id}.plain.mp4`)
    const token = randomBytes(16).toString('hex')
    const ctrl = new AbortController()
    this.current = ctrl
    const platforms: Job['platforms'] = { ...job.platforms }
    const save = (patch: Parameters<Store['updateJob']>[1] = {}) => store.updateJob(job.id, { platforms, ...patch })
    store.updateJob(job.id, { status: 'rendering', phase: 'loading', progress: 0 })
    log('info', 'render', { job: job.id, query: job.query })
    try {
      let lastWrite = 0
      const out = await this.render({
        cfg,
        query: job.query,
        out: file,
        signal: ctrl.signal,
        onProgress: (phase, ratio) => {
          if (Date.now() - lastWrite < 500) return
          lastWrite = Date.now()
          store.updateJob(job.id, { phase, progress: ratio })
        },
      })
      for (const p of PUBLISH_PLATFORMS) {
        if (platforms[p]?.state !== 'waiting') continue
        const why = platformRefusal(p, out.durationMs, out.bytes)
        if (why) platforms[p] = { state: 'skipped', reason: why }
      }
      save({ status: 'publishing', phase: 'publishing', progress: 1, link: out.link })
      // Instagram and Threads take no edit lists (mp4.ts); the one-time media address serves that copy (Threads)
      const wantsPlain = PUBLISH_PLATFORMS.some((p) => platforms[p]?.state === 'waiting' && this.publishers.get(p)?.plainMp4)
      if (wantsPlain) await writeFile(plain, stripEditLists(await readFile(file)))
      this.media.set(token, wantsPlain ? plain : file)
      const credit = job.credit ?? { name: null, instagram: null }
      for (const p of PUBLISH_PLATFORMS) {
        if (platforms[p]?.state !== 'waiting') continue
        const pub = this.publishers.get(p)
        if (!pub) {
          platforms[p] = { state: 'skipped', reason: 'not-live' }
          continue
        }
        platforms[p] = { state: 'publishing' }
        save()
        platforms[p] = await this.publishOne(pub, job, { ...out, file: pub.plainMp4 ? plain : file }, credit, token, ctrl.signal)
        save()
      }
      save({ status: 'done', phase: null, credit: null })
      log('info', 'done', { job: job.id, platforms: Object.fromEntries(Object.entries(platforms).map(([p, s]) => [p, s.state])) })
    } catch (error) {
      const code = error instanceof RenderError ? error.code : 'internal'
      log(code === 'cut-warning' || code === 'bad-link' || code === 'too-short' ? 'info' : 'error', 'render failed', { job: job.id, code, error: String(error) })
      for (const p of PUBLISH_PLATFORMS) {
        const s = platforms[p]?.state
        if (s === 'waiting' || s === 'publishing') platforms[p] = { state: 'failed', reason: code }
      }
      save({ status: 'failed', error: code, credit: null })
    } finally {
      this.current = null
      this.media.delete(token)
      rmSync(file, { force: true })
      rmSync(plain, { force: true })
    }
  }

  private async publishOne(
    pub: Publisher,
    job: Job,
    out: Awaited<ReturnType<RenderFn>>,
    credit: PublisherCredit,
    token: string,
    signal: AbortSignal,
  ): Promise<PlatformState> {
    const p = pub.platform
    try {
      if ((await this.remaining(p, true)) === 0) return { state: 'full' }
      const caption = buildCaption(p, out.captionParts, credit, { supportUrl: this.cfg.supportUrl, reciterName: out.reciterName })
      const res = await pub.publish({
        jobId: job.id,
        file: out.file,
        bytes: out.bytes,
        durationMs: out.durationMs,
        width: out.width,
        height: out.height,
        caption,
        credit,
        mediaUrl: `${this.cfg.publicUrl}/media/${token}.mp4`,
        signal,
      })
      this.store.addPost(p, job.key, res.link, p === 'instagram' && !!credit.instagram)
      this.remainingCache.delete(p)
      return res.note ? { state: 'done', link: res.link, note: res.note } : { state: 'done', link: res.link }
    } catch (error) {
      log('error', 'publish failed', { job: job.id, platform: p, error: String(error) })
      if (error instanceof PublishError && error.kind === 'full') return { state: 'full' }
      return { state: 'failed', reason: error instanceof PublishError ? error.kind : 'failed' }
    }
  }
}
