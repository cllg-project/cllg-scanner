// Beta Code → Unicode polytonic Greek converter.
// Key format: modifiers sorted by char code, then base letter.
//   Modifier char codes: ( 40  ) 41  + 43  / 47  = 61  \ 92  | 124
//   Example: smooth()+acute(/)+alpha → sort ')','/' → key ")/a" → ἄ
// Modifiers are order-independent: typing /)+a or )/+a both produce ἄ (+ is discarded here).

const LETTER_MAP: Record<string, string> = {
  a: 'α', b: 'β', g: 'γ', d: 'δ', e: 'ε', z: 'ζ', h: 'η', q: 'θ',
  i: 'ι', k: 'κ', l: 'λ', m: 'μ', n: 'ν', c: 'ξ', o: 'ο', p: 'π',
  r: 'ρ', s: 'σ', t: 'τ', u: 'υ', f: 'φ', x: 'χ', y: 'ψ', w: 'ω',
  A: 'Α', B: 'Β', G: 'Γ', D: 'Δ', E: 'Ε', Z: 'Ζ', H: 'Η', Q: 'Θ',
  I: 'Ι', K: 'Κ', L: 'Λ', M: 'Μ', N: 'Ν', C: 'Ξ', O: 'Ο', P: 'Π',
  R: 'Ρ', S: 'Σ', T: 'Τ', U: 'Υ', F: 'Φ', X: 'Χ', Y: 'Ψ', W: 'Ω'
}

const MODIFIER_KEYS = new Set([')', '(', '/', '\\', '=', '+', '|'])

// ── Precomposed character table ──────────────────────────────────────────────
// Keys: modifiers sorted by ASCII char code, then base letter.
// Single-modifier combos are straightforward; multi-modifier order is determined
// by char code sort, e.g. smooth(41)+acute(47) → ")/" prefix.

