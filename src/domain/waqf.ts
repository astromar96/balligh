// Pause (waqf) marks of the Madinah Mushaf — research/features.md §2.3 (Tanzil pause-mark docs, King Fahd
// Complex glossary). Meanings follow the Mushaf's own key (مصطلحات الضبط).
import type { WaqfKind, Word } from '../core/types'
import type { WaqfInfo } from './index'

export const WAQF_TABLE: Record<WaqfKind, WaqfInfo> = {
  lazim: {
    kind: 'lazim',
    char: 'ۘ', // ۘ  مـ
    nameAr: 'وقف لازم',
    meaningAr: 'علامة الوقف اللازم: يلزم الوقف هنا، فالوصل يوهم معنًى غير المراد.',
    canStop: true,
  },
  mamnu: {
    kind: 'mamnu',
    char: 'ۙ', // ۙ  لا
    nameAr: 'وقف ممنوع',
    meaningAr: 'علامة الوقف الممنوع: لا يُوقف هنا، فالوقف يقطع الكلام قبل تمام معناه.',
    canStop: false,
  },
  jaiz: {
    kind: 'jaiz',
    char: 'ۚ', // ۚ  ج
    nameAr: 'وقف جائز',
    meaningAr: 'علامة الوقف الجائز جوازًا مستوي الطرفين: الوقف والوصل سواء.',
    canStop: true,
  },
  wasl_awla: {
    kind: 'wasl_awla',
    char: 'ۖ', // ۖ  صلى
    nameAr: 'الوصل أولى',
    meaningAr: 'علامة الوقف الجائز مع كون الوصل أولى.',
    canStop: true,
  },
  waqf_awla: {
    kind: 'waqf_awla',
    char: 'ۗ', // ۗ  قلى
    nameAr: 'الوقف أولى',
    meaningAr: 'علامة الوقف الجائز مع كون الوقف أولى.',
    canStop: true,
  },
  muanaqa: {
    kind: 'muanaqa',
    char: 'ۛ', // ۛ  ∴ ∴
    nameAr: 'وقف التعانق',
    meaningAr: 'علامة تعانق الوقف: إذا وُقف على أحد الموضعين لا يصح الوقف على الآخر.',
    canStop: true,
  },
  saktah: {
    kind: 'saktah',
    char: 'ۜ', // ۜ  س
    nameAr: 'سكتة',
    meaningAr: 'علامة السكت: سكتة يسيرة من غير تنفّس ثم تُتابَع القراءة، وليست موضع وقف.',
    canStop: false,
  },
}

const KIND_BY_CHAR = new Map<string, WaqfKind>(
  (Object.keys(WAQF_TABLE) as WaqfKind[]).map((kind) => [WAQF_TABLE[kind].char, kind]),
)

/** Whitespace and invisible format characters that may sit around a pause mark in the API text. */
const IGNORABLE = /[\s​-‏⁦-⁩﻿]/

/**
 * The pause mark at the END of `text` (a bare mark, or a word's text with the mark appended), ignoring
 * spaces and ZWNJ/ZWJ/LRM/RLM. The trailing mark decides because a word may carry two (36:52
 * «مَّرْقَدِنَا ۜ ۗ» = saktah then waqf_awla) and ۜ also occurs INSIDE words as a letter hint (2:245
 * «وَيَبْصُۜطُ»), which is not a pause.
 */
export function waqfKindOf(text: string): WaqfKind | null {
  if (typeof text !== 'string') return null
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i]
    if (IGNORABLE.test(c)) continue
    return KIND_BY_CHAR.get(c) ?? null
  }
  return null
}

/**
 * The word's pause kind for the boundary guard: `waqf` only — the Tanzil marks (00-gaps D1). Never `waqfChar`: that
 * is the QPC mark printed on screen, which differs on 353 words and has no ۙ at all (research/00-gaps.md §2.3).
 */
export function waqfOfWord(word: Word | undefined): WaqfKind | null {
  if (!word || typeof word.waqf !== 'string') return null
  return Object.prototype.hasOwnProperty.call(WAQF_TABLE, word.waqf) ? word.waqf : null
}

/** True when a phrase may end right after this word: its pause mark allows stopping (not ۙ, not ۜ). */
export function canStopAfter(word: Word | undefined): boolean {
  const kind = waqfOfWord(word)
  return kind !== null && WAQF_TABLE[kind].canStop
}
