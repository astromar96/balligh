// The server's state, in one SQLite file (node:sqlite): jobs, what was posted where (dedupe and the rolling 24 h
// counts), request times per client address (rate limit) and tokens that rotate (Threads, YouTube, X). A job's
// publisher credit and client address are dropped when it ends; finished jobs are deleted after a day.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PublisherCredit, PublishPlatform } from '../../src/domain'

export type JobStatus = 'queued' | 'rendering' | 'publishing' | 'done' | 'failed'

export type PlatformState =
  | { state: 'waiting' }
  | { state: 'publishing' }
  | { state: 'done'; link: string; reused?: boolean; note?: 'invite-failed' }
  | { state: 'skipped'; reason: 'not-live' | 'too-long' | 'too-short' | 'too-big' }
  | { state: 'full' }
  | { state: 'failed'; reason: string }

export interface Job {
  id: string
  createdAt: number
  updatedAt: number
  status: JobStatus
  /** the canonical query the server renders (aspect forced to 9:16) */
  query: string
  /** dedupe key */
  key: string
  platforms: Partial<Record<PublishPlatform, PlatformState>>
  credit: PublisherCredit | null
  ip: string | null
  phase: string | null
  progress: number
  error: string | null
  /** the deep link to the clip in the app, once rendered */
  link: string | null
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

interface JobRow {
  id: string
  created_at: number
  updated_at: number
  status: JobStatus
  query: string
  key: string
  platforms: string
  credit: string | null
  ip: string | null
  phase: string | null
  progress: number
  error: string | null
  link: string | null
}

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    status: r.status,
    query: r.query,
    key: r.key,
    platforms: JSON.parse(r.platforms) as Job['platforms'],
    credit: r.credit ? (JSON.parse(r.credit) as PublisherCredit) : null,
    ip: r.ip,
    phase: r.phase,
    progress: r.progress,
    error: r.error,
    link: r.link,
  }
}

export class Store {
  private db: DatabaseSync
  private now: () => number

  constructor(file: string, now: () => number = Date.now) {
    this.now = now
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL,
        query TEXT NOT NULL, key TEXT NOT NULL, platforms TEXT NOT NULL, credit TEXT, ip TEXT,
        phase TEXT, progress REAL NOT NULL DEFAULT 0, error TEXT, link TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, created_at);
      CREATE TABLE IF NOT EXISTS posts (
        platform TEXT NOT NULL, key TEXT NOT NULL, link TEXT NOT NULL, created_at INTEGER NOT NULL,
        with_account INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS posts_key ON posts (platform, key, created_at);
      CREATE INDEX IF NOT EXISTS posts_time ON posts (platform, created_at);
      CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS hits_ip ON hits (ip, at);
      CREATE TABLE IF NOT EXISTS tokens (name TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER, updated_at INTEGER NOT NULL);
    `)
  }

  static open(dataDir: string): Store {
    mkdirSync(dataDir, { recursive: true })
    return new Store(join(dataDir, 'balligh.sqlite'))
  }

  close(): void {
    this.db.close()
  }

  // ── jobs ──

  insertJob(job: Omit<Job, 'createdAt' | 'updatedAt'>): Job {
    const t = this.now()
    this.db
      .prepare(
        'INSERT INTO jobs (id, created_at, updated_at, status, query, key, platforms, credit, ip, phase, progress, error, link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(job.id, t, t, job.status, job.query, job.key, JSON.stringify(job.platforms), job.credit ? JSON.stringify(job.credit) : null, job.ip, job.phase, job.progress, job.error, job.link)
    return { ...job, createdAt: t, updatedAt: t }
  }

  getJob(id: string): Job | null {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    return r ? toJob(r) : null
  }

  updateJob(id: string, patch: Partial<Pick<Job, 'status' | 'platforms' | 'credit' | 'ip' | 'phase' | 'progress' | 'error' | 'link'>>): void {
    const sets: string[] = ['updated_at = ?']
    const values: (string | number | null)[] = [this.now()]
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`)
      if (k === 'platforms') values.push(JSON.stringify(v))
      else if (k === 'credit') values.push(v ? JSON.stringify(v) : null)
      else values.push(v as string | number | null)
    }
    values.push(id)
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  /** the oldest queued job */
  nextQueued(): Job | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1").get() as JobRow | undefined
    return r ? toJob(r) : null
  }

  /** 1-based place in the queue (1 = next), or 0 when the job is not queued */
  queuePosition(id: string): number {
    const job = this.getJob(id)
    if (!job || job.status !== 'queued') return 0
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND (created_at < ? OR (created_at = ? AND id <= ?))")
      .get(job.createdAt, job.createdAt, id) as { n: number }
    return r.n
  }

  /** at start-up: jobs a previous process left half done can never finish */
  failInterrupted(): number {
    const rows = this.db.prepare("SELECT * FROM jobs WHERE status IN ('queued', 'rendering', 'publishing')").all() as unknown as JobRow[]
    for (const r of rows) {
      const job = toJob(r)
      const platforms = Object.fromEntries(
        Object.entries(job.platforms).map(([p, s]) => [p, s.state === 'waiting' || s.state === 'publishing' ? { state: 'failed', reason: 'restart' } : s]),
      )
      this.updateJob(job.id, { status: 'failed', error: 'restart', platforms, credit: null, ip: null })
    }
    return rows.length
  }

  // ── posts ──

  addPost(platform: PublishPlatform, key: string, link: string, withAccount: boolean): void {
    this.db.prepare('INSERT INTO posts (platform, key, link, created_at, with_account) VALUES (?, ?, ?, ?, ?)').run(platform, key, link, this.now(), withAccount ? 1 : 0)
  }

  /** the newest post of this clip on this platform */
  findPost(platform: PublishPlatform, key: string): string | null {
    const r = this.db.prepare('SELECT link FROM posts WHERE platform = ? AND key = ? ORDER BY created_at DESC LIMIT 1').get(platform, key) as
      | { link: string }
      | undefined
    return r?.link ?? null
  }

  /** posts on this platform in the rolling 24 h */
  postsLastDay(platform: PublishPlatform): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE platform = ? AND created_at > ?').get(platform, this.now() - DAY) as { n: number }
    return r.n
  }

  // ── rate limit ──

  hitsLastHour(ip: string): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM hits WHERE ip = ? AND at > ?').get(ip, this.now() - HOUR) as { n: number }
    return r.n
  }

  addHit(ip: string): void {
    this.db.prepare('INSERT INTO hits (ip, at) VALUES (?, ?)').run(ip, this.now())
  }

  // ── tokens ──

  getToken(name: string): { value: string; expiresAt: number | null } | null {
    const r = this.db.prepare('SELECT value, expires_at FROM tokens WHERE name = ?').get(name) as { value: string; expires_at: number | null } | undefined
    return r ? { value: r.value, expiresAt: r.expires_at } : null
  }

  setToken(name: string, value: string, expiresAt: number | null): void {
    this.db
      .prepare('INSERT INTO tokens (name, value, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at')
      .run(name, value, expiresAt, this.now())
  }

  // ── housekeeping ──

  /** hits older than an hour; finished jobs older than a day (posts are kept: they are the dedupe memory) */
  purge(): void {
    this.db.prepare('DELETE FROM hits WHERE at <= ?').run(this.now() - HOUR)
    this.db.prepare("DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at <= ?").run(this.now() - DAY)
  }
}
