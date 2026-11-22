// domain/ — pure logic, no I/O, no DOM. Owner: domain agent. Fully unit-tested.
// Public contract below; implementations live in the sibling files.
import type {
  AudioPlan,
  Ayah,
  AyahAudio,
  ClipResult,
  DesignOptions,
  Reciter,
  Selection,
  Surah,
  TajweedRuleId,
  Timeline,
  WaqfKind,
  WordRef,
} from '../core/types'
import * as arabic from './arabic'
import * as audioPlan from './audio-plan'
import * as selection from './selection'
import * as share from './share'
import * as tajweed from './tajweed'
import * as timeline from './timeline'
import * as waqf from './waqf'

// ── Selection ──

/**
 * A WordRef.word at or above this means "the last word of that ayah" where the word count is not known yet
 * (a decoded share link `a=255-257`, or ayahs not loaded). Every function here treats it that way;
 * clampSelection() replaces it with the real position once the ayahs are loaded.
 */
export const AYAH_END_WORD = selection.AYAH_END_WORD

/** <0 when a precedes b in reading order, 0 when equal, >0 otherwise. */
export function compareRefs(a: WordRef, b: WordRef): number {
  return selection.compareRefs(a, b)
}

/** Orders start/end so start <= end. */
export function normalizeSelection(sel: Selection): Selection {
  return selection.normalizeSelection(sel)
}

/**
 * Orders the selection, keeps its ayahs inside the surah and its words inside their ayahs, and resolves
 * AYAH_END_WORD to the real last word. Call it on a decoded share link once the surah's ayahs are loaded.
 */
export function clampSelection(sel: Selection, ayahs: Ayah[]): Selection {
  return selection.clampSelection(sel, ayahs)
}

/** Whole ayahs fromAyah..toAyah (clamped to the surah). The end word is AYAH_END_WORD when that ayah is not in `ayahs`. */
export function ayahRangeSelection(surah: number, fromAyah: number, toAyah: number, ayahs: Ayah[]): Selection {
  return selection.ayahRangeSelection(surah, fromAyah, toAyah, ayahs)
}

export function isWordSelected(sel: Selection | null, ref: WordRef): boolean {
  return selection.isWordSelected(sel, ref)
}

/** Selected ayahs, each trimmed to the selected words (positions keep their original numbers). */
export function trimToSelection(sel: Selection, ayahs: Ayah[]): { ayahs: Ayah[]; partialStart: boolean; partialEnd: boolean } {
  return selection.trimToSelection(sel, ayahs)
}

export function selectedWordCount(sel: Selection, ayahs: Ayah[]): number {
  return selection.selectedWordCount(sel, ayahs)
}

/** Grows a word selection to whole ayahs. */
export function expandToAyahs(sel: Selection, ayahs: Ayah[]): Selection {
  return selection.expandToAyahs(sel, ayahs)
}

/**
 * Moves the start back to the beginning of its phrase (just after the previous pause
 * mark where stopping is allowed, or the ayah start) and the end forward to the next
 * such pause mark or the ayah end. Never crosses a 'mamnu' (ۙ) mark as a boundary.
 * Stopping is allowed on ۘ ۚ ۖ ۗ ۛ; never on ۙ (mamnu) or ۜ (saktah); and never on both marks of a ۛ pair (a start
 * right after one mark moves the end past the other). Reads Word.waqf (Tanzil marks, 00-gaps D1), never waqfChar.
 * Stays inside the start and end ayahs (the 'ends-curated' / 'next-starts-with-illa' fixes are their extendTo).
 */
export function snapToPauses(sel: Selection, ayahs: Ayah[]): Selection {
  return selection.snapToPauses(sel, ayahs)
}

/**
 * The boundary guard of research/features.md §2.3 (prototype research/scripts/features/boundary_check.py). It reads
 * Word.waqf (the Tanzil marks, 00-gaps D1), never Word.waqfChar, and compares text only after normalizeForSearch, so
 * the display encoding (QPC or Tanzil) never changes a result. Positions are where the problem is; wording is the UI's
 * (never point at a glyph: QPC prints no ۙ — «الوقف هنا ممنوع», not "this mark").
 * In features §2.3 terms 'ends-on-mamnu', 'ends-curated' and 'starts-after-speech-verb' are "strong" (the cut can invert
 * the meaning), the other warnings "warn", and 'pause-hint' "info".
 */
