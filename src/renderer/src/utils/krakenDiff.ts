// Latin letters that are likely OCR confusions with Greek ones.

// ── Latin-character detection ─────────────────────────────────────────────

export interface LatinChar {
  origStart: number
  char: string
  suggestion: string | null  // Greek lookalike, or null if no visual equivalent
}

/** Latin characters that look like Greek ones and are common OCR confusions. */
export const LATIN_TO_GREEK: Record<string, string> = {
  // Uppercase
  A: 'Α', B: 'Β', E: 'Ε', Z: 'Ζ', H: 'Η', I: 'Ι',
  K: 'Κ', M: 'Μ', N: 'Ν', O: 'Ο', P: 'Ρ', T: 'Τ',
  Y: 'Υ', X: 'Χ',
  // Lowercase
  a: 'α', e: 'ε', i: 'ι', k: 'κ', n: 'η', o: 'ο',
  p: 'ρ', t: 'τ', u: 'υ', v: 'ν', w: 'ω', x: 'χ', y: 'υ',
}

/** Walk XML-tagged content and collect every A-Za-z character outside tags. */
export function detectLatinChars(content: string): LatinChar[] {
  const result: LatinChar[] = []
  let pos = 0
  while (pos < content.length) {
    if (content[pos] === '<') {
      const end = content.indexOf('>', pos)
      pos = end >= 0 ? end + 1 : pos + 1
      continue
    }
    const ch = content[pos]
    if (/[A-Za-z]/.test(ch)) {
      result.push({ origStart: pos, char: ch, suggestion: LATIN_TO_GREEK[ch] ?? null })
    }
    pos++
  }
  return result
}

/** Replace the Latin character at origStart with its suggestion (or delete if null). */
export function applyLatinSuggestion(content: string, lc: LatinChar): string {
  return content.slice(0, lc.origStart) + (lc.suggestion ?? '') + content.slice(lc.origStart + 1)
}
