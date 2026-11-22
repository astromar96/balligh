// Small in-memory LRU cache bounded by entry count, a size budget and (optionally) an age. Decoded PCM is big:
// 384 KB per stereo second at 48 kHz, so 40 long ayahs could otherwise pin a gigabyte. Memory only: nothing
// here is ever written to disk, IndexedDB, OPFS or Cache Storage, and it dies with the page. Pure; no DOM.

export interface LruOptions {
  /** entries older than this (ms since they were set) are dropped on access; default: no age limit */
  maxAgeMs?: number
  /** clock, for tests */
  now?: () => number
}

export class LruCache<K, V> {
  private readonly map = new Map<K, { value: V; size: number; at: number }>()
  private total = 0
  private readonly maxEntries: number
  private readonly maxSize: number
  private readonly sizeOf: (value: V) => number
  private readonly maxAgeMs: number
  private readonly now: () => number

  constructor(maxEntries: number, maxSize: number, sizeOf: (value: V) => number, options: LruOptions = {}) {
    this.maxEntries = maxEntries
    this.maxSize = maxSize
    this.sizeOf = sizeOf
    this.maxAgeMs = options.maxAgeMs ?? Infinity
    this.now = options.now ?? Date.now
  }

  get(key: K): V | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    this.map.delete(key)
    if (this.now() - hit.at > this.maxAgeMs) {
      this.total -= hit.size
      return undefined
    }
    this.map.set(key, hit)
    return hit.value
  }

  has(key: K): boolean {
    const hit = this.map.get(key)
    return hit !== undefined && this.now() - hit.at <= this.maxAgeMs
  }

  set(key: K, value: V): void {
    const old = this.map.get(key)
    if (old) {
      this.total -= old.size
      this.map.delete(key)
    }
    const size = this.sizeOf(value)
    this.map.set(key, { value, size, at: this.now() })
    this.total += size
    // evict least recently used, but never the entry just added
    for (const [k, v] of this.map) {
      if (this.map.size <= this.maxEntries && this.total <= this.maxSize) break
      if (k === key) continue
      this.map.delete(k)
      this.total -= v.size
    }
  }

  get size(): number {
    return this.map.size
  }

  get totalSize(): number {
    return this.total
  }

  clear(): void {
    this.map.clear()
    this.total = 0
  }
}
