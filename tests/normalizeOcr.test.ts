import { describe, it, expect } from 'vitest'
import { normalizeOcrText } from '../src/main/ipc/normalizeOcr'

describe('normalizeOcrText', () => {
  describe('pure Greek text — unchanged', () => {
    it('leaves a Greek-only word untouched', () => {
      expect(normalizeOcrText('αβγδ')).toBe('αβγδ')
    })
    it('leaves polytonic Greek untouched', () => {
      expect(normalizeOcrText('ἀγαθός')).toBe('ἀγαθός')
    })
    it('leaves a full Greek sentence untouched', () => {
      const s = 'τοῦτό ἐστι τὸ ἀγαθόν'
      expect(normalizeOcrText(s)).toBe(s)
    })
  })

  describe('pure Latin text — unchanged', () => {
    it('leaves a Latin-only word untouched', () => {
      expect(normalizeOcrText('abc')).toBe('abc')
    })
    it('leaves a capitalized Latin word untouched', () => {
      expect(normalizeOcrText('Roma')).toBe('Roma')
    })
    it('leaves a Latin sentence untouched', () => {
      const s = 'de rerum natura'
      expect(normalizeOcrText(s)).toBe(s)
    })
  })

  describe('GREEK_ONLY signal letter forces Greek target', () => {
    it('Latin oo in a Greek word with γ → converted to Greek οο', () => {
      // MIXED_RE requires ≥2 intruding chars; αγ(Greek) + oo(2 Latin) + θ(Greek) matches
      expect(normalizeOcrText('αγooθ')).toBe('αγοοθ')
    })
    it('Latin vv in a Greek word with σ → converted to Greek νν', () => {
      // σ(GREEK_ONLY) + vv(2 Latin) + μ(Greek) triggers Greek target
      expect(normalizeOcrText('σvvμ')).toBe('σννμ')
    })
    it('uppercase GREEK_ONLY Σ forces Greek conversion of AA', () => {
      // Σ(GREEK_ONLY_UP) + AA(2 Latin) + Λ(Greek) triggers Greek target; A→Α
      expect(normalizeOcrText('ΣAAΛ')).toBe('ΣΑΑΛ')
    })
    it('Greek diacritic in word forces Greek target', () => {
      // ἀγoo — diacritic on ἀ → hasGreekDiacritic=true → target Greek; oo→οο
      expect(normalizeOcrText('ἀγoo')).toBe('ἀγοο')
    })
  })

  describe('LATIN_ONLY signal letter forces Latin target', () => {
    it('Greek Α (lookalike) in a word with Latin b → converted to Latin A', () => {
      // Α(Greek) + bc(2 Latin) — Alt1 matches; b forces Latin target → Α→A
      expect(normalizeOcrText('Αbc')).toBe('Abc')
    })
    it('Greek ΟΝ (lookalikes) in a word with Latin b → converted to Latin', () => {
      // b(Latin) + ΟΝ(2 Greek) — Alt2 matches; b forces Latin target → Ο→O, Ν→N
      expect(normalizeOcrText('bΟΝ')).toBe('bON')
    })
    it('Greek ΑΡ (lookalikes) in a word with Latin b → converted to Latin', () => {
      // b(Latin) + ΑΡ(2 Greek) — Alt2 matches; b forces Latin target → Α→A, Ρ→P
      expect(normalizeOcrText('bΑΡ')).toBe('bAP')
    })
  })

  describe('contradictory signals — left untouched', () => {
    it('word with both Greek-only γ and Latin-only b is unchanged', () => {
      // γbα — has γ (GREEK_ONLY) and b (LATIN_ONLY): contradiction
      const word = 'γbα'
      expect(normalizeOcrText(word)).toBe(word)
    })
    it('word with both σ and g is unchanged', () => {
      const word = 'σgα'
      expect(normalizeOcrText(word)).toBe(word)
    })
  })

  describe('majority vote (no strong signal)', () => {
    it('≥65% Greek ratio → target Greek, converts Latin lookalikes', () => {
      // αιιι(3 Greek) + oo(2 Latin); MIXED_RE matches (≥2 Latin after Greek block).
      // No GREEK_ONLY/LATIN_ONLY signal → majority vote: 4 Greek / 6 total = 0.667 ≥ 0.65 → Greek.
      expect(normalizeOcrText('αιιιoo')).toBe('αιιιοο')
    })
    it('≤35% Greek ratio → target Latin, converts Greek lookalikes', () => {
      // 1 Greek lookalike in 4 total → 25% → Latin. αooo → Α in Latin = A; but α is ambiguous
      // ιooo — ι=1 Greek, o,o,o=3 Latin → 1/4=25% → Latin. ι→i, o stays o
      expect(normalizeOcrText('ιooo')).toBe('iooo')
    })
    it('36–64% Greek ratio — too close to call, left untouched', () => {
      // αo — 1 Greek + 1 Latin = 50% → ambiguous → unchanged
      // But wait: both α and o are in the confusable maps and neither is in GREEK_ONLY/LATIN_ONLY
      // α is in TO_LATIN? Let's check: TO_LATIN is built from TO_GREEK entries reversed.
      // TO_GREEK has 'a'→'α', 'o'→'ο', etc. So TO_LATIN has 'α'→'a', 'ο'→'o'.
      // αo: α is Greek, o is Latin. 1 Greek / 2 total = 50% → untouched
      expect(normalizeOcrText('αo')).toBe('αo')
    })
  })

  describe('short intruder (below MIXED_RE threshold)', () => {
    it('single Latin char in a Greek word is NOT matched (min 2 intruder chars)', () => {
      // αoα — single Latin 'o' inside Greek letters. MIXED_RE requires ≥2 intruding Latin chars
      // The regex needs [A-Za-z]{2,} or \p{Script=Greek}{2,}, so single intruder is ignored
      expect(normalizeOcrText('αoα')).toBe('αoα')
    })
    it('single Greek char in a Latin word is NOT matched', () => {
      // aαb — single Greek 'α' inside Latin letters
      expect(normalizeOcrText('aαb')).toBe('aαb')
    })
  })

  describe('multi-word text — only mixed tokens affected', () => {
    it('mixed token in a sentence is fixed, pure tokens unchanged', () => {
      // "αβγ σvvμ abc" — first word pure Greek (unchanged), second mixed (fixed), third pure Latin (unchanged)
      // σvvμ: σ(GREEK_ONLY) + vv(2 Latin) + μ → matches MIXED_RE, target Greek, vv→νν
      expect(normalizeOcrText('αβγ σvvμ abc')).toBe('αβγ σννμ abc')
    })
    it('multiple mixed tokens in same string are all fixed', () => {
      expect(normalizeOcrText('σvvμ σvvμ')).toBe('σννμ σννμ')
    })
  })

  describe('edge cases', () => {
    it('empty string returns empty string', () => {
      expect(normalizeOcrText('')).toBe('')
    })
    it('whitespace-only string is unchanged', () => {
      expect(normalizeOcrText('   ')).toBe('   ')
    })
    it('numbers and punctuation are unchanged', () => {
      expect(normalizeOcrText('123 . , !')).toBe('123 . , !')
    })
    it('NFKC normalization is applied before matching', () => {
      // Combining character sequences should be normalized
      const composed = 'ά'   // α + combining acute = composed ά
      const result = normalizeOcrText(composed)
      // After NFKC: becomes ά (U+03AC); no mixed chars → unchanged value
      expect(result).toBe('ά')
    })
  })
})