export type SelectionWarning =
  /** start is inside an ayah and not right after a pause mark where stopping is allowed */
  | { kind: 'starts-mid-phrase'; at: WordRef }
  /**
   * start is inside a quotation: a speech verb (قال، قالوا، قالت، يقولون، قيل … with و/ف) occurs since the last allowed
   * stop, so the clip would present quoted words as a statement (5:64 «وَقَالَتِ ٱلْيَهُودُ يَدُ ٱللَّهِ …» from «يَدُ»).
   * Replaces 'starts-mid-phrase'. `verb` = the speech verb nearest the start; snapToPauses() moves the start back to
   * the phrase start, which includes the verb (5:73 w5 → w1, before «قَالُوٓا۟» at w4).
   */
  | { kind: 'starts-after-speech-verb'; at: WordRef; verb: WordRef }
  /** end is inside an ayah and not on a pause mark where stopping is allowed */
  | { kind: 'ends-mid-phrase'; at: WordRef }
  /** the last word carries ۙ (Tanzil «لا»: do not stop here). The QPC text prints no ۙ at all (0 of the 68). */
  | { kind: 'ends-on-mamnu'; at: WordRef }
  /**
   * ends on a whole ayah that must not close a clip (CURATED_END, features §2.3: 107:4 «فَوَيْلٌ لِّلْمُصَلِّينَ»).
   * `extendTo` = the end of the first complete phrase of the next ayah (AYAH_END_WORD when that ayah is not loaded).
   */
  | { kind: 'ends-curated'; at: WordRef; extendTo: WordRef }
  /**
   * ends on a whole ayah whose next ayah starts with the exception «إِلَّا», which qualifies it (103:2 → 103:3;
   * 54 places). `extendTo` as for 'ends-curated'.
   */
  | { kind: 'next-starts-with-illa'; at: WordRef; extendTo: WordRef }
  /**
   * info: ends on ۖ (stopping allowed, continuing better) or on one mark of a ۛ pair (stop at one of the two, not
   * both). `bothStops`: the selection also starts right after the other mark of that pair, i.e. it stops at both —
   * the one case warningSeverity() rates 'warning'; snapToPauses() then extends the end past the pair.
   */
  | { kind: 'pause-hint'; at: WordRef; mark: 'wasl_awla' | 'muanaqa'; bothStops: boolean }
  /** very long selection: suggest splitting (count = words) */
  | { kind: 'long'; count: number }

/**
 * Gentle integrity hints shown under the selection (never a block); meaning can change when a verse is cut mid-phrase.
 * At most one start warning, then at most one end warning ('ends-on-mamnu' / 'ends-mid-phrase' / 'pause-hint' inside
 * an ayah; 'ends-curated' before 'next-starts-with-illa' at an ayah end), then 'long' (> 120 words). The illa check
 * needs the next ayah in `ayahs`: pass the whole surah.
 */
export function selectionWarnings(sel: Selection, ayahs: Ayah[]): SelectionWarning[] {
  return selection.selectionWarnings(sel, ayahs)
}

/** 'info' for 'pause-hint' (unless it stops at both marks of a ۛ pair), 'warning' for everything else. */
export function warningSeverity(w: SelectionWarning): 'warning' | 'info' {
  return selection.warningSeverity(w)
}

/**
 * Arabic (default): "البقرة ٢٥٥", "البقرة ٢٥٥–٢٥٧", "البقرة ٢٥٥ (الكلمات ١–٧)", "البقرة ٢٥٥ (الكلمة ٣)",
 * "البقرة ٢٥٥ (من الكلمة ٣)", "البقرة ٢٥٥–٢٥٧ (من الكلمة ٣ إلى الكلمة ٥)".
 * English: "Al-Baqarah 255", "Al-Baqarah 255–257", "Al-Baqarah 255 (words 1–7)", "Al-Baqarah 255 (word 3)",
 * "Al-Baqarah 255 (from word 3)", "Al-Baqarah 255–257 (from word 3 to word 5)". Without a name: «سورة ٢» / "Surah 2".
 */
export function describeSelection(sel: Selection, surah: Surah | null, ayahs: Ayah[], lang: 'ar' | 'en' = 'ar'): string {
  return selection.describeSelection(sel, surah, ayahs, lang)
}

// ── Audio plan & timeline ──

export interface PlanOptions {
  /** basmala audio to prepend when the selection starts at ayah 1 word 1 (surah ≠ 1, 9); null to skip */
  basmala: AyahAudio | null
  /**
   * prepend the isti'adha: when true and `audio` holds an AyahAudio with ayah -1 (the reciter's own recording, e.g.
   * EveryAyah's audhubillah.mp3; only for Reciter.istiadha reciters, 00-gaps D7), its clip opens the plan, before the basmala.
   * Any surah and any start (it is said before every recitation, research/features.md §2.4), surah 9 included.
   */
  istiadha?: boolean
  /** audio kept before the first word when it follows a pause (default 120 ms; never includes the previous word) */
  leadPadMs?: number
  /** reverb kept after an ayah's last word (default 350 ms) */
  tailPadMs?: number
}

