import { MAX_VIDEO_MS } from '../domain'
import {
  MAX_IMAGE_PAGES,
  SHARE_MAX_BYTES,
  SHARE_MAX_FILES,
  assertVideoLength,
  constrainedBaselineCodec,
  evenSize,
  fileNameFor,
  frameCount,
  videoBitrateFor,
  withinShareLimits,
} from './budget'
import { AudioSourceError } from './errors'
import { LruCache } from './lru'

describe('bitrates (media-pipeline §9.2: total ≤ 0.9 × 50 MiB × 8 / duration)', () => {
  it('uses 2.5 Mbps at 720×1280 and 4.5 Mbps at 1080×1920 for short clips', () => {
    expect(videoBitrateFor(720, 1280, 15)).toBe(2_500_000)
    expect(videoBitrateFor(1080, 1920, 60)).toBe(4_500_000)
    expect(videoBitrateFor(1280, 720, 30)).toBe(2_500_000)
  })

  it('caps long 1080p clips under the share limit (table: 4.07 Mbps at 90 s, 3.02 at 120 s)', () => {
    expect(videoBitrateFor(1080, 1920, 90) / 1e6).toBeCloseTo(4.07, 2)
    expect(videoBitrateFor(1080, 1920, 120) / 1e6).toBeCloseTo(3.02, 2)
    expect(videoBitrateFor(720, 1280, 120)).toBe(2_500_000)
    for (const d of [30, 90, 120, 300]) {
      const bytes = ((videoBitrateFor(1080, 1920, d) + 128_000) * d) / 8
      expect(bytes).toBeLessThanOrEqual(0.9 * SHARE_MAX_BYTES + 1)
    }
  })

  it('scales other sizes by pixel count with a floor', () => {
    expect(videoBitrateFor(720, 900, 30)).toBe(Math.round((2_500_000 * 720 * 900) / (720 * 1280)))
    expect(videoBitrateFor(320, 320, 30)).toBe(1_000_000)
    expect(videoBitrateFor(1080, 1920, 3600)).toBe(300_000)
  })
})

describe('frames and sizes', () => {
  it('covers the audio with ceil(duration × fps) frames, robust to float noise', () => {
    expect(frameCount(10, 30)).toBe(300)
    expect(frameCount(480_000 / 48_000, 30)).toBe(300)
    expect(frameCount(10.001, 30)).toBe(301)
    expect(frameCount(4.87, 30)).toBe(147)
    expect(frameCount(0, 30)).toBe(1)
  })

  it('keeps H.264 sizes even', () => {
    expect(evenSize(1080)).toBe(1080)
    expect(evenSize(1081)).toBe(1080)
    expect(evenSize(1)).toBe(2)
  })

  it('builds Constrained Baseline strings with the level for the size', () => {
    expect(constrainedBaselineCodec(720, 1280)).toBe('avc1.42401f')
    expect(constrainedBaselineCodec(1080, 1920)).toBe('avc1.424028')
    expect(constrainedBaselineCodec(2160, 3840)).toBe('avc1.424032')
  })
})

describe('file names', () => {
  it('keeps letters of any script, digits and dashes', () => {
    expect(fileNameFor('Al-Baqarah-255', 'mp4')).toBe('Al-Baqarah-255.mp4')
    expect(fileNameFor('Al Baqarah 255–257', 'mp4')).toBe('Al-Baqarah-255-257.mp4')
    expect(fileNameFor('البقرة ٢٥٥', 'png')).toBe('البقرة-٢٥٥.png')
  })

  it('strips path separators, reserved characters and control characters', () => {
    expect(fileNameFor('../../etc/passwd', 'mp4')).toBe('etc-passwd.mp4')
    expect(fileNameFor('a:b*c?"d<e>f|g\\h\u0007', 'mp4')).toBe('a-b-c-d-e-f-g-h.mp4')
    expect(fileNameFor('...hidden', 'png')).toBe('hidden.png')
  })

  it('falls back and caps the length', () => {
    expect(fileNameFor('', 'mp4')).toBe('balligh.mp4')
    expect(fileNameFor('***', 'png')).toBe('balligh.png')
    expect(fileNameFor('x'.repeat(200), 'mp4')).toBe(`${'x'.repeat(80)}.mp4`)
  })

  it('numbers the pages of one export after the cap, so no two pages share a name', () => {
    expect(fileNameFor('Al-Baqarah-255', 'png', 1)).toBe('Al-Baqarah-255-1.png')
    expect(fileNameFor('', 'png', 10)).toBe('balligh-10.png')
    expect(fileNameFor('x'.repeat(200), 'png', 3)).toBe(`${'x'.repeat(80)}-3.png`)
  })
})

