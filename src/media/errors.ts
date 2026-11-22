// Platform-neutral media errors (web today, native later). AudioSourceError.code lets the UI choose its
// Arabic message without parsing English text.

export type AudioSourceErrorCode =
  | 'http'
  | 'network'
  | 'timeout'
  | 'vbr'
  | 'no-sync'
  | 'decode'
  | 'range-ignored'
  | 'too-long'
  | 'empty'

/** Why an audio source could not be used. `code` lets the UI pick its Arabic message. */
export class AudioSourceError extends Error {
  readonly code: AudioSourceErrorCode
  readonly url: string
  /** HTTP status for code 'http' */
  readonly status: number | null
  constructor(code: AudioSourceErrorCode, url: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'AudioSourceError'
    this.code = code
    this.url = url
    this.status = status
  }
}
