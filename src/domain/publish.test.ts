import { checkInstagramUsername, checkPublisherName, hasBlockedWord, platformRefusal } from './index'

describe('checkPublisherName', () => {
  it('accepts Arabic and Latin names, with marks, hyphens and apostrophes', () => {
    expect(checkPublisherName('أحمد عبد الرحمن')).toEqual({ ok: true, name: 'أحمد عبد الرحمن' })
    expect(checkPublisherName('مُحَمَّد')).toEqual({ ok: true, name: 'مُحَمَّد' })
    expect(checkPublisherName("Sarah O'Neil-Hassan")).toEqual({ ok: true, name: "Sarah O'Neil-Hassan" })
    expect(checkPublisherName('Zoë')).toEqual({ ok: true, name: 'Zoë' })
  })

  it('trims and collapses spaces; empty means no name', () => {
    expect(checkPublisherName('   ')).toEqual({ ok: true, name: null })
    expect(checkPublisherName('  عمر    خالد ')).toEqual({ ok: true, name: 'عمر خالد' })
  })

  it('refuses digits, links, handles, tags, emoji and tatweel', () => {
    for (const bad of ['Omar 2', 'عمر ٢', 'see x.com', 'https://a.b', '@omar', '#quran', 'عمر 🌙', 'عمـــر', 'a/b', 'عمر، خالد']) {
      expect(checkPublisherName(bad)).toEqual({ ok: false, problem: 'characters' })
    }
  })

  it('refuses names past 30 characters or with fewer than two letters', () => {
    expect(checkPublisherName('ا'.repeat(31))).toEqual({ ok: false, problem: 'too-long' })
    expect(checkPublisherName('ا'.repeat(30)).ok).toBe(true)
    expect(checkPublisherName('a')).toEqual({ ok: false, problem: 'too-short' })
    expect(checkPublisherName("- '")).toEqual({ ok: false, problem: 'too-short' })
  })

  it('refuses insults as whole words, in any spelling variant, but not inside other words', () => {
    expect(checkPublisherName('ابن الكلب')).toEqual({ ok: false, problem: 'blocked' })
    expect(checkPublisherName('شرموطة')).toEqual({ ok: false, problem: 'blocked' })
    expect(checkPublisherName('FUCK you')).toEqual({ ok: false, problem: 'blocked' })
    expect(checkPublisherName('Sexton').ok).toBe(true)
    expect(checkPublisherName('كلبي').ok).toBe(true)
  })

  it('refuses names that read as the brand, God, the Prophet or the Quran', () => {
    for (const bad of ['بلّغ', 'Share Quran', 'الله', 'رسول الله', 'القرآن الكريم', 'Allah']) {
      expect(checkPublisherName(bad)).toEqual({ ok: false, problem: 'blocked' })
    }
    expect(checkPublisherName('عبد الله').ok).toBe(true)
  })
})

describe('checkInstagramUsername', () => {
  it('takes @name, name or a pasted profile link, lowercased', () => {
    expect(checkInstagramUsername('@Omar.K_1')).toEqual({ ok: true, username: 'omar.k_1' })
    expect(checkInstagramUsername('omar')).toEqual({ ok: true, username: 'omar' })
    expect(checkInstagramUsername('https://www.instagram.com/omar.k/?igsh=abc')).toEqual({ ok: true, username: 'omar.k' })
    expect(checkInstagramUsername('instagram.com/omar')).toEqual({ ok: true, username: 'omar' })
    expect(checkInstagramUsername('  ')).toEqual({ ok: true, username: null })
  })

  it("refuses what Instagram would not accept", () => {
    for (const bad of ['.omar', 'omar.', 'om..ar', 'omar khaled', 'عمر', 'a'.repeat(31), 'omar-k', '@']) {
      expect(checkInstagramUsername(bad)).toEqual({ ok: false, problem: 'format' })
    }
  })

  it('refuses usernames made of blocked words', () => {
    expect(checkInstagramUsername('fuck_you')).toEqual({ ok: false, problem: 'blocked' })
    expect(checkInstagramUsername('dickens')).toEqual({ ok: true, username: 'dickens' })
  })
})

describe('hasBlockedWord', () => {
  it('matches folded Arabic spellings', () => {
    expect(hasBlockedWord('قحبة')).toBe(true)
    expect(hasBlockedWord('عائشة')).toBe(false)
  })
})

describe('platformRefusal', () => {
  it('applies each platform’s length and size limits', () => {
    expect(platformRefusal('facebook', 90_000)).toBeNull()
    expect(platformRefusal('facebook', 90_001)).toBe('too-long')
    expect(platformRefusal('x', 141_000)).toBeNull()
    expect(platformRefusal('youtube', 181_000)).toBe('too-long')
    expect(platformRefusal('youtube', 179_000)).toBeNull()
    expect(platformRefusal('instagram', 2_900)).toBe('too-short')
    expect(platformRefusal('telegram', 60_000, 51_000_000)).toBe('too-big')
    expect(platformRefusal('telegram', 60_000, 49_000_000)).toBeNull()
  })
})