/**
 * Turns a selection into ordered clips — research/audio-timing.md §8 "Planner" exactly:
 * per ayah, pick the clean occurrence of the selected words (reciters sometimes repeat), pad/fade per
 * the rules there, merge consecutive cuts of the same chapter file when the gap < 4 s, prepend the
 * basmala when asked (and the isti'adha before it, PlanOptions.istiadha). Classes C/D (no word timings) widen a
 * partial selection to whole ayahs (plan.playedSelection, plan.exact = false). Never throws on imperfect timing data.
 * Also widened: an ayah whose timings are all estimated, or stale (a word past its known window — finding A).
 * Per-ayah clip ends are not clamped to the file (its length is unknown here): the media module clamps to
 * the decoded duration. Ayahs missing from `audio` are skipped (exact = false); entries with ayah ≤ 0 are never
 * played as ayahs (0 = basmala source, -1 = isti'adha source).
 * A cut that opens an ayah at word 1 from a word timing sets extendToSpeechOnset (finding B; per-ayah and
 * chapter files), and its clip's first `ayahs` entry then starts at the ayah's window start when that is
 * earlier than the cut: the media searches back to it for speech before a late first segment, never into
 * the previous ayah. Every later entry starts inside the clip; consumers clip ayah windows to the clip.
 * A whole per-ayah file played without word timings (class C, an ayah whose timing is 'none', an ayah-level
 * fallback, a class C basmala, the isti'adha) sets trimSilence; every other clip leaves it false.
 */
export function planAudio(sel: Selection, ayahs: Ayah[], audio: AyahAudio[], reciter: Reciter, opts: PlanOptions): AudioPlan {
  return audioPlan.planAudio(sel, ayahs, audio, reciter, opts)
}

/** Hard cap on a video's audio (00-gaps D3): memory (384 KB/s of PCM, export peak 2–3× the file) and the 50 MiB share cap. */
export const MAX_VIDEO_MS = 300_000

/**
 * What the plan will last before any audio is fetched (00-gaps D3): the sum of its clip windows. null when a clip's
 * length is unknown (a whole per-ayah file: srcEndMs null — classes C and the ayah-level fallbacks), 0 for no clips.
 * An estimate: per-ayah tail pads may run past the file end, and onset extension / pause snapping move edges a little.
 */
export function estimatePlanDurationMs(plan: AudioPlan): number | null {
  return audioPlan.estimatePlanDurationMs(plan)
}

/**
 * Output-time schedule once the clips are decoded: results[i] is what media/assembleAudio produced
 * for plan.clips[i] (actual source start after pause-snapping, and duration). Word and ayah windows
 * are shifted from file time to output time and clipped to their clip; monotonic, no overlaps.
 * Ayah spans tile each clip; a clip whose result has wordTimingsValid = false contributes ayahs only.
 */
export function buildTimeline(plan: AudioPlan, results: ClipResult[]): Timeline {
  return timeline.buildTimeline(plan, results)
}

// ── Tajweed rules ──

export interface TajweedRuleInfo {
  id: TajweedRuleId
  nameAr: string
  nameEn: string
  /** letter colour on LIGHT backgrounds: KFGQPC V4 palette 0, the printed colour-coded Mushaf (research/fonts-rendering.md §8.3) */
  color: string
  /** letter colour on DARK backgrounds: KFGQPC V4 palette 1 */
  colorDark?: string
  /**
   * short Arabic explanation (1–2 sentences). Written with characters the UI font (Readex Pro) has: Quranic examples
   * use the standard sukun/tanween (no U+06E1, U+06E2, U+0657, U+08F0…); show real Quran words with the Quran font.
   */
  explanationAr: string
  /** the same explanation in English (plain transliteration; Arabic examples in the same UI-safe characters) */
  explanationEn: string
  /**
   * citation a reader can be shown next to the explanation, e.g. «تحفة الأطفال — أحكام المد» (a section of the
   * matn, research/fixtures/fonts-rendering/tajweed-rules.json sources); the general «أحكام التجويد برواية حفص عن عاصم»
   * where the research names no classical source. Empty only on the fallback.
   */
  citeAr: string
  /** legend group as in the printed Mushaf key: grey 'silent', red tones 'madd', green 'ghunnah', blue 'qalqalah' */
  group?: 'silent' | 'madd' | 'ghunnah' | 'qalqalah'
  /** the rule's verse from Tuhfat al-Atfal, when there is one */
  matnAr?: string
  /** internal research note: where the wording comes from (not for display; show citeAr) */
  source?: string
  /** research note when the wording or colour still needs review, e.g. "text: medium (paraphrase; check wording with a teacher)" */
  confidence?: string
  /** true only on the neutral info ruleInfo() returns for an unknown class (drawn like plain text, kept out of legends) */
  fallback?: boolean
}

