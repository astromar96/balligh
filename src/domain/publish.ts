// Publishing to Balligh's own pages («Share Quran»): the platforms, what each accepts, and the publisher credit — the
// optional name and Instagram username a user adds to a post. Shared by the export sheet (checks as you type) and the
// publishing server (server/, which enforces them). Pure: no I/O.

export const PUBLISH_PLATFORMS = ['instagram', 'facebook', 'threads', 'telegram', 'youtube', 'x'] as const
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number]

export interface PlatformRules {
  /** longest clip the platform takes as a reel/short/video post */
  maxMs: number
  /** largest file; null = no limit below the app's own (50 MiB share cap, 300 s) */
  maxBytes: number | null
  /** posts per rolling 24 h on one account; null = no published cap */
  dailyPosts: number | null
}

/**
 * Live limits as of 2026-11 (Meta, Telegram, Google, X docs). Instagram: 50 API posts / 24 h, reels ≤ 15 min, 300 MB;
 * Facebook reels: 30 / 24 h and 3–90 s; Threads: 250 / 24 h, video ≤ 5 min, 1 GB; Telegram bots: 50 MB per file;
 * YouTube: 100 videos.insert calls a day per API project, Shorts ≤ 3 min; X: video ≤ 20 min for a standard account,
 * no post cap (each post is paid: the server's X_DAILY_MAX is Balligh's own limit).
 */
export const PLATFORM_RULES: Record<PublishPlatform, PlatformRules> = {
  instagram: { maxMs: 15 * 60_000, maxBytes: 300 * 1024 * 1024, dailyPosts: 50 },
  facebook: { maxMs: 90_000, maxBytes: 1024 * 1024 * 1024, dailyPosts: 30 },
  threads: { maxMs: 5 * 60_000, maxBytes: 1024 * 1024 * 1024, dailyPosts: 250 },
  telegram: { maxMs: 15 * 60_000, maxBytes: 50 * 1000 * 1000, dailyPosts: null },
  youtube: { maxMs: 180_000, maxBytes: null, dailyPosts: 100 },
  x: { maxMs: 20 * 60_000, maxBytes: 512 * 1024 * 1024, dailyPosts: null },
}

/** The platforms refuse clips shorter than this (Instagram, Facebook, YouTube: 3 s). */
export const MIN_PUBLISH_MS = 3000

/** Why a platform cannot take a clip of this length/size, or null when it can. */
export function platformRefusal(platform: PublishPlatform, durationMs: number, bytes?: number): 'too-short' | 'too-long' | 'too-big' | null {
  const r = PLATFORM_RULES[platform]
  if (durationMs < MIN_PUBLISH_MS) return 'too-short'
  if (durationMs > r.maxMs) return 'too-long'
  if (bytes !== undefined && r.maxBytes !== null && bytes > r.maxBytes) return 'too-big'
  return null
}

// ───────────────────────── publisher credit ─────────────────────────

export const MAX_NAME_LENGTH = 30

export type NameProblem = 'too-long' | 'too-short' | 'characters' | 'blocked'

/**
 * A name may hold Arabic or Latin letters (with their marks), spaces, hyphens and apostrophes — nothing else: no
 * digits, links, @handles, #tags or emoji. Tatweel (U+0640) is not a letter of either script, so it is refused too.
 */
