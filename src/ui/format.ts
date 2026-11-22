// Small pure formatting helpers for the UI (no imports from other modules, so the UI keeps
// working while a module is still a stub).

const INDIC = ['\u0660', '\u0661', '\u0662', '\u0663', '\u0664', '\u0665', '\u0666', '\u0667', '\u0668', '\u0669']

/** "255" → "٢٥٥" (other characters untouched). */
export function toIndic(s: string): string {
  return s.replace(/[0-9]/g, (d) => INDIC[Number(d)])
}

/** "٢٥٥" or "۲۵۵" (Persian) → "255". */
export function fromIndic(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

/** Parses a positive integer typed in Western, Arabic-Indic or Persian digits; null when none. */
export function parseCount(s: string): number | null {
  const m = fromIndic(s).match(/\d+/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 83_400 ms → "1:23" ("١:٢٣" in Arabic). */
export function formatClock(ms: number, arabicDigits: boolean): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  const out = `${m}:${String(s).padStart(2, '0')}`
  return arabicDigits ? toIndic(out) : out
}

/** bytes → "12.4" (MB, one decimal). */
export function formatMegabytes(bytes: number, arabicDigits: boolean): string {
  const mb = bytes / (1024 * 1024)
  const out = mb < 10 ? mb.toFixed(1) : String(Math.round(mb))
  return arabicDigits ? toIndic(out).replace('.', '٫') : out
}

/** Ayah-end ornament: U+06DD followed by Arabic-Indic digits (Amiri Quran encloses them). */
export function ayahOrnament(n: number): string {
  return '\u06DD' + toIndic(String(n))
}

/** Strips harakat, Quranic marks and tatweel and unifies letter forms (for surah-name search). */
export function foldArabic(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671\u0672\u0673]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lower-cases and drops punctuation so "Al-Baqarah", "al baqara" and "albaqarah" meet. */
export function foldLatin(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** "Al-Fatihah" → "Al-\u2060Fatihah": a WORD JOINER after each hyphen, so a wrapped title breaks at its
 *  spaces ("Surah" / "Al-Fatihah"), never after the hyphen ("Surah Al-" / "Fatihah"). Display only. */
export function keepHyphens(s: string): string {
  return s.replace(/-/g, '-\u2060')
}

/** "Al-Baqarah" + 255..256 → "Al-Baqarah-255-256" (safe file base name; "Āl ʿImrān" → "Al-Imran"). */
export function fileBaseName(nameSimple: string, fromAyah: number, toAyah: number): string {
  const name =
    nameSimple
      .normalize('NFKD')
      .replace(/[\u0300-\u036f\u02b0-\u02ff'\u2018\u2019`]/g, '')
      .replace(/[^A-Za-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'Quran'
  return fromAyah === toAyah ? `${name}-${fromAyah}` : `${name}-${fromAyah}-${toAyah}`
}
