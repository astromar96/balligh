// Structural facts of the Hafs Mushaf (not Quran Foundation content): ayah count per surah, 6,236 in total.
// Used to validate ranges without a network round trip.
export const VERSE_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73,
  54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
  28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4,
  5, 6,
]

export function versesIn(surah: number): number {
  return VERSE_COUNTS[surah - 1] ?? 0
}

/** Throws RangeError unless 1 ≤ surah ≤ 114 and 1 ≤ from ≤ to ≤ ayah count. */
export function checkRange(surah: number, from: number, to: number): void {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new RangeError(`surah must be 1..114, got ${surah}`)
  const n = versesIn(surah)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > n || from > to) {
    throw new RangeError(`ayah range ${surah}:${from}-${to} is outside 1..${n}`)
  }
}
