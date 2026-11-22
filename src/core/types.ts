// Shared domain types — the contract between data/, domain/, render/, media/
// and ui/. Nothing here imports from anywhere else.
// Conventions: surah/ayah/word numbers are 1-based like the Mushaf; string
// offsets are UTF-16 code-unit offsets (plain JS string indices); times are
// milliseconds unless a name says otherwise.

/** "2:255" */
export type VerseKey = `${number}:${number}`

export const verseKey = (surah: number, ayah: number): VerseKey => `${surah}:${ayah}`

// ───────────────────────── Quran text ─────────────────────────

export interface Surah {
  number: number
  /** "البقرة" */
  nameArabic: string
  /** "Al-Baqarah" */
  nameSimple: string
  /** "The Cow" */
  nameTranslated: string
  versesCount: number
  revelationPlace: 'makkah' | 'madinah'
  /** true when the Mushaf prints a basmala before the surah (all but 1 and 9) */
  bismillahPre: boolean
}

/**
 * Tajweed rule ids exactly as Quran.com's text_uthmani_tajweed spells them in
 * `<tajweed class=...>`. Unknown future classes are carried through as strings.
 */
export type TajweedRuleId =
  | 'ham_wasl'
  | 'laam_shamsiyah'
  | 'slnt'
  | 'madda_normal'
  | 'madda_permissible'
  | 'madda_necessary'
  | 'madda_obligatory'
  | 'qalaqah'
  | 'ikhafa'
  | 'ikhafa_shafawi'
  | 'idgham_ghunnah'
  | 'idgham_wo_ghunnah'
  | 'idgham_shafawi'
  | 'idgham_mutajanisayn'
  | 'idgham_mutaqaribayn'
  | 'iqlab'
  | 'ghunnah'
  | (string & {})

/** A coloured run inside one word: [start, end) offsets into Word.text. */
export interface TajweedSpan {
  start: number
  end: number
  rule: TajweedRuleId
}

/**
 * Pause (waqf) marks printed after a word in the Madani Mushaf.
 * lazim ۘ (must stop) · mamnu ۙ (do not stop) · jaiz ۚ (may stop) ·
 * wasl_awla ۖ (continuing is better) · waqf_awla ۗ (stopping is better) ·
 * muanaqa ۛ (stop at one of the paired marks, not both) · saktah ۜ (brief pause without breath)
 */
export type WaqfKind = 'lazim' | 'mamnu' | 'jaiz' | 'wasl_awla' | 'waqf_awla' | 'muanaqa' | 'saktah'

export interface Word {
  /** 1-based position among the ayah's words; the same index the audio word segments use. */
  position: number
  /**
   * Display text WITHOUT any trailing pause mark: qpcToStandard(words[].text_qpc_hafs), drawn with Amiri Quran.
   * Not text_uthmani: Amiri draws a stray small meem on 6,678 of its words (research/00-gaps.md §2.2).
   */
  text: string
  /**
   * Pause kind for the selection guard, read from the Tanzil marks in words[].text_uthmani (00-gaps D1: keeps
   * ۙ = do not stop). It can be set while waqfChar is null (QPC prints no ۙ) and differ from the printed mark (353 words).
   */
  waqf: WaqfKind | null
  /** The pause mark PRINTED after this word in the display text (QPC system), e.g. "ۚ"; null when none is printed. */
  waqfChar: string | null
  /**
   * Tajweed colour runs over `text`: verse-level text_uthmani_tajweed → quran-text-api §3.7 grouping → projection
   * onto the display text (00-gaps §2.1). Empty when the word has none.
   */
  tajweed: TajweedSpan[]
}

export interface Ayah {
  key: VerseKey
  surah: number
  number: number
  words: Word[]
  juz: number
  page: number
  /** true when this ayah carries a sajdah (prostration) mark */
  sajdah: boolean
}

/** A word inside a surah. */
export interface WordRef {
  ayah: number
  word: number
}

/**
 * The user's selection: an inclusive range of words inside ONE surah.
 * Invariant after domain/selection.normalizeSelection: start <= end in reading order.
 */
export interface Selection {
  surah: number
  start: WordRef
  end: WordRef
}

// ───────────────────────── Reciters & audio ─────────────────────────
// Model from research/audio-timing.md §8 (reference: research/scripts/audio-timing/cut-planner.ts).

export type RecitationStyle = 'murattal' | 'mujawwad' | 'muallim'