const NAME_CHARS = /^(?:[\p{Script=Arabic}\p{Script=Latin}](?<=\p{L})|\p{M}|[ '’-])+$/u
const LETTER = /\p{L}/gu

/** Arabic letter variants folded, marks dropped, Latin lowercased: the form the blocklist is matched against. */
export function foldForMatch(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
}

/**
 * Words a name or username may not contain (matched as whole words after foldForMatch). Not exhaustive: it stops
 * the obvious insults and slurs, in Arabic and English, from going out under Balligh's name.
 */
const BLOCKED_WORDS = new Set(
  [
    // Arabic insults (folded spelling)
    'كلب', 'كلاب', 'حمار', 'حمير', 'خول', 'متناك', 'منيوك', 'منيك', 'شرموط', 'شرموطه', 'شراميط', 'عرص', 'معرص',
    'قحبه', 'قحاب', 'زاني', 'زانيه', 'لوطي', 'نيك', 'نياك', 'طيز', 'زب', 'زبي', 'كس', 'كسمك', 'كسختك', 'ابن الكلب',
    'وسخ', 'وسخه', 'حقير', 'حقيره', 'خنزير', 'خنازير', 'ملعون', 'ملعونه', 'كافر', 'كفار', 'زنديق', 'مرتد', 'داعش',
    'ديوث', 'يلعن', 'لعنه', 'تفو', 'سافل', 'سافله', 'واطي', 'غبي', 'اهبل', 'عبيط', 'بضان', 'منيوكه', 'لبوه',
    // English insults and slurs
    'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cock', 'cunt', 'pussy', 'whore',
    'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'kafir', 'kuffar', 'isis', 'porn', 'sex', 'nazi', 'hitler',
    'satan', 'devil', 'infidel',
  ].map(foldForMatch),
)

/** Whole names that would read as something other than a person: the brand itself, God, the Prophet, the Quran. */
const RESERVED_NAMES = new Set(
  [
    'بلغ', 'بلّغ', 'balligh', 'share quran', 'sharequran', 'شير قران', 'الاداره', 'اداره الصفحه', 'admin', 'الادمن',
    'الله', 'رب', 'ربك', 'ربنا', 'النبي', 'الرسول', 'رسول الله', 'محمد رسول الله', 'القران', 'قران', 'القران الكريم',
    'allah', 'god', 'the prophet', 'quran',
  ].map(foldForMatch),
)

function words(s: string): string[] {
  return foldForMatch(s)
    .split(/[\s'’\-._]+/u)
    .filter(Boolean)
}

/** true when a name or username holds a blocked word (or a blocked two-word phrase). */
export function hasBlockedWord(s: string): boolean {
  const ws = words(s)
  for (let i = 0; i < ws.length; i++) {
    if (BLOCKED_WORDS.has(ws[i])) return true
    if (i + 1 < ws.length && BLOCKED_WORDS.has(`${ws[i]} ${ws[i + 1]}`)) return true
  }
  return false
}

/** Trims, collapses runs of spaces and composes the name (NFC) — what is checked and what is printed. */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

/** The publisher's name: «نشرها: …» in the caption. Empty = no name (allowed). */
export function checkPublisherName(raw: string): { ok: true; name: string | null } | { ok: false; problem: NameProblem } {
  const name = normalizeName(raw)
  if (!name) return { ok: true, name: null }
  if ([...name].length > MAX_NAME_LENGTH) return { ok: false, problem: 'too-long' }
  if (!NAME_CHARS.test(name)) return { ok: false, problem: 'characters' }
  if ((name.match(LETTER) ?? []).length < 2) return { ok: false, problem: 'too-short' }
  if (hasBlockedWord(name) || RESERVED_NAMES.has(foldForMatch(name).replace(/[\s'’-]+/gu, ' '))) return { ok: false, problem: 'blocked' }
  return { ok: true, name }
}

export type UsernameProblem = 'format' | 'blocked'

/** Instagram's own rule: 1–30 of a–z 0–9 . _, no leading/trailing dot, no two dots in a row. */
const IG_USERNAME = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/

/**
 * The publisher's Instagram username, from what was typed: «@name», «name», or a pasted profile link
 * (instagram.com/name/?igsh=…). Empty = none (allowed). Lowercased, as Instagram treats it.
 */
export function checkInstagramUsername(raw: string): { ok: true; username: string | null } | { ok: false; problem: UsernameProblem } {
  let s = raw.trim()
  if (!s) return { ok: true, username: null }
  const link = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)/i)
  if (link) s = link[1]
  s = s.replace(/^@/, '').toLowerCase()
  if (!IG_USERNAME.test(s)) return { ok: false, problem: 'format' }
  if (hasBlockedWord(s)) return { ok: false, problem: 'blocked' }
  return { ok: true, username: s }
}

export interface PublisherCredit {
  name: string | null
  instagram: string | null
}
