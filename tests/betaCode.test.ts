import { describe, it, expect } from 'vitest'
import { convertBetaKey, finalSigmaFix } from '@renderer/utils/betaCode'

function press(keys: string): string | null {
  const pending = new Set<string>()
  let last: string | null = null
  for (const key of keys) {
    const r = convertBetaKey(key, pending)
    last = r.char
  }
  return last
}

describe('convertBetaKey', () => {
  describe('basic letter conversions (no pending modifiers)', () => {
    it('a → α', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('a', pending)).toEqual({ char: 'α', isPending: false })
    })
    it('b → β', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('b', pending)).toEqual({ char: 'β', isPending: false })
    })
    it('g → γ', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('g', pending)).toEqual({ char: 'γ', isPending: false })
    })
    it('s → σ', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('s', pending)).toEqual({ char: 'σ', isPending: false })
    })
    it('w → ω', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('w', pending)).toEqual({ char: 'ω', isPending: false })
    })
    it('S → Σ (uppercase)', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('S', pending)).toEqual({ char: 'Σ', isPending: false })
    })
    it('A → Α (uppercase alpha)', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('A', pending)).toEqual({ char: 'Α', isPending: false })
    })
    it('W → Ω (uppercase omega)', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('W', pending)).toEqual({ char: 'Ω', isPending: false })
    })
  })

  describe('modifier keys accumulate into pending', () => {
    it(') returns isPending=true and char=null', () => {
      const pending = new Set<string>()
      expect(convertBetaKey(')', pending)).toEqual({ char: null, isPending: true })
      expect(pending.has(')')).toBe(true)
    })
    it('( returns isPending=true', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('(', pending)).toEqual({ char: null, isPending: true })
    })
    it('/ returns isPending=true', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('/', pending)).toEqual({ char: null, isPending: true })
    })
    it('\\ returns isPending=true', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('\\', pending)).toEqual({ char: null, isPending: true })
    })
    it('= returns isPending=true', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('=', pending)).toEqual({ char: null, isPending: true })
    })
    it('+ returns isPending=true', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('+', pending)).toEqual({ char: null, isPending: true })
    })
    it('| returns isPending=true', () => {
      const pending = new Set<string>()
      expect(convertBetaKey('|', pending)).toEqual({ char: null, isPending: true })
    })
    it('same modifier pressed twice does not duplicate (Set semantics)', () => {
      const pending = new Set<string>()
      convertBetaKey(')', pending)
      convertBetaKey(')', pending)
      expect(pending.size).toBe(1)
    })
  })

  describe('vowel + modifier → precomposed character', () => {
    it(') then a → ἀ (smooth breathing)', () => {
      expect(press(')a')).toBe('ἀ')
    })
    it('( then a → ἁ (rough breathing)', () => {
      expect(press('(a')).toBe('ἁ')
    })
    it('/ then a → ά (acute)', () => {
      expect(press('/a')).toBe('ά')
    })
    it('\\ then a → ὰ (grave)', () => {
      expect(press('\\a')).toBe('ὰ')
    })
    it('= then a → ᾶ (circumflex)', () => {
      expect(press('=a')).toBe('ᾶ')
    })
    it('+ then i → ϊ (diaeresis on iota)', () => {
      expect(press('+i')).toBe('ϊ')
    })
    it('| then a → ᾳ (iota subscript on alpha)', () => {
      expect(press('|a')).toBe('ᾳ')
    })
    it('( then / then a → ἅ (rough breathing + acute)', () => {
      expect(press('(/a')).toBe('ἅ')
    })
    it(') then = then a → ἆ (smooth breathing + circumflex)', () => {
      expect(press(')=a')).toBe('ἆ')
    })
    it('modifier order does not matter: /) and )/ both give ἄ', () => {
      expect(press(')/a')).toBe('ἄ')
      expect(press('/)a')).toBe('ἄ')
    })
    it('( then A → Ἁ (rough breathing uppercase alpha)', () => {
      expect(press('(A')).toBe('Ἁ')
    })
    it('= then w → ῶ (circumflex on omega)', () => {
      expect(press('=w')).toBe('ῶ')
    })
    it('( then r → ῥ (rough breathing on rho)', () => {
      expect(press('(r')).toBe('ῥ')
    })
  })

  describe('consonant with pending modifiers — modifiers flushed, base consonant emitted', () => {
    it(') then b → β (modifier flushed, consonant returned as-is)', () => {
      expect(press(')b')).toBe('β')
    })
    it('( then g → γ', () => {
      expect(press('(g')).toBe('γ')
    })
    it('pending is cleared after consonant', () => {
      const pending = new Set<string>()
      convertBetaKey(')', pending)
      convertBetaKey('b', pending)
      expect(pending.size).toBe(0)
    })
  })

  describe('non-letter key — pending flushed, char=null returned', () => {
    it('space with pending modifiers: modifiers cleared, char=null', () => {
      const pending = new Set<string>()
      convertBetaKey(')', pending)
      const r = convertBetaKey(' ', pending)
      expect(r).toEqual({ char: null, isPending: false })
      expect(pending.size).toBe(0)
    })
    it('digit with no pending: char=null', () => {
      const pending = new Set<string>()
      const r = convertBetaKey('1', pending)
      expect(r).toEqual({ char: null, isPending: false })
    })
  })
})

describe('finalSigmaFix', () => {
  it('replaces σ before a space with ς', () => {
    expect(finalSigmaFix('λόγος λόγος')).toBe('λόγος λόγος')
  })
  it('replaces σ before a period with ς', () => {
    expect(finalSigmaFix('λόγος.')).toBe('λόγος.')
  })
  it('replaces σ before a semicolon with ς', () => {
    expect(finalSigmaFix('λόγος;')).toBe('λόγος;')
  })
  it('replaces σ before an ASCII comma with ς', () => {
    expect(finalSigmaFix('λόγος,')).toBe('λόγος,')
  })
  it('does NOT replace σ in the middle of a word', () => {
    expect(finalSigmaFix('ἐσθίω')).toBe('ἐσθίω')
  })
  it('does NOT replace σ at end of string (lookahead requires a following char)', () => {
    // Per function comment: conversion at end-of-string happens via onChange event
    expect(finalSigmaFix('λόγος')).toBe('λόγος')
  })
  it('handles multiple words: each word-final σ replaced', () => {
    expect(finalSigmaFix('λόγος καὶ νόμος εἰσίν')).toBe('λόγος καὶ νόμος εἰσίν')
  })
  it('mid-word σ in a multi-word string is not touched', () => {
    expect(finalSigmaFix('ἔσχεσ εἶπον')).toBe('ἔσχες εἶπον')
  })
  it('ς (already final form) is unchanged', () => {
    expect(finalSigmaFix('λόγος ')).toBe('λόγος ')
  })
  it('Σ (uppercase) is unchanged', () => {
    expect(finalSigmaFix('Σοφία ')).toBe('Σοφία ')
  })
  it('empty string returns empty string', () => {
    expect(finalSigmaFix('')).toBe('')
  })
})