const COMPOSED: Record<string, string> = {
  // ── Alpha ──
  ')a': 'ἀ',   '(a': 'ἁ',   '/a': 'ά',   '\\a': 'ὰ',  '=a': 'ᾶ',  '|a': 'ᾳ',
  ')/a': 'ἄ',  ')\\a': 'ἂ', ')=a': 'ἆ',
  '(/a': 'ἅ',  '(\\a': 'ἃ', '(=a': 'ἇ',
  ')|a': 'ᾀ',  '(|a': 'ᾁ',
  ')/|a': 'ᾄ', ')\\|a': 'ᾂ', ')=|a': 'ᾆ',
  '(/|a': 'ᾅ', '(\\|a': 'ᾃ', '(=|a': 'ᾇ',
  '/|a': 'ᾴ',  '\\|a': 'ᾲ', '=|a': 'ᾷ',

  // ── Alpha uppercase ──
  ')A': 'Ἀ',   '(A': 'Ἁ',   '/A': 'Ά',   '\\A': 'Ὰ',  '|A': 'ᾼ',
  ')/A': 'Ἄ',  ')\\A': 'Ἂ', ')=A': 'Ἆ',
  '(/A': 'Ἅ',  '(\\A': 'Ἃ', '(=A': 'Ἇ',
  ')|A': 'ᾈ',  '(|A': 'ᾉ',
  ')/|A': 'ᾌ', ')\\|A': 'ᾊ', ')=|A': 'ᾎ',
  '(/|A': 'ᾍ', '(\\|A': 'ᾋ', '(=|A': 'ᾏ',

  // ── Epsilon ──
  ')e': 'ἐ',   '(e': 'ἑ',   '/e': 'έ',   '\\e': 'ὲ',
  ')/e': 'ἔ',  ')\\e': 'ἒ', '(/e': 'ἕ',  '(\\e': 'ἓ',

  // ── Epsilon uppercase ──
  ')E': 'Ἐ',   '(E': 'Ἑ',   '/E': 'Έ',   '\\E': 'Ὲ',
  ')/E': 'Ἔ',  ')\\E': 'Ἒ', '(/E': 'Ἕ',  '(\\E': 'Ἓ',

  // ── Eta ──
  ')h': 'ἠ',   '(h': 'ἡ',   '/h': 'ή',   '\\h': 'ὴ',  '=h': 'ῆ',  '|h': 'ῃ',
  ')/h': 'ἤ',  ')\\h': 'ἢ', ')=h': 'ἦ',
  '(/h': 'ἥ',  '(\\h': 'ἣ', '(=h': 'ἧ',
  ')|h': 'ᾐ',  '(|h': 'ᾑ',
  ')/|h': 'ᾔ', ')\\|h': 'ᾒ', ')=|h': 'ᾖ',
  '(/|h': 'ᾕ', '(\\|h': 'ᾓ', '(=|h': 'ᾗ',
  '/|h': 'ῄ',  '\\|h': 'ῂ', '=|h': 'ῇ',

  // ── Eta uppercase ──
  ')H': 'Ἠ',   '(H': 'Ἡ',   '/H': 'Ή',   '\\H': 'Ὴ',  '|H': 'ῌ',
  ')/H': 'Ἤ',  ')\\H': 'Ἢ', ')=H': 'Ἦ',
  '(/H': 'Ἥ',  '(\\H': 'Ἣ', '(=H': 'Ἧ',
  ')|H': 'ᾘ',  '(|H': 'ᾙ',
  ')/|H': 'ᾜ', ')\\|H': 'ᾚ', ')=|H': 'ᾞ',
  '(/|H': 'ᾝ', '(\\|H': 'ᾛ', '(=|H': 'ᾟ',

  // ── Iota ──
  ')i': 'ἰ',   '(i': 'ἱ',   '/i': 'ί',   '\\i': 'ὶ',  '=i': 'ῖ',  '+i': 'ϊ',
  ')/i': 'ἴ',  ')\\i': 'ἲ', ')=i': 'ἶ',
  '(/i': 'ἵ',  '(\\i': 'ἳ', '(=i': 'ἷ',
  '+/i': 'ΐ',  '+\\i': 'ῒ',

  // ── Iota uppercase ──
  ')I': 'Ἰ',   '(I': 'Ἱ',   '/I': 'Ί',   '\\I': 'Ὶ',  '+I': 'Ϊ',
  ')/I': 'Ἴ',  ')\\I': 'Ἲ', ')=I': 'Ἶ',
  '(/I': 'Ἵ',  '(\\I': 'Ἳ', '(=I': 'Ἷ',

  // ── Omicron ──
  ')o': 'ὀ',   '(o': 'ὁ',   '/o': 'ό',   '\\o': 'ὸ',
  ')/o': 'ὄ',  ')\\o': 'ὂ', '(/o': 'ὅ',  '(\\o': 'ὃ',

  // ── Omicron uppercase ──
  ')O': 'Ὀ',   '(O': 'Ὁ',   '/O': 'Ό',   '\\O': 'Ὸ',
  ')/O': 'Ὄ',  ')\\O': 'Ὂ', '(/O': 'Ὅ',  '(\\O': 'Ὃ',

  // ── Upsilon ──
  ')u': 'ὐ',   '(u': 'ὑ',   '/u': 'ύ',   '\\u': 'ὺ',  '=u': 'ῦ',  '+u': 'ϋ',
  ')/u': 'ὔ',  ')\\u': 'ὒ', ')=u': 'ὖ',
  '(/u': 'ὕ',  '(\\u': 'ὓ', '(=u': 'ὗ',
  '+/u': 'ΰ',  '+\\u': 'ῢ',

  // ── Upsilon uppercase ──
  '(U': 'Ὑ',   '/U': 'Ύ',   '\\U': 'Ὺ',  '+U': 'Ϋ',
  '(/U': 'Ὕ',  '(\\U': 'Ὓ', '(=U': 'Ὗ',

  // ── Omega ──
  ')w': 'ὠ',   '(w': 'ὡ',   '/w': 'ώ',   '\\w': 'ὼ',  '=w': 'ῶ',  '|w': 'ῳ',
  ')/w': 'ὤ',  ')\\w': 'ὢ', ')=w': 'ὦ',
  '(/w': 'ὥ',  '(\\w': 'ὣ', '(=w': 'ὧ',
  ')|w': 'ᾠ',  '(|w': 'ᾡ',
  ')/|w': 'ᾤ', ')\\|w': 'ᾢ', ')=|w': 'ᾦ',
  '(/|w': 'ᾥ', '(\\|w': 'ᾣ', '(=|w': 'ᾧ',
  '/|w': 'ῴ',  '\\|w': 'ῲ', '=|w': 'ῷ',

  // ── Omega uppercase ──
  ')W': 'Ὠ',   '(W': 'Ὡ',   '/W': 'Ώ',   '\\W': 'Ὼ',  '|W': 'ῼ',
  ')/W': 'Ὤ',  ')\\W': 'Ὢ', ')=W': 'Ὦ',
  '(/W': 'Ὥ',  '(\\W': 'Ὣ', '(=W': 'Ὧ',
  ')|W': 'ᾨ',  '(|W': 'ᾩ',
  ')/|W': 'ᾬ', ')\\|W': 'ᾪ', ')=|W': 'ᾮ',
  '(/|W': 'ᾭ', '(\\|W': 'ᾫ', '(=|W': 'ᾯ',

  // ── Rho with breathing ──
  ')r': 'ῤ',   '(r': 'ῥ',   '(R': 'Ῥ'
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BetaResult {
  char: string | null  // character to insert; null = pass through unchanged
  isPending: boolean   // true when a modifier key was accumulated
}

/**
 * Convert one keypress in beta-code mode.
 * `pending` is mutated in place: modifiers accumulate until a letter is pressed.
 * Modifier input order does not matter — they are sorted before lookup.
 */
export function convertBetaKey(key: string, pending: Set<string>): BetaResult {
  if (MODIFIER_KEYS.has(key)) {
    pending.add(key)
    return { char: null, isPending: true }
  }

  const base = LETTER_MAP[key]
  if (base === undefined) {
    pending.clear()
    return { char: null, isPending: false }
  }

  if (pending.size > 0) {
    // Sort modifiers by char code for a canonical, order-independent key.
    const lookup = [...pending].sort().join('') + key
    pending.clear()
    return { char: COMPOSED[lookup] ?? base, isPending: false }
  }

  return { char: base, isPending: false }
}

/**
 * Replace word-internal σ with ς when followed by a non-Greek character.
 * Does NOT convert σ at the very end of the string — that happens via the
 * textarea's onChange when the next word-boundary character is typed.
 */
export function finalSigmaFix(text: string): string {
  // U+0370-U+03FF: Greek and Coptic block  U+1F00-U+1FFF: Greek Extended
  return text.replace(/σ(?=[^Ͱ-Ͽἀ-῿])/gu, 'ς')
}

// ── Helper map data for BetaCodeHelper component ─────────────────────────────

export const LETTER_PAIRS: Array<[string, string]> = Object.entries(LETTER_MAP)
  .filter(([k]) => k === k.toLowerCase())
  .map(([k, v]) => [k, v])

export const MODIFIER_DESCRIPTIONS: Array<[string, string]> = [
  [')', 'smooth ʻ'],
  ['(', 'rough ʼ'],
  ['/', 'acute ´'],
  ['\\', 'grave `'],
  ['=', 'circumflex ˆ'],
  ['+', 'diaeresis ¨'],
  ['|', 'iota sub.']
]

export const EXAMPLE_PAIRS: Array<[string, string]> = [
  [')/a', 'ἄ'],
  ['(/a', 'ἅ'],
  ['(=a', 'ἇ'],
  [')=|a', 'ᾆ'],
  ['|h', 'ῃ'],
  ['(r', 'ῥ'],
  ['s + pause', 'ς']
]
