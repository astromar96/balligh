// Arabic text helpers — research/quran-text-api.md §4.3 (reference: research/scripts/quran-text-api/search-normalize.ts).
// BMP-only character classes, no regex `u` flag, so Metro/Hermes and every browser treat them alike.

const ARABIC_INDIC_ZERO = 0x0660

/**
 * 255 → "٢٥٥". Western (0-9) and Persian (۰-۹) digits become Arabic-Indic; everything else is kept. For a
 * number the decimal point becomes the Arabic decimal separator "٫" (1.5 → "١٫٥").
 */
export function toArabicDigits(n: number | string): string {
  const isNumber = typeof n === 'number'
  const s = isNumber ? String(n) : String(n ?? '')
  let out = ''
  for (const c of s) {
    const code = c.charCodeAt(0)
    if (code >= 0x30 && code <= 0x39) out += String.fromCharCode(ARABIC_INDIC_ZERO + code - 0x30)
    else if (code >= 0x06f0 && code <= 0x06f9) out += String.fromCharCode(ARABIC_INDIC_ZERO + code - 0x06f0)
    else if (isNumber && c === '.') out += '٫'
    else out += c
  }
  return out
}

// §4.3 steps 1–2: marks, format characters, tatweel, small waw/yeh, ۞ ۩ ۝, digits and the standalone hamza.
const DROP = new RegExp(
  '[' +
    '\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06DC\\u06DF-\\u06E4\\u06E7\\u06E8\\u06EA-\\u06ED\\u08D3-\\u08FF' +
    '\\uFEFF\\u200C-\\u200F\\u0640\\u06E5\\u06E6\\u06DE\\u06E9\\u06DD\\u0621' +
    '\\u0660-\\u0669\\u06F0-\\u06F9' +
    ']',
  'g',
)

// §4.3 step 3: letter folding.
const FOLD: Record<string, string> = {
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'آ': 'ا', // آ
  'ٱ': 'ا', // ٱ
  'ٲ': 'ا', // ٲ
  'ٳ': 'ا', // ٳ
  'ٵ': 'ا', // ٵ
  'ى': 'ي', // ى
  'ی': 'ي', // ی
  'ٮ': 'ي', // ٮ
  'ے': 'ي', // ے
  'ة': 'ه', // ة
  'ہ': 'ه', // ہ
  'ۂ': 'ه', // ۂ
  'ۃ': 'ه', // ۃ
  'ؤ': 'و', // ؤ
  'ئ': 'ي', // ئ
  'ک': 'ك', // ک
  ' ': ' ', // NBSP
}
const FOLD_RE = new RegExp('[' + Object.keys(FOLD).join('') + ']', 'g')

/**
 * Search key for Arabic/Quran text: drops harakat, Quranic annotation and pause marks, tatweel, digits and
 * format characters; folds alef/hamza/ya/ta-marbuta forms; collapses whitespace. Never NFC/NFD-normalises
 * (Quran text stores shadda before fatha; compare only after stripping marks). Match whole tokens with
 * `(' ' + corpus + ' ').includes(' ' + query + ' ')`.
 */
export function normalizeForSearch(text: string): string {
  if (typeof text !== 'string' || !text) return ''
  return text
    .replace(DROP, '')
    .replace(FOLD_RE, (c) => FOLD[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim()
}
