// YouTube Shorts through the Data API (a refresh token of the channel owner, scope youtube.upload):
//   POST upload/youtube/v3/videos?uploadType=resumable&part=snippet,status (metadata) → Location
//   PUT  <Location> with the bytes → the video resource
// A vertical clip of 3 minutes or less is a Short; #Shorts is in the title and description too. 100 videos.insert
// calls a day per API project (counted from Balligh's own posts). An upload that comes back other than public counts
// as failed: the clip must not sit unseen on the channel while the user is told it is posted.
import { readFile } from 'node:fs/promises'
import type { Config } from '../config'
import type { Store } from '../store'
import { ApiError, requestJson, type ClientDeps, type FetchFn } from './http'
import { RefreshingToken } from './oauth'
import { PublishError, type Publisher, type PublishInput, type PublishResult } from './types'
import { PLATFORM_RULES } from '../../../src/domain'

const FULL_REASONS = ['quotaExceeded', 'uploadLimitExceeded', 'dailyLimitExceeded']

interface Video {
  id: string
  status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string; rejectionReason?: string }
}

function youtubeError(error: unknown): PublishError {
  if (error instanceof PublishError) return error
  if (error instanceof ApiError) {
    const reasons = ((error.body as { error?: { errors?: { reason?: string }[] } } | null)?.error?.errors ?? []).map((e) => e.reason ?? '')
    if (reasons.some((r) => FULL_REASONS.includes(r))) return new PublishError('full', error.message)
    if (error.status === 401 || reasons.includes('forbidden') || reasons.includes('insufficientPermissions')) return new PublishError('auth', error.message)
    return new PublishError('failed', `${error.status} ${reasons.join(',')}: ${error.message}`)
  }
  return new PublishError('failed', error instanceof Error ? error.message : String(error))
}

export class YouTubePublisher implements Publisher {
  readonly platform = 'youtube' as const
  readonly plainMp4 = false
  private token: RefreshingToken
  private postsLastDay: () => number
  private f: FetchFn

  constructor(account: NonNullable<Config['youtube']>, store: Store, postsLastDay: () => number, deps: ClientDeps = {}) {
    this.f = deps.fetch ?? fetch
    this.postsLastDay = postsLastDay
    this.token = new RefreshingToken(
      { tokenUrl: 'https://oauth2.googleapis.com/token', clientId: account.clientId, clientSecret: account.clientSecret, basicAuth: false },
      store,
      'youtube',
      account.refreshToken,
      this.f,
    )
  }

  async remaining(): Promise<number | null> {
    return Math.max(0, (PLATFORM_RULES.youtube.dailyPosts ?? 100) - this.postsLastDay())
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const bytes = await readFile(input.file)
      const access = await this.token.get(input.signal)
      const metadata = {
        snippet: {
          title: input.caption.title ?? 'بلّغ #Shorts',
          description: input.caption.text,
          categoryId: '22',
          defaultLanguage: 'ar',
          defaultAudioLanguage: 'ar',
          tags: ['قرآن', 'القرآن الكريم', 'تلاوة', 'Quran', 'Shorts'],
        },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true },
      }
      const start = await this.f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(bytes.length),
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(metadata),
        signal: input.signal,
      })
      const location = start.headers.get('location')
      if (!start.ok || !location) {
        const text = await start.text()
        let body: unknown = text
        try {
          body = JSON.parse(text)
        } catch {
          // not JSON
        }
        throw new ApiError(start.status, (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${start.status}`, null, null, body)
      }
      const video = await requestJson<Video>(this.f, location, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) },
        body: new Uint8Array(bytes),
        signal: input.signal,
      })
      const s = video.status ?? {}
      if (s.uploadStatus === 'failed' || s.uploadStatus === 'rejected') {
        throw new PublishError('failed', `youtube ${s.uploadStatus}: ${s.failureReason ?? s.rejectionReason ?? ''}`)
      }
      if (s.privacyStatus && s.privacyStatus !== 'public') throw new PublishError('failed', `youtube uploaded it as ${s.privacyStatus} (video ${video.id})`)
      return { link: `https://www.youtube.com/shorts/${video.id}` }
    } catch (error) {
      throw youtubeError(error)
    }
  }
}
