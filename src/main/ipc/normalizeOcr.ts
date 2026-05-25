/**
 * OCR text normalisation — ported from cllg_pipeline.py `normalize_ocr_text_lang`.
 *
 * Fixes visually-confusable Latin/Greek characters that OCR models routinely
 * mix up (e.g. Latin 'o' in a Greek word, Greek 'ο' in a Latin word).
 * Applied per-page immediately after OCR, before the Review step.
 */

// ── Script-exclusive letter sets ─────────────────────────────────────────────
// Presence of any of these in a word is a reliable signal of which script
// the word belongs to.

const GREEK_ONLY     = new Set([...'γδθλξπσςφψω'])
const GREEK_ONLY_UP  = new Set([...'ΓΔΘΛΞΠΣΦΨΩ'])
// Latin letters with no Greek visual equivalent
const LATIN_ONLY     = new Set([...'bcdfghjlqrstwz'])

// ── Confusable maps ───────────────────────────────────────────────────────────

const TO_GREEK: Record<string, string> = {
  'A':'Α', 'B':'Β', 'E':'Ε', 'H':'Η', 'I':'Ι',
  'K':'Κ', 'M':'Μ', 'N':'Ν', 'O':'Ο', 'P':'Ρ',
  'T':'Τ', 'X':'Χ', 'Y':'Υ', 'Z':'Ζ',
  'a':'α', 'e':'ε', 'i':'ι', 'o':'ο',
  'v':'ν', 'x':'χ', 'n':'η', 'p':'ρ',
}

const TO_LATIN: Record<string, string> = Object.fromEntries(
  Object.entries(TO_GREEK).map(([k, v]) => [v, k])
)

// ── Detection regex ───────────────────────────────────────────────────────────
// Tokens that mix Greek and Latin letters, requiring at least 2 chars of the
// "intruding" script to avoid flagging single-letter labels.
// JS /u flag gives us Unicode property escapes.
const MIXED_RE = /(?<![A-Za-zͰ-Ͽἀ-῿])(?:\p{Script=Greek}+[A-Za-z]{2,}[\p{Script=Greek}A-Za-z]*|[A-Za-z]+\p{Script=Greek}{2,}[\p{Script=Greek}A-Za-z]*)(?![A-Za-zͰ-Ͽἀ-῿])/gmu

// ── Helpers ───────────────────────────────────────────────────────────────────

function deaccentLower(word: string): string {
  return word.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function hasGreekDiacritic(word: string): boolean {
  for (const ch of word) {
    const nfkd = ch.normalize('NFKD')
    if (nfkd.length > 1 && /\p{Script=Greek}/u.test(nfkd[0])) return true
  }
  return false
}

// ── Word-level normalizer ─────────────────────────────────────────────────────

function normalizeMixedWord(word: string): string {
  const base = deaccentLower(word)

  const isTargetGreek =
    [...base].some(c => GREEK_ONLY.has(c)) ||
    [...word].some(c => GREEK_ONLY_UP.has(c)) ||
    hasGreekDiacritic(word)

  const isTargetLatin = [...base].some(c => LATIN_ONLY.has(c))

  // Contradictory signals — too ambiguous, leave untouched
  if (isTargetGreek && isTargetLatin) return word

  let target: 'greek' | 'latin' | null = null

  if (isTargetGreek)      target = 'greek'
  else if (isTargetLatin) target = 'latin'
  else {
    // Majority vote with a conservative threshold
    const letters = [...word].filter(c => /[A-Za-zͰ-Ͽἀ-῿]/u.test(c))
    const greekCount = letters.filter(c => /\p{Script=Greek}/u.test(c)).length
    const total = letters.length
    if (total === 0) return word
    const ratio = greekCount / total
    if (ratio >= 0.65)      target = 'greek'
    else if (ratio <= 0.35) target = 'latin'
    else                    return word // too close to call
  }

  const map = target === 'greek' ? TO_GREEK : TO_LATIN
  return [...word].map(c => map[c] ?? c).join('')
}

// ── Text-level normalizer ─────────────────────────────────────────────────────

/**
 * Normalise a page of OCR text:
 * 1. NFKC normalisation
 * 2. Fix Latin/Greek confusable characters in mixed-script words
 */
export function normalizeOcrText(text: string): string {
  const nfkc = text.normalize('NFKC')
  return nfkc.replace(MIXED_RE, m => normalizeMixedWord(m))
}
