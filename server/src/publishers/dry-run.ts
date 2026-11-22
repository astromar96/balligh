// DRY_RUN=1: every platform "posts" by writing the MP4 and its caption to <data>/dry-run/ and answering with a fake
// link. The daily caps still apply (counted from the posts table), so the 'full' path can be tried locally.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLATFORM_RULES, type PublishPlatform } from '../../../src/domain'
import type { Store } from '../store'
import type { Publisher, PublishInput, PublishResult } from './types'

export class DryRunPublisher implements Publisher {
  readonly platform: PublishPlatform
  private dir: string
  private store: Store

  constructor(platform: PublishPlatform, dataDir: string, store: Store) {
    this.platform = platform
    this.dir = join(dataDir, 'dry-run')
    this.store = store
  }

  async remaining(): Promise<number | null> {
    const cap = PLATFORM_RULES[this.platform].dailyPosts
    return cap === null ? null : Math.max(0, cap - this.store.postsLastDay(this.platform))
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    mkdirSync(this.dir, { recursive: true })
    const mp4 = join(this.dir, `${input.jobId}.mp4`)
    if (!existsSync(mp4)) copyFileSync(input.file, mp4)
    const meta = { platform: this.platform, title: input.caption.title ?? null, credit: input.credit, bytes: input.bytes, durationMs: input.durationMs }
    writeFileSync(join(this.dir, `${input.jobId}-${this.platform}.txt`), `${input.caption.text}\n\n---\n${JSON.stringify(meta, null, 2)}\n`)
    return { link: `https://dry-run.invalid/${this.platform}/${input.jobId}` }
  }
}