/**
 * A — per-ayah file + exact word timings (Quran.com v4 segments)
 * B — whole-surah file sliced with HTTP Range + word timings (QDC)
 * C — per-ayah file, no word timings (whole ayahs only)
 * D — whole-surah file sliced with HTTP Range + approximate ayah timings (mp3quran), no word timings
 */
export type TimingClass = 'A' | 'B' | 'C' | 'D'

export interface Reciter {
  /** catalogue id from research/fixtures/audio-timing/reciters.json, e.g. "alafasy" */
  id: string
  nameAr: string
  nameEn: string
  style: RecitationStyle | null
  timingClass: TimingClass
  /** classes A and B → word-level cuts and word highlighting */
  wordTimings: boolean
  /** attribution for credits, e.g. "EveryAyah.com · Quran.com" */
  sourceName: string
  /**
   * an isti'adha recording in THIS reciter's own voice exists (00-gaps §6.3). False when the only file is
   * someone else's voice (Shuraim, Ghamdi, Ayyoub carry Alafasy's): the app then offers no isti'adha (D7).
   */
  istiadha: boolean
}

/** One word's window in FILE time (ms from the start of the audio file). */
export interface WordTime {
  word: number
  startMs: number
  endMs: number
  /** true when interpolated/estimated rather than measured */
  estimated: boolean
}

export interface AyahAudio {
  /** 1-based ayah; 0 = the basmala clip source, -1 = the isti'adha clip source */
  ayah: number
  /** absolute https URL, CORS-enabled */
  url: string
  /** 'per_ayah' = the file holds only this ayah; 'chapter' = whole-surah file, fetched in Range slices */
  fileKind: 'per_ayah' | 'chapter'
  /** CBR bitrate of a chapter file in kbit/s (needed to compute byte ranges); null for per_ayah */
  bitrateKbps: number | null
  /** this ayah's window in FILE time; per_ayah files: 0 and null (whole file) */
  windowStartMs: number
  windowEndMs: number | null
  /** true when the window edges are approximate and should be snapped to the nearest pause (class D) */
  approximateWindow: boolean
  /** word windows in FILE time, chronological; a word may appear twice when the reciter repeated it; [] when unknown */
  words: WordTime[]
  /** number of words in the ayah (Quran.com positions) */
  wordCount: number
  timing: 'word' | 'partly-estimated' | 'none'
  /**
   * this reciter's per-ayah file for the same ayah (EveryAyah folder), for class B/D reciters that have one;
   * null otherwise. The fallback when the chapter file cannot be windowed (Xing VBR: Khalifa ch 14 and 72; 00-gaps §2.7).
   */
  perAyahUrl: string | null
}

/** One window of one audio file to play, in order. */
export interface AudioClip {
  /** first ayah covered; 0 = the leading basmala, -1 = the leading isti'adha */
  ayah: number
  /** last ayah covered (consecutive cuts of the same chapter file are merged) */
  ayahTo: number
  url: string
  fileKind: 'per_ayah' | 'chapter'
  bitrateKbps: number | null
  srcStartMs: number
  /** null = until the end of the file */
  srcEndMs: number | null
  fadeInMs: number
  fadeOutMs: number
  /**
   * class D: after decoding, move srcStart/srcEnd to the longest sub-threshold run within
   * [t − 1300, t + 700] ms (fall back to t when no run ≥ 150 ms) — audio-timing.md "Independent verification" #12
   */
  snapToPause: boolean
  /**
   * the clip starts at word 1 of an ayah from a word timing: after decoding, if speech exists before the
   * first segment with no pause ≥ ~700 ms, move the start to (speech onset − 50 ms) — finding B
   */
  extendToSpeechOnset: boolean
  /**
   * a whole per-ayah file played without word timings (class C, or an ayah-level fallback): after decoding, trim the
   * file's leading and trailing silence (keep ~80 ms of it) so consecutive ayahs do not leave long gaps
   */
  trimSilence: boolean
  /** highlight windows (FILE time) of the words this clip plays; [] without word timings */
  words: { ayah: number; word: number; startMs: number; endMs: number }[]
  /** ayah windows (FILE time) inside this clip; endMs null = to the clip end */
  ayahs: { ayah: number; startMs: number; endMs: number | null }[]
}

export interface AudioPlan {
  reciterId: string
  clips: AudioClip[]
  /** true when at least one clip was cut at a word boundary inside an ayah */
  wordLevel: boolean
  /** false when a boundary is estimated or the selection was widened to whole ayahs */
  exact: boolean
  /** what will actually be heard: equals the selection, or the selection widened to whole ayahs (classes C/D) */
  playedSelection: Selection
}

