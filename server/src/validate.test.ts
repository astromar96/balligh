import { describe, expect, it } from 'vitest'
import { buildCaption, creditLine, youtubeTitle, type CaptionParts } from './captions'
import { canonicalQuery, parseCredit, parsePlatforms } from './validate'

describe('canonicalQuery', () => {
  it('re-encodes a share link with the aspect forced to 9:16', () => {
    expect(canonicalQuery('v=1&s=1&a=1-3&r=alafasy')).toBe('v=1&s=1&a=1-3&r=alafasy')
    const wide = canonicalQuery('v=1&s=1&a=1-3&r=alafasy&ar=16:9')
    expect(wide).not.toContain('16')
    expect(canonicalQuery('s=1&a=3-1&r=alafasy&junk=1')).toBe(canonicalQuery('v=1&s=1&a=1-3&r=alafasy'))
  })

  it('refuses what is not a share link', () => {
    for (const bad of [undefined, 42, '', 'foo=1', 'v=2&s=1&a=1', 's=999&a=1', 'x'.repeat(2001)]) expect(canonicalQuery(bad)).toBeNull()
  })
})

describe('parsePlatforms', () => {
  it('keeps known platforms once, refuses anything else', () => {
    expect(parsePlatforms(['instagram', 'x', 'instagram'])).toEqual(['instagram', 'x'])
    expect(parsePlatforms([])).toBeNull()
    expect(parsePlatforms(['tiktok'])).toBeNull()
    expect(parsePlatforms('instagram')).toBeNull()
  })
})

describe('parseCredit', () => {
  it('checks the name and the Instagram username with the shared rules', () => {
    expect(parseCredit(' عمر ', '@Omar.K')).toEqual({ ok: true, credit: { name: 'عمر', instagram: 'omar.k' } })
    expect(parseCredit(undefined, undefined)).toEqual({ ok: true, credit: { name: null, instagram: null } })
    expect(parseCredit('see x.com', '')).toEqual({ ok: false, error: 'name', problem: 'characters' })
    expect(parseCredit('', 'bad name')).toEqual({ ok: false, error: 'instagram', problem: 'format' })
  })
})

const parts: CaptionParts = {
  words: '«بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ ۝١»',
  reference: '— الفاتحة ١',
  reciter: 'بصوت القارئ مشاري راشد العفاسي، رواية حفص عن عاصم',
  sources: 'المصادر: EveryAyah.com، Quran.com / Quran Foundation',
  link: 'https://sharequran.app/?v=1&s=1&a=1&r=alafasy',
}
const none = { name: null, instagram: null }
const opts = { supportUrl: 'https://ko-fi.com/balligh', reciterName: 'مشاري راشد العفاسي' }

describe('buildCaption', () => {
  it('puts every line on Instagram, with the credit and the support link', () => {
    const c = buildCaption('instagram', parts, { name: 'عمر', instagram: 'omar' }, opts)
    expect(c.text.split('\n')).toEqual([
      parts.words,
      parts.reference,
      parts.reciter,
      parts.sources,
      'نشرها: عمر',
      parts.link,
      'ادعم بلّغ: https://ko-fi.com/balligh',
      '#القرآن_الكريم #بلغوا_عني_ولو_آية',
    ])
  })

  it('gives X no URL and keeps it within 280 characters', () => {
    const c = buildCaption('x', { ...parts, words: `«${'كلمة '.repeat(80)}»` }, { name: 'عمر', instagram: null }, opts)
    expect(c.text).not.toMatch(/https?:|\.com/)
    expect([...c.text].length).toBeLessThanOrEqual(280)
    expect(c.text).toContain(parts.reference)
    expect(c.text).toContain('نشرها: عمر')
  })

  it('drops the hashtags, then the words, before anything needed on Threads', () => {
    const long = { ...parts, words: `«${'ٱلرَّحۡمَٰنِ '.repeat(40)}»` }
    const c = buildCaption('threads', long, { name: null, instagram: 'omar' }, opts)
    expect([...c.text].length).toBeLessThanOrEqual(500)
    expect(c.text).not.toContain('ٱلرَّحۡمَٰنِ ٱلرَّحۡمَٰنِ')
    expect(c.text).toContain('نشرها: @omar')
    expect(c.text).toContain(parts.link)
  })

  it('titles YouTube Shorts with the reference and the reciter', () => {
    const c = buildCaption('youtube', parts, none, opts)
    expect(c.title).toBe('الفاتحة ١ | مشاري راشد العفاسي #Shorts')
    expect(c.text).toContain('#Shorts')
    expect([...youtubeTitle({ ...parts, reference: `— ${'ا'.repeat(200)}` }, null)].length).toBeLessThanOrEqual(100)
  })
})

describe('creditLine', () => {
  it('mentions the Instagram username only on Threads', () => {
    expect(creditLine('threads', { name: 'عمر', instagram: 'omar' })).toBe('نشرها: عمر (@omar)')
    expect(creditLine('facebook', { name: 'عمر', instagram: 'omar' })).toBe('نشرها: عمر')
    expect(creditLine('facebook', { name: null, instagram: 'omar' })).toBe('')
    expect(creditLine('x', none)).toBe('')
  })
})
