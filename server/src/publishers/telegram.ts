// Telegram channel posts through the Bot API: the bot is an admin of the channel and sends the MP4 with sendVideo
// (multipart, caption ≤ 1024 characters, supports_streaming). Bots may send files up to 50 MB; there is no daily cap.
// A 429 answer says how long to wait (parameters.retry_after); one retry.
import { readFile } from 'node:fs/promises'
import { defaultSleep, type ClientDeps, type FetchFn } from './http'
import { PublishError, type Publisher, type PublishInput, type PublishResult } from './types'

interface TelegramAnswer {
  ok: boolean
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
  result?: { message_id: number; chat: { id: number; username?: string } }
}

export class TelegramPublisher implements Publisher {
  readonly platform = 'telegram' as const
  readonly plainMp4 = false
  private botToken: string
  private channel: string
  private f: FetchFn
  private sleep: NonNullable<ClientDeps['sleep']>

  /** channel: "@ShareQuran" or a numeric id ("-100…") */
  constructor(account: { botToken: string; channel: string }, deps: ClientDeps = {}) {
    this.botToken = account.botToken
    this.channel = account.channel
    this.f = deps.fetch ?? fetch
    this.sleep = deps.sleep ?? defaultSleep
  }

  async remaining(): Promise<number | null> {
    return null
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const bytes = await readFile(input.file)
    for (let attempt = 0; ; attempt++) {
      const form = new FormData()
      form.set('chat_id', this.channel)
      form.set('caption', input.caption.text)
      form.set('supports_streaming', 'true')
      form.set('duration', String(Math.round(input.durationMs / 1000)))
      form.set('width', String(input.width))
      form.set('height', String(input.height))
      form.set('video', new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), 'balligh.mp4')
      let answer: TelegramAnswer
      try {
        const res = await this.f(`https://api.telegram.org/bot${this.botToken}/sendVideo`, { method: 'POST', body: form, signal: input.signal })
        answer = (await res.json()) as TelegramAnswer
      } catch (error) {
        throw new PublishError('failed', `telegram: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (answer.ok && answer.result) return { link: this.link(answer.result) }
      const wait = answer.parameters?.retry_after
      if (answer.error_code === 429 && wait && wait <= 60 && attempt === 0) {
        await this.sleep(wait * 1000, input.signal)
        continue
      }
      const kind = answer.error_code === 401 || answer.error_code === 403 ? 'auth' : 'failed'
      throw new PublishError(kind, `telegram ${answer.error_code ?? '?'}: ${answer.description ?? 'error'}`)
    }
  }

  /** t.me/<channel>/<id> for a public channel, t.me/c/<id>/<message> for a private one */
  private link(msg: NonNullable<TelegramAnswer['result']>): string {
    const username = msg.chat.username ?? (this.channel.startsWith('@') ? this.channel.slice(1) : null)
    if (username) return `https://t.me/${username}/${msg.message_id}`
    return `https://t.me/c/${String(msg.chat.id).replace(/^-100/, '')}/${msg.message_id}`
  }
}