/** What the decoder actually produced per clip (after optional pause-snapping). */
export interface ClipResult {
  srcStartMs: number
  durationMs: number
  /**
   * false when the decoded file contradicts the clip's word timings (stale timings: a segment past the
   * file end — finding A); the timeline then highlights per ayah for this clip
   */
  wordTimingsValid: boolean
}

export interface TimedWord {
  ayah: number
  word: number
  startMs: number
  endMs: number
}

export interface TimedAyah {
  /** 0 = basmala, -1 = isti'adha */
  ayah: number
  startMs: number
  endMs: number
}

/** Output-time schedule of the assembled audio, used to sync the picture. */
export interface Timeline {
  durationMs: number
  ayahs: TimedAyah[]
  /** empty without word timings (the picture then highlights per ayah) */
  words: TimedWord[]
}

// ───────────────────────── Tafsir & translation ─────────────────────────

export interface TafsirSource {
  /** app key, e.g. "mukhtasar", "muyassar", "jalalayn", "qurtubi", "ahkam-ibn-alarabi" */
  id: string
  nameAr: string
  nameEn: string
  /** 'short' fits a share card (Mukhtasar, Muyassar, Jalalayn); 'long' is for reading in the app */
  length: 'short' | 'medium' | 'long'
  /** 'ahkam' = a fiqh-rulings work (Qurtubi, Ahkam al-Quran books) */
  kind: 'tafsir' | 'ahkam'
  /** one-line Arabic description shown in the picker */
  noteAr: string
  /** attribution line required by the source licence (publisher + host [+ version]) */
  creditAr: string
}

/** One tafsir passage. Grouped tafsirs cover several ayahs with one text. */
export interface TafsirEntry {
  ayahFrom: number
  ayahTo: number
  /** Plain text, paragraphs separated by "\n\n". */
  text: string
}

/** What data.fetchTafsirResult returns: the passages plus the provider that actually served them. */
export interface TafsirResult {
  entries: TafsirEntry[]
  /** e.g. "quranenc", "spa5k", "quranpedia" */
  providerId: string
  /** credit line for THIS provider (publisher + host [+ QuranEnc version]); shown wherever the text is shown */
  creditAr: string
}

export interface TranslationSource {
  /** Quran.com translation resource id */
  id: number
  /** BCP-47-ish code: "en", "fr", "ur" … */
  lang: string
  /** Language name in its own language: "English", "Français", "اردو" */
  langName: string
  /** Translator / edition name */
  name: string
  /** from the text itself, not /resources/languages (wrong or missing for 10 editions; 00-gaps §2.11) */
  dir: 'ltr' | 'rtl'
  /**
   * ISO 15924 script of the text ("Latn", "Arab", "Cyrl", "Thaa", "Beng", "Deva", "Hans", "Taml", …). The renderer
   * picks the Noto family for it (00-gaps §6.4): Readex Pro covers Arabic + Latin only, not Persian/Urdu letters.
   */
  script: string
}

export interface TranslationEntry {
  ayah: number
  /** Plain text, footnote markers removed. */
  text: string
}

// ───────────────────────── Design & rendering ─────────────────────────

export type Aspect = '9:16' | '4:5' | '1:1' | '16:9'

export type BackgroundSpec =
  | { kind: 'preset'; id: string }
  | { kind: 'image'; /** object URL of a user-chosen image */ src: string; /** 0..1 focal point */ focusX: number; focusY: number }

export interface DesignOptions {
  aspect: Aspect
  background: BackgroundSpec
  /** 0..0.85 darkening layer over the background */
  overlay: number
  /** 0..24 background blur in px at a 1080px-wide reference */
  blur: number
  /** colour family of the text drawn over the background */
  textTone: 'light' | 'dark'
  /** 0.75..1.4 multiplier on the auto-fitted Quran text size */
  fontScale: number
  showTajweed: boolean
  showRulesLegend: boolean
  showTranslation: boolean
  showTafsir: boolean
  showSurahHeader: boolean
  showAyahNumbers: boolean
  showWaqfMarks: boolean
  showReciterName: boolean
  /** highlight the word being recited (video only; needs word timings) */
  highlightWords: boolean
  showWatermark: boolean
}