describe('share limits (Chromium: 10 files, 50 MiB in total, allowlisted types)', () => {
  const file = (size: number, extension = 'png', mimeType = 'image/png') => ({ blob: { size }, extension, mimeType })

  it('accepts 1–10 allowlisted files up to 50 MiB in total', () => {
    expect(SHARE_MAX_FILES).toBe(10)
    expect(MAX_IMAGE_PAGES).toBe(SHARE_MAX_FILES)
    expect(withinShareLimits([file(1000)])).toBe(true)
    expect(withinShareLimits(Array.from({ length: 10 }, () => file(SHARE_MAX_BYTES / 10)))).toBe(true)
    expect(withinShareLimits([file(SHARE_MAX_BYTES, 'mp4', 'video/mp4')])).toBe(true)
  })

  it('refuses no files, 11 files, more than 50 MiB in total, or a type outside the allowlist', () => {
    expect(withinShareLimits([])).toBe(false)
    expect(withinShareLimits(Array.from({ length: 11 }, () => file(10)))).toBe(false)
    expect(withinShareLimits([file(SHARE_MAX_BYTES / 2), file(SHARE_MAX_BYTES / 2 + 1)])).toBe(false)
    expect(withinShareLimits([file(10, 'png', 'video/mp4')])).toBe(false)
    expect(withinShareLimits([file(10, 'exe', 'application/octet-stream')])).toBe(false)
  })
})

describe('video length cap (00-gaps D3)', () => {
  it('allows up to MAX_VIDEO_MS (300 s) and refuses longer audio with AudioSourceError "too-long"', () => {
    expect(MAX_VIDEO_MS).toBe(300_000)
    expect(() => assertVideoLength(300)).not.toThrow()
    expect(() => assertVideoLength(14_400_000 / 48_000)).not.toThrow() // exactly 300 s of samples
    expect(() => assertVideoLength(300.01)).toThrow(AudioSourceError)
    expect(() => assertVideoLength(Number.NaN)).toThrow(AudioSourceError)
    const caught = (() => {
      try {
        assertVideoLength(301)
      } catch (e) {
        return e
      }
      return null
    })()
    expect(caught).toMatchObject({ name: 'AudioSourceError', code: 'too-long', url: '', status: null })
  })
})

describe('LRU cache with a size budget', () => {
  it('evicts the least recently used entry by count', () => {
    const c = new LruCache<string, number>(2, Infinity, () => 1)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.get('a')).toBe(1) // a is now most recent
    c.set('c', 3)
    expect(c.has('b')).toBe(false)
    expect(c.has('a') && c.has('c')).toBe(true)
  })

  it('evicts by size but always keeps the newest entry', () => {
    const c = new LruCache<string, number>(10, 100, (v) => v)
    c.set('a', 40)
    c.set('b', 40)
    c.set('c', 40)
    expect(c.has('a')).toBe(false)
    expect(c.totalSize).toBe(80)
    c.set('huge', 500)
    expect(c.size).toBe(1)
    expect(c.get('huge')).toBe(500)
  })

  it('replaces an existing key without double counting', () => {
    const c = new LruCache<string, number>(10, 100, (v) => v)
    c.set('a', 30)
    c.set('a', 50)
    expect(c.totalSize).toBe(50)
    c.clear()
    expect(c.size).toBe(0)
  })

  it('drops entries older than maxAgeMs (decoded QF audio is never kept for long, even in memory)', () => {
    let now = 0
    const c = new LruCache<string, number>(10, 100, (v) => v, { maxAgeMs: 1000, now: () => now })
    c.set('a', 30)
    now = 1000
    expect(c.has('a')).toBe(true)
    expect(c.get('a')).toBe(30)
    now = 1001
    expect(c.has('a')).toBe(false)
    expect(c.get('a')).toBeUndefined()
    expect(c.size).toBe(0)
    expect(c.totalSize).toBe(0)
    c.set('a', 40) // set again: the age starts over
    now = 1500
    expect(c.get('a')).toBe(40)
  })
})
