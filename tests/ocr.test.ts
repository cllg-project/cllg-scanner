import { describe, it, expect } from 'vitest'
import {
  normalizeHyphenAndElision,
  normalizeAngleBrackets,
  patchOutput,
} from '../src/main/ipc/ocr'

describe('normalizeHyphenAndElision', () => {
  describe('quote normalization', () => {
    it('replaces backtick with straight apostrophe', () => {
      expect(normalizeHyphenAndElision("it`s")).toBe("it's")
    })
    it('replaces acute accent (´) with straight apostrophe', () => {
      expect(normalizeHyphenAndElision("it´s")).toBe("it's")
    })
    it('replaces left single curly quote (‘) with straight apostrophe', () => {
      expect(normalizeHyphenAndElision('it‘s')).toBe("it's")
    })
    it('replaces right single curly quote (’) with straight apostrophe', () => {
      expect(normalizeHyphenAndElision('it’s')).toBe("it's")
    })
    it('replaces modifier letter apostrophe (ʼ) with straight apostrophe', () => {
      expect(normalizeHyphenAndElision('itʼs')).toBe("it's")
    })
    it('replaces modifier letter prime (ʹ) with straight apostrophe', () => {
      expect(normalizeHyphenAndElision('itʹs')).toBe("it's")
    })
  })

  describe('hyphen normalization', () => {
    it('replaces non-breaking hyphen (‐) with ASCII hyphen', () => {
      expect(normalizeHyphenAndElision('well‐known')).toBe('well-known')
    })
    it('replaces en dash (–) with ASCII hyphen', () => {
      expect(normalizeHyphenAndElision('pp–100')).toBe('pp-100')
    })
    it('replaces minus sign (−) with ASCII hyphen', () => {
      expect(normalizeHyphenAndElision('x−y')).toBe('x-y')
    })
    it('replaces small hyphen-minus (﹘) with ASCII hyphen', () => {
      expect(normalizeHyphenAndElision('a﹘b')).toBe('a-b')
    })
    it('replaces fullwidth hyphen-minus (－) with ASCII hyphen', () => {
      expect(normalizeHyphenAndElision('a－b')).toBe('a-b')
    })
    it('does NOT replace EM dash (—)', () => {
      expect(normalizeHyphenAndElision('foo—bar')).toBe('foo—bar')
    })
  })

  describe('split-word hyphen removal', () => {
    it('joins word split across lines: "foo- bar" → "foobar"', () => {
      expect(normalizeHyphenAndElision('foo- bar')).toBe('foobar')
    })
    it('joins with multiple spaces after hyphen', () => {
      expect(normalizeHyphenAndElision('foo-  bar')).toBe('foobar')
    })
    it('does NOT join "foo-bar" (no space after hyphen)', () => {
      expect(normalizeHyphenAndElision('foo-bar')).toBe('foo-bar')
    })
    it('does NOT join when word after hyphen starts with a digit', () => {
      expect(normalizeHyphenAndElision('pp- 100')).toBe('pp- 100')
    })
  })

  describe('combined', () => {
    it('handles quote and hyphen normalization in the same string', () => {
      expect(normalizeHyphenAndElision("it’s well–known")).toBe("it's well-known")
    })
  })
})

describe('normalizeAngleBrackets', () => {
  const L = '⟨'  // ⟨
  const R = '⟩'  // ⟩

  describe('left angle bracket variants', () => {
    it('replaces single guillemet ‹', () => {
      expect(normalizeAngleBrackets('‹text›')).toBe(`${L}text${R}`)
    })
    it('replaces CJK angle 〈', () => {
      expect(normalizeAngleBrackets('〈text〉')).toBe(`${L}text${R}`)
    })
    it('replaces mathematical ⟨', () => {
      expect(normalizeAngleBrackets('⟨text⟩')).toBe(`${L}text${R}`)
    })
    it('replaces fullwidth ＜', () => {
      expect(normalizeAngleBrackets('＜text＞')).toBe(`${L}text${R}`)
    })
    it('replaces ornamental ❨', () => {
      expect(normalizeAngleBrackets('❨text❩')).toBe(`${L}text${R}`)
    })
  })

  describe('XML tag preservation', () => {
    it('preserves <ref> tag while replacing angle brackets around it', () => {
      expect(normalizeAngleBrackets('<ref>foo</ref>')).toBe('<ref>foo</ref>')
    })
    it('preserves self-closing <pb/> tag', () => {
      expect(normalizeAngleBrackets('<pb/>')).toBe('<pb/>')
    })
    it('replaces angle brackets adjacent to an XML tag without corrupting the tag', () => {
      const input = '〈word〉 <ref>I</ref>'
      expect(normalizeAngleBrackets(input)).toBe(`${L}word${R} <ref>I</ref>`)
    })
    it('preserves multiple XML tags while replacing all angle bracket variants', () => {
      const input = '<note>abc</note> ‹Greek text›'
      expect(normalizeAngleBrackets(input)).toBe(`<note>abc</note> ${L}Greek text${R}`)
    })
    it('handles angle bracket immediately before a tag', () => {
      const input = '〈text〉<pb/>'
      expect(normalizeAngleBrackets(input)).toBe(`${L}text${R}<pb/>`)
    })
  })

  describe('edge cases', () => {
    it('empty string returns empty string', () => {
      expect(normalizeAngleBrackets('')).toBe('')
    })
    it('string with no angle brackets is unchanged', () => {
      expect(normalizeAngleBrackets('plain text')).toBe('plain text')
    })
    it('multiple angle bracket pairs are all replaced', () => {
      expect(normalizeAngleBrackets('〈a〉 〈b〉')).toBe(`${L}a${R} ${L}b${R}`)
    })
  })
})

describe('patchOutput', () => {
  const L = '⟨'
  const R = '⟩'

  it('applies hyphen normalization', () => {
    expect(patchOutput('foo–bar')).toBe('foo-bar')
  })
  it('applies angle bracket normalization', () => {
    expect(patchOutput('〈text〉')).toBe(`${L}text${R}`)
  })
  it('trims leading and trailing whitespace', () => {
    expect(patchOutput('  hello  ')).toBe('hello')
  })
  it('applies both normalizations and trims in one call', () => {
    expect(patchOutput('  〈a〉 foo–bar  ')).toBe(`${L}a${R} foo-bar`)
  })
  it('empty string returns empty string', () => {
    expect(patchOutput('')).toBe('')
  })
  it('whitespace-only returns empty string after trim', () => {
    expect(patchOutput('   ')).toBe('')
  })
})
