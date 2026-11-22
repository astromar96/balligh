// Reciter list for the picker, derived from the generated catalogue (reciters.catalog.ts) and the hand-kept
// voice table (reciters.voice.ts: whose voice the basmala/isti'adha files are — research/00-gaps.md §6.3).
import type { Reciter } from '../core/types'
import { RECITER_CATALOG, type ReciterCatalogEntry } from './reciters.catalog'
import { voiceOf } from './reciters.voice'

export const RECITER_LIST: Reciter[] = RECITER_CATALOG.map((e) => ({
  id: e.id,
  nameAr: e.nameAr,
  nameEn: e.nameEn,
  style: e.style,
  timingClass: e.timingClass,
  wordTimings: e.timingClass === 'A' || e.timingClass === 'B',
  sourceName: e.sourceName,
  // D7: only an isti'adha in the reciter's own voice is offered
  istiadha: voiceOf(e.id).istiadha === 'own' && e.everyayah !== null,
}))

const byId = new Map(RECITER_LIST.map((r) => [r.id, r]))
const entryById = new Map(RECITER_CATALOG.map((e) => [e.id, e]))

export function getReciterImpl(id: string): Reciter | undefined {
  return byId.get(id)
}

export function getCatalogEntry(id: string): ReciterCatalogEntry | undefined {
  return entryById.get(id)
}

/** {SSS}/{AAA} → 3-digit zero-padded surah/ayah. */
export function fillTemplate(template: string, surah: number, ayah = 0): string {
  const pad = (n: number) => String(n).padStart(3, '0')
  return template.replaceAll('{SSS}', pad(surah)).replaceAll('{AAA}', pad(ayah))
}

/** URL of a file in the reciter's EveryAyah folder (e.g. "audhubillah.mp3"), or null without a folder. */
export function everyAyahFile(entry: ReciterCatalogEntry, file: string): string | null {
  const ea = entry.everyayah
  if (!ea) return null
  const dir = ea.urlTemplate.slice(0, ea.urlTemplate.lastIndexOf('/') + 1)
  return `${dir}${file}`
}

/**
 * The reciter's own per-ayah file (EveryAyah) for an ayah, or null: no folder, or the file is another reciter's
 * recording (Tunaiji's 001001.mp3 is Minshawi's, 00-gaps §2.8). Where 001001.mp3 holds the isti'adha before the
 * basmala (Ali Jaber), 1:1 is his bismillah.mp3: the same reading of 1:1 (r = 0.98), without the isti'adha.
 */
export function everyAyahUrl(entry: ReciterCatalogEntry, surah: number, ayah: number): string | null {
  const ea = entry.everyayah
  if (!ea) return null
  if (surah === 1 && ayah === 1) {
    const voice = voiceOf(entry.id)
    if (voice.foreign001001) return null
    if (voice.basmala === 'bismillah.mp3') return everyAyahFile(entry, 'bismillah.mp3')
  }
  return fillTemplate(ea.urlTemplate, surah, ayah)
}
