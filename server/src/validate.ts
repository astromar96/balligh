// What a publish request may ask for. The client sends only a share link's query string: it is decoded with the
// app's own domain code, the aspect is forced to 9:16 (every platform's reel/short shape), and it is encoded back —
// that canonical form is what gets rendered and the key posts are deduplicated on.
import { checkInstagramUsername, checkPublisherName, decodeShareState, encodeShareState, PUBLISH_PLATFORMS } from '../../src/domain'
import type { PublisherCredit, PublishPlatform } from '../../src/domain'

const MAX_QUERY = 2000

export function canonicalQuery(query: unknown): string | null {
  if (typeof query !== 'string' || query.length === 0 || query.length > MAX_QUERY) return null
  let state: ReturnType<typeof decodeShareState>
  try {
    state = decodeShareState(query)
  } catch {
    return null
  }
  if (!state) return null
  return encodeShareState({ ...state, design: { ...state.design, aspect: '9:16' } })
}

export function parsePlatforms(value: unknown): PublishPlatform[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: PublishPlatform[] = []
  for (const v of value) {
    if (typeof v !== 'string' || !(PUBLISH_PLATFORMS as readonly string[]).includes(v)) return null
    if (!out.includes(v as PublishPlatform)) out.push(v as PublishPlatform)
  }
  return out
}

export type CreditError = 'name' | 'instagram'

export function parseCredit(name: unknown, instagram: unknown): { ok: true; credit: PublisherCredit } | { ok: false; error: CreditError; problem: string } {
  const n = checkPublisherName(typeof name === 'string' ? name : '')
  if (!n.ok) return { ok: false, error: 'name', problem: n.problem }
  const u = checkInstagramUsername(typeof instagram === 'string' ? instagram : '')
  if (!u.ok) return { ok: false, error: 'instagram', problem: u.problem }
  return { ok: true, credit: { name: n.name, instagram: u.username } }
}
