// One interface for every platform: how many posts are left today, and post one clip.
import type { PublisherCredit, PublishPlatform } from '../../../src/domain'
import type { Caption } from '../captions'

export interface PublishInput {
  jobId: string
  /** the rendered MP4 on disk (without edit lists for a publisher with plainMp4) */
  file: string
  bytes: number
  durationMs: number
  width: number
  height: number
  caption: Caption
  credit: PublisherCredit
  /** a public, one-time address of the MP4 while the job runs (for platforms that fetch it, e.g. Threads) */
  mediaUrl: string
  signal: AbortSignal
}

export interface PublishResult {
  /** the post's public address */
  link: string
  /** the Instagram collaborator invite could not be sent; the reel went up without it */
  note?: 'invite-failed'
}

export interface Publisher {
  readonly platform: PublishPlatform
  /** the platform's spec forbids MP4 edit lists: it gets the copy without them (mp4.stripEditLists) */
  readonly plainMp4?: boolean
  /** posts left in the rolling 24 h; null when the platform has no known cap */
  remaining(): Promise<number | null>
  publish(input: PublishInput): Promise<PublishResult>
}

export type PublishErrorKind =
  /** the platform's daily limit is reached */
  | 'full'
  /** the token was refused: needs Omar */
  | 'auth'
  | 'failed'

export class PublishError extends Error {
  readonly kind: PublishErrorKind
  constructor(kind: PublishErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}
