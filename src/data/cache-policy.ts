// Cache policy per host (research/00-gaps.md §2.9, §6.1; QF Developer Terms): src/data/cache-policy.json is the
// single source, read here by data's HTTP cache and at build time by the service-worker build (PWA).
// Format: [{ match, kind, qf, maxAgeDays }], first match wins; `match` is an exact hostname or "*.suffix" (any
// subdomain of suffix, NOT the bare suffix — list that separately). kind: json = API responses, audio =
// recitation files (Range requests), font = font files, other = anything else (static JSON/text on CDNs).
// qf = Quran Foundation content: every QF host, the audio hosts included, is kept ≤ 6 days (the Terms say one
// week; purged at start-up) and never kept when its age cannot be told.
import POLICY_JSON from './cache-policy.json'

export interface CachePolicyEntry {
  /** exact hostname, or "*." + suffix for any subdomain of suffix */
  match: string
  kind: 'json' | 'audio' | 'font' | 'other'
  /** Quran Foundation content (QF Developer Terms apply) */
  qf: boolean
  /** never keep a cached copy longer than this */
  maxAgeDays: number
}

export const CACHE_POLICY: readonly CachePolicyEntry[] = POLICY_JSON as CachePolicyEntry[]

/** Hostname of an absolute http(s) URL, lower-cased; null otherwise. Regex, not URL: RN's URL lacks hostname. */
export function hostOf(url: string): string | null {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url)
  return m ? m[1].toLowerCase() : null
}

export function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // ".example.com"
    return host.length > suffix.length && host.endsWith(suffix)
  }
  return host === pattern
}

/** The policy entry for a URL, or null for hosts the policy does not list (e.g. the app's own origin). */
export function policyFor(url: string): CachePolicyEntry | null {
  const host = hostOf(url)
  if (!host) return null
  return CACHE_POLICY.find((e) => hostMatches(e.match, host)) ?? null
}
