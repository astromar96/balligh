// Real words for the contact-sheet passages (tests only): QF v4 words (text_qpc_hafs → display text, pause marks
// split off, verse tajweed projected), built on 2026-11-21 by passing each verse of the local research dump
// (research/fixtures/quran-text-api/all-verses.json, not committed; `key` → verse_key/verse_number) through
// data/quran.ts ayahFromQuranComVerse — provenance in __fixtures__/passages.json "source".
import type { Ayah } from '../../core/types'
import json from '../__fixtures__/passages.json'

export const PASSAGE_KEYS = ['1:1-7', '2:2-2', '2:10-10', '2:19-19', '2:255-255', '2:282-282', '4:43-43', '112:1-4', '36:52-52'] as const
export type PassageKey = (typeof PASSAGE_KEYS)[number]

const PASSAGES = json.passages as unknown as Record<PassageKey, Ayah[]>

/** A deep copy of the passage's ayahs (tests may change them). */
export function passage(key: PassageKey): Ayah[] {
  return PASSAGES[key].map((a) => ({ ...a, words: a.words.map((w) => ({ ...w, tajweed: w.tajweed.map((s) => ({ ...s })) })) }))
}

/** Every word of every passage, with its verse key. */
export function allPassageWords(): { key: string; word: Ayah['words'][number] }[] {
  return PASSAGE_KEYS.flatMap((k) => passage(k).flatMap((a) => a.words.map((w) => ({ key: `${a.key}:${w.position}`, word: w }))))
}
