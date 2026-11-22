// App state (zustand). Holds what the user chose; compose.ts derives everything that has to be
// fetched, decoded or drawn from it.
import { create } from 'zustand'
import type { Ayah, DesignOptions, Selection, Surah, WordRef } from '../core/types'
import * as data from '../data'
import * as domain from '../domain'
import type { ShareState } from '../domain'
import type { Language } from './i18n'
import { isAbortError } from './safe'
import { applyTap, stepWord, type TapTarget } from './selection'
import { applySelectionFix, type SelectionFix } from './warnings'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SelectionMode = 'words' | 'ayahs'
export type ExportQuality = 'hd' | 'fullhd'

/** The design a new clip starts with (domain.DEFAULT_DESIGN, which share links are measured against). */
export function defaultDesign(): DesignOptions {
  const d = domain.DEFAULT_DESIGN
  return { ...d, background: { ...d.background } }
}

export function defaultReciterId(): string {
  return data.DEFAULT_RECITER_ID
}

export function defaultTafsirId(): string {
  return data.DEFAULT_TAFSIR_ID
}

/** Saheeh International (Quran.com id 20), else the first English translation — used when the user turns translation on. */
export function defaultTranslationId(): number {
  const list = data.TRANSLATIONS
  return list.find((t) => t.id === 20)?.id ?? list.find((t) => t.lang === 'en')?.id ?? list[0]?.id ?? 20
}

/** Asks the Mushaf panel to bring a word into view: 'top' for jumps, 'nearest' for the keyboard cursor. */
export interface ScrollRequest {
  ayah: number
  /** defaults to the ayah's first word */
  word?: number
  align?: 'top' | 'nearest'
  /** changes on every request, so asking twice for the same place still scrolls */
  seq: number
}

export interface AppState {
  language: Language
  surahs: Surah[] | null
  surahsStatus: LoadStatus
  surahsError: unknown
  /** current surah number */
  surah: number
  ayahs: Ayah[] | null
  ayahsStatus: LoadStatus
  ayahsError: unknown
  selection: Selection | null
  /** the first tap while the end is still open */
  pending: Selection | null
  /** keyboard cursor in the Mushaf panel (web) */
  cursor: WordRef | null
  selectionMode: SelectionMode
  snapToPauses: boolean
  reciterId: string
  /**
   * the user wants the clip to open with the isti'adha (default off). It only plays for reciters who recorded it in
   * their own voice (Reciter.istiadha, D7); the choice is kept when switching to a reciter without one.
   */
  istiadha: boolean
  /** null = tafsir off */
  tafsirId: string | null
  lastTafsirId: string
  /** null = translation off */
  translationId: number | null
  lastTranslationId: number
  design: DesignOptions
  exportQuality: ExportQuality
  /** asks the Mushaf panel to bring an ayah into view (seq changes every request) */
  scrollRequest: ScrollRequest | null

  setLanguage(lang: Language): void
  loadSurahs(): void
  openSurah(n: number, opts?: { selection?: Selection | null; scrollTo?: number }): void
  retryAyahs(): void
  tap(target: TapTarget): void
  setRange(fromAyah: number, toAyah: number): void
  setSelection(sel: Selection | null): void
  setSelectionMode(mode: SelectionMode): void
  setSnapToPauses(on: boolean): void
  /** a one-tap fix from a selection warning (warnings.ts) */
  applyFix(fix: SelectionFix): void
  moveCursor(delta: 1 | -1, extend: boolean): void
  setCursor(ref: WordRef | null): void
  setReciter(id: string): void
  setIstiadha(on: boolean): void
  setTafsir(id: string | null): void
  setTranslation(id: number | null): void
  setDesign(patch: Partial<DesignOptions>): void
  setExportQuality(q: ExportQuality): void
  applyShareState(state: ShareState): void
  shareState(): ShareState | null
}

let ayahsController: AbortController | null = null
let surahsController: AbortController | null = null
let scrollSeq = 0