/** Everything the scene needs to draw, already fetched and trimmed. */
export interface RenderModel {
  surah: Surah
  /** Selected ayahs, each trimmed to the selected words (word.position keeps the original numbering). */
  ayahs: Ayah[]
  /** true when the first/last ayah is only partly selected */
  partialStart: boolean
  partialEnd: boolean
  translation: TranslationEntry[] | null
  translationSource: TranslationSource | null
  tafsir: TafsirEntry[] | null
  tafsirSource: TafsirSource | null
  /** tajweed rules present in the selection, in first-appearance order */
  rules: TajweedRuleId[]
  reciter: Reciter | null
  /** null for still images */
  timeline: Timeline | null
  /** draw the basmala line before the text (set by the UI from the plan; on video it is timed by timeline ayah 0) */
  basmala: boolean
  /** draw «أعوذ بالله من الشيطان الرجيم» first (only when the isti'adha clip is played; timed by timeline ayah -1) */
  istiadha: boolean
  /** credit of the provider that actually served `tafsir` (TafsirResult.creditAr); null without tafsir */
  tafsirCreditAr: string | null
}

// ───────────────────────── Drawing surface ─────────────────────────
// The scene draws ONLY through Painter, so the same scene code runs on the web
// (Canvas 2D, render/platform.web.ts) and later on native (React Native Skia,
// render/platform.ts). No DOM types in this contract.

/** Opaque handle to a path built by Graphics.makePath. */
export interface PathHandle {
  readonly kind: 'path'
}

/** Opaque handle to a decoded raster image. */
export interface ImageHandle {
  readonly kind: 'image'
  readonly width: number
  readonly height: number
}

export interface GradientStop {
  /** 0..1 */
  offset: number
  color: string
}

export type Paint =
  | string
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number; stops: GradientStop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: GradientStop[] }

export interface TextStyle {
  /** a font family registered on the platform (e.g. "ReadexPro", "ReemKufi") */
  family: string
  sizePx: number
  /** 100..900 */
  weight?: number
  color: string
  align: 'left' | 'center' | 'right'
  direction: 'rtl' | 'ltr'
}

export interface Painter {
  readonly width: number
  readonly height: number
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(sx: number, sy: number): void
  /** multiplies the current global alpha (restored by restore()) */
  alpha(a: number): void
  clipRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number, paint: Paint): void
  fillRoundRect(x: number, y: number, w: number, h: number, radius: number, paint: Paint): void
  strokeRoundRect(x: number, y: number, w: number, h: number, radius: number, color: string, lineWidth: number): void
  fillPath(path: PathHandle, paint: Paint): void
  strokePath(path: PathHandle, color: string, lineWidth: number): void
  /** draws img into the destination rect; src selects a source rect (default: whole image) */
  drawImage(img: ImageHandle, dx: number, dy: number, dw: number, dh: number, src?: { x: number; y: number; w: number; h: number }): void
  /** single-line text (no wrapping) for non-Quran text; baseline at y */
  fillText(text: string, x: number, y: number, style: TextStyle): void
  measureText(text: string, style: TextStyle): number
}

/** An offscreen raster for caching static layers (background, static text). */
export interface Surface {
  readonly painter: Painter
  /** snapshot of the current pixels, drawable with Painter.drawImage */
  snapshot(): ImageHandle
}

/** Platform factory for drawing resources. */
export interface Graphics {
  /** path from SVG path data ("M10 10L20 20Z…"), e.g. HarfBuzz glyph outlines in font units */
  makePath(svgPathData: string): PathHandle
  createSurface(width: number, height: number): Surface
  /** decode an image from a URI (object URL on the web, file URI on native) */
  loadImage(uri: string): Promise<ImageHandle>
}

export interface Scene {
  width: number
  height: number
  /** 0 for a still image */
  durationMs: number
  /**
   * Still images: how many pages the content needs (≥ 1; always 1 for a video scene). Quran text and tafsir are
   * paged, never truncated (00-gaps C13/D6); the UI exports at most 10 pages (D3) and asks for a shorter
   * selection beyond that.
   */
  pageCount: number
  /** Draw the frame at time tMs (video and preview). On a still scene: page 0. Deterministic: same inputs → same pixels. */
  draw(painter: Painter, tMs: number): void
  /** Draw still page `page` (0-based, < pageCount). */
  drawPage(painter: Painter, page: number): void
}

// ───────────────────────── Export ─────────────────────────

export interface ExportProgress {
  phase: 'audio' | 'frames' | 'finalizing'
  /** 0..1 within the phase */
  ratio: number
}

export interface ExportedFile {
  blob: Blob
  mimeType: string
  extension: 'mp4' | 'webm' | 'png'
  /** suggested file name, e.g. "Al-Baqarah-255.mp4" */
  fileName: string
}