/**
 * The 19 rule classes of Quran.com's tajweed markup, keyed by class (research/fixtures/fonts-rendering/tajweed-rules.json,
 * with the 00-gaps D10 label fixes: madda_permissible = «المد العارض للسكون», madda_obligatory = «المد المتصل والمنفصل»).
 */
export const TAJWEED_RULES: Record<string, TajweedRuleInfo> = tajweed.TAJWEED_RULE_TABLE

/**
 * Info for any rule id; unknown ids get a neutral fallback, never throw. The markup helper
 * 'custom-alef-maksora' (always nested in madda_normal) gets madda_normal's colours.
 */
export function ruleInfo(id: TajweedRuleId): TajweedRuleInfo {
  return tajweed.ruleInfo(id)
}

/** Rules present in the given (trimmed) ayahs, first-appearance order, with up to 3 example words each. Unknown classes are left out. */
export function rulesInAyahs(ayahs: Ayah[]): { rule: TajweedRuleInfo; examples: string[] }[] {
  return tajweed.rulesInAyahs(ayahs)
}

// ── Pause marks ──

export interface WaqfInfo {
  kind: WaqfKind
  char: string
  nameAr: string
  meaningAr: string
  /** true when stopping on this mark is acceptable */
  canStop: boolean
}

export const WAQF_INFO: Record<WaqfKind, WaqfInfo> = waqf.WAQF_TABLE

/** Kind of a pause-mark character; also accepts a word with its mark appended (the trailing mark decides). */
export function waqfKindOf(char: string): WaqfKind | null {
  return waqf.waqfKindOf(char)
}

// ── Share links (all state in the URL — no backend) ──

export interface ShareState {
  selection: Selection
  /** '' = the app's default reciter */
  reciterId: string
  /** the isti'adha opens the clip (PlanOptions.istiadha); encoded `i=1`, absent = off */
  istiadha?: boolean
  tafsirId: string | null
  translationId: number | null
  design: Partial<DesignOptions>
}

/** The design a new clip starts with; share links carry only the fields that differ from it. */
export const DEFAULT_DESIGN: DesignOptions = share.DEFAULT_DESIGN

/**
 * Compact query string (no leading "?"), stable key order, only non-default design fields:
 * `v=1&s=2&a=255-257` (whole ayahs) or `v=1&s=2&f=255.3&t=257.5` (words), then r, i (=1 with the isti'adha), tf, tr
 * and design keys. Pass the surah's `ayahs` to write whole-ayah selections compactly (`a=`) even when their end word
 * is a real position. An uploaded background image is never shared.
 */
export function encodeShareState(state: ShareState, ayahs?: Ayah[]): string {
  return share.encodeShareState(state, ayahs)
}

/**
 * Parses a query string; returns null when it holds no valid selection. Ignores unknown/invalid fields.
 * An end at the ayah end (`a=…`, `t=257`) comes back as AYAH_END_WORD: run clampSelection() on the
 * selection once the surah is loaded. `istiadha` is present (true) only for `i=1` / `i=true`.
 * decode(encode(s)) equals s for every valid state.
 */
export function decodeShareState(query: string): ShareState | null {
  return share.decodeShareState(query)
}

// ── Arabic helpers ──

/** 255 → "٢٥٥" */
export function toArabicDigits(n: number | string): string {
  return arabic.toArabicDigits(n)
}

/** Removes harakat, Quranic annotation marks and tatweel; unifies alef/hamza/ya/ta-marbuta forms for search. */
export function normalizeForSearch(text: string): string {
  return arabic.normalizeForSearch(text)
}

// ── Publishing to Balligh's own pages (server/) ──

export {
  PUBLISH_PLATFORMS,
  PLATFORM_RULES,
  MIN_PUBLISH_MS,
  MAX_NAME_LENGTH,
  platformRefusal,
  checkPublisherName,
  checkInstagramUsername,
  hasBlockedWord,
  type PublishPlatform,
  type PlatformRules,
  type NameProblem,
  type UsernameProblem,
  type PublisherCredit,
} from './publish'