export const useAppStore = create<AppState>()((set, get) => ({
  language: 'ar',
  surahs: null,
  surahsStatus: 'idle',
  surahsError: null,
  surah: 1,
  ayahs: null,
  ayahsStatus: 'idle',
  ayahsError: null,
  selection: null,
  pending: null,
  cursor: null,
  selectionMode: 'words',
  snapToPauses: true,
  reciterId: defaultReciterId(),
  istiadha: false,
  tafsirId: null,
  lastTafsirId: defaultTafsirId(),
  translationId: null,
  lastTranslationId: defaultTranslationId(),
  design: defaultDesign(),
  exportQuality: 'hd',
  scrollRequest: null,

  setLanguage: (language) => set({ language }),

  loadSurahs: () => {
    if (get().surahsStatus === 'loading' || get().surahsStatus === 'ready') return
    surahsController?.abort()
    const ctrl = new AbortController()
    surahsController = ctrl
    set({ surahsStatus: 'loading', surahsError: null })
    Promise.resolve()
      .then(() => data.fetchSurahs(ctrl.signal))
      .then(
        (surahs) => {
          if (ctrl.signal.aborted) return
          set({ surahs, surahsStatus: 'ready' })
        },
        (error) => {
          if (ctrl.signal.aborted || isAbortError(error)) return
          set({ surahsStatus: 'error', surahsError: error })
        },
      )
  },

  openSurah: (n, opts) => {
    ayahsController?.abort()
    const ctrl = new AbortController()
    ayahsController = ctrl
    set({
      surah: n,
      ayahs: null,
      ayahsStatus: 'loading',
      ayahsError: null,
      selection: null,
      pending: null,
      cursor: null,
    })
    Promise.resolve()
      .then(() => data.fetchAyahs(n, ctrl.signal))
      .then(
        (ayahs) => {
          if (ctrl.signal.aborted) return
          let selection: Selection | null
          if (opts?.selection === null) selection = null
          else if (opts?.selection) selection = domain.clampSelection(opts.selection, ayahs)
          else if (n === 1) selection = domain.ayahRangeSelection(1, 1, ayahs.length, ayahs)
          else selection = domain.ayahRangeSelection(n, 1, 1, ayahs)
          if (selection && get().selectionMode === 'ayahs') selection = domain.expandToAyahs(selection, ayahs)
          const scrollAyah = opts?.scrollTo ?? selection?.start.ayah ?? 1
          set({
            ayahs,
            ayahsStatus: 'ready',
            selection,
            scrollRequest: scrollAyah > 1 ? { ayah: scrollAyah, seq: ++scrollSeq } : null,
          })
        },
        (error) => {
          if (ctrl.signal.aborted || isAbortError(error)) return
          set({ ayahsStatus: 'error', ayahsError: error })
        },
      )
  },

  retryAyahs: () => {
    const { surah, selection } = get()
    get().openSurah(surah, { selection })
  },

  tap: (target) => {
    const { ayahs, surah, selectionMode, snapToPauses, selection, pending } = get()
    if (!ayahs) return
    const next = applyTap({ selection, pending }, target, {
      surah,
      ayahs,
      mode: selectionMode,
      snap: snapToPauses,
      expandToAyahs: (s) => domain.expandToAyahs(s, ayahs),
      snapToPauses: (s) => domain.snapToPauses(s, ayahs),
    })
    const cursor = target.kind === 'word' ? target.ref : { ayah: target.ayah, word: next.selection?.start.word ?? 1 }
    set({ selection: next.selection, pending: next.pending, cursor })
  },

  setRange: (fromAyah, toAyah) => {
    const { ayahs, surah } = get()
    if (!ayahs) return
    set({
      selection: domain.ayahRangeSelection(surah, fromAyah, toAyah, ayahs),
      pending: null,
      scrollRequest: { ayah: Math.min(fromAyah, toAyah), seq: ++scrollSeq },
    })
  },

  setSelection: (selection) => set({ selection, pending: null }),

  setSelectionMode: (selectionMode) => {
    const { ayahs, selection } = get()
    if (selectionMode === 'ayahs' && ayahs && selection) set({ selectionMode, selection: domain.expandToAyahs(selection, ayahs), pending: null })
    else set({ selectionMode })
  },

  setSnapToPauses: (on) => {
    const { ayahs, selection, pending, selectionMode } = get()
    if (on && ayahs && selection && !pending && selectionMode === 'words') set({ snapToPauses: on, selection: domain.snapToPauses(selection, ayahs) })
    else set({ snapToPauses: on })
  },

  applyFix: (fix) => {
    const { ayahs, selection } = get()
    if (!ayahs || !selection) return
    const next = applySelectionFix(selection, fix, ayahs)
    // a fix that reaches into the next ayah keeps the new end in view
    const moved = next.end.ayah !== domain.normalizeSelection(selection).end.ayah
    set({
      selection: next,
      pending: null,
      ...(moved ? { scrollRequest: { ayah: next.end.ayah, word: next.end.word, align: 'nearest' as const, seq: ++scrollSeq } } : {}),
    })
  },

  moveCursor: (delta, extend) => {
    const { ayahs, cursor, selection, surah } = get()
    if (!ayahs || ayahs.length === 0) return
    // the first key press only shows the cursor: at the selection's start (or its end when extending)
    const from = cursor ?? (extend ? selection?.end : selection?.start) ?? { ayah: ayahs[0].number, word: ayahs[0].words[0]?.position ?? 1 }
    const next = cursor ? stepWord(ayahs, from, delta) : from
    if (extend) {
      const anchor = selection ? selection.start : next
      set({
        cursor: next,
        selection: domain.normalizeSelection({ surah, start: anchor, end: next }),
        pending: null,
        scrollRequest: { ayah: next.ayah, word: next.word, align: 'nearest', seq: ++scrollSeq },
      })
    } else {
      set({ cursor: next, scrollRequest: { ayah: next.ayah, word: next.word, align: 'nearest', seq: ++scrollSeq } })
    }
  },

  setCursor: (cursor) => set({ cursor }),

  setReciter: (reciterId) => set({ reciterId }),

  setIstiadha: (istiadha) => set({ istiadha }),

  setTafsir: (id) => {
    const design = get().design
    if (id === null) set({ tafsirId: null, design: { ...design, showTafsir: false } })
    else set({ tafsirId: id, lastTafsirId: id, design: { ...design, showTafsir: true } })
  },

  setTranslation: (id) => {
    const design = get().design
    if (id === null) set({ translationId: null, design: { ...design, showTranslation: false } })
    else set({ translationId: id, lastTranslationId: id, design: { ...design, showTranslation: true } })
  },

  setDesign: (patch) => set({ design: { ...get().design, ...patch } }),

  setExportQuality: (exportQuality) => set({ exportQuality }),

  applyShareState: (state) => {
    const base = defaultDesign()
    const design: DesignOptions = { ...base, ...state.design }
    if (design.background.kind === 'image') design.background = base.background
    set({
      reciterId: state.reciterId || defaultReciterId(),
      istiadha: state.istiadha === true,
      tafsirId: state.tafsirId,
      lastTafsirId: state.tafsirId ?? get().lastTafsirId,
      translationId: state.translationId,
      lastTranslationId: state.translationId ?? get().lastTranslationId,
      design: { ...design, showTafsir: state.tafsirId !== null, showTranslation: state.translationId !== null },
    })
    get().openSurah(state.selection.surah, { selection: state.selection })
  },

  shareState: () => {
    const { selection, reciterId, istiadha, tafsirId, translationId, design } = get()
    if (!selection) return null
    const base = defaultDesign()
    const diff: Partial<DesignOptions> = {}
    for (const key of Object.keys(design) as (keyof DesignOptions)[]) {
      if (key === 'background') {
        // an uploaded photo never travels in a link (research/features.md §3.6)
        if (design.background.kind === 'preset' && JSON.stringify(design.background) !== JSON.stringify(base.background)) diff.background = design.background
        continue
      }
      if (key === 'showTafsir' || key === 'showTranslation') continue
      if (design[key] !== base[key]) (diff as Record<string, unknown>)[key] = design[key]
    }
    // the link opens the clip as it sounds: with the isti'adha only when this reciter has one
    const state: ShareState = { selection, reciterId, tafsirId, translationId, design: diff }
    if (istiadha && data.getReciter(reciterId)?.istiadha) state.istiadha = true
    return state
  },
}))

/** The current Surah object, when the list has loaded. */
export function currentSurah(state: Pick<AppState, 'surahs' | 'surah'>): Surah | null {
  return state.surahs?.find((s) => s.number === state.surah) ?? null
}
