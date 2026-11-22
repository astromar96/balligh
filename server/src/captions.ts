// Each platform's caption, from the render route's share text (words, reference, reciter, sources, link — the same
// lines the app's own share sheet sends) plus the publisher credit, the «ادعمنا» link and two hashtags. Lines are
// dropped, least needed first, until the text fits the platform. The reference, the reciter and the credit always
// stay; the sources may go because the video itself carries them burned in (QF credit: "in the video itself or its
// caption", 00-gaps §2.9). X gets no URL at all: a post with one costs 13× more.
import type { PublisherCredit, PublishPlatform } from '../../src/domain'

export interface CaptionParts {
  words: string
  reference: string
  reciter: string
  sources: string
  link: string
}

export interface Caption {
  text: string
  /** YouTube's video title */
  title?: string
}

/** characters (code points) each platform takes; YouTube counts 5000 UTF-8 bytes, and an Arabic letter or mark is 2 */
export const CAPTION_LIMITS: Record<PublishPlatform, number> = {
  instagram: 2200,
  facebook: 5000,
  threads: 500,
  telegram: 1024,
  youtube: 2400,
  x: 280,
}

const HASHTAGS = '#القرآن_الكريم #بلغوا_عني_ولو_آية'

const length = (s: string) => [...s].length

export function creditLine(platform: PublishPlatform, credit: PublisherCredit): string {
  // the username is an Instagram one: only Threads (same usernames) gets it as a mention; Instagram gets an invite
  const handle = platform === 'threads' && credit.instagram ? `@${credit.instagram}` : null
  if (credit.name && handle) return `نشرها: ${credit.name} (${handle})`
  if (credit.name) return `نشرها: ${credit.name}`
  if (handle) return `نشرها: ${handle}`
  return ''
}

export function buildCaption(
  platform: PublishPlatform,
  parts: CaptionParts,
  credit: PublisherCredit,
  opts: { supportUrl: string | null; reciterName: string | null },
): Caption {
  const x = platform === 'x'
  const lines: { text: string; drop: number }[] = [
    // drop order: 1 first … 0 never
    { text: parts.words, drop: 2 },
    { text: parts.reference, drop: 0 },
    { text: parts.reciter, drop: 0 },
    { text: x ? '' : parts.sources, drop: 4 },
    { text: creditLine(platform, credit), drop: 0 },
    { text: x ? '' : parts.link, drop: 5 },
    { text: !x && opts.supportUrl ? `ادعم بلّغ: ${opts.supportUrl}` : '', drop: 3 },
    { text: platform === 'youtube' ? `${HASHTAGS} #Shorts` : HASHTAGS, drop: 1 },
  ].filter((l) => l.text)
  const limit = CAPTION_LIMITS[platform]
  const joined = () => lines.map((l) => l.text).join('\n')
  for (let order = 1; order <= 5 && length(joined()) > limit; order++) {
    const i = lines.findIndex((l) => l.drop === order)
    if (i >= 0) lines.splice(i, 1)
  }
  let text = joined()
  if (length(text) > limit) text = [...text].slice(0, limit - 1).join('') + '…'
  const caption: Caption = { text }
  if (platform === 'youtube') caption.title = youtubeTitle(parts, opts.reciterName)
  return caption
}

/** "الفاتحة ١–٣ | مشاري راشد العفاسي #Shorts", at most 100 characters, without < or > (YouTube refuses them). */
export function youtubeTitle(parts: CaptionParts, reciterName: string | null): string {
  const reference = parts.reference.replace(/^—\s*/, '').replace(/[<>]/g, '')
  const tail = ' #Shorts'
  const withReciter = reciterName ? `${reference} | ${reciterName.replace(/[<>]/g, '')}${tail}` : `${reference}${tail}`
  if (length(withReciter) <= 100) return withReciter
  return [...`${reference}`].slice(0, 100 - length(tail)).join('') + tail
}
