import { describe, it, expect } from 'vitest'
import { scanRefs } from '../src/main/ipc/md2tei'

describe('scanRefs', () => {
  it('returns [] for empty string', () => {
    expect(scanRefs('')).toEqual([])
  })

  it('returns [] when no [token] markers are present', () => {
    expect(scanRefs('plain text without any markers')).toEqual([])
  })

  it('classifies Roman numeral tokens', () => {
    const results = scanRefs('[I] [II] [IV] [X]')
    const roman = results.find(r => r.format === 'Roman')
    expect(roman).toBeDefined()
    expect(roman!.count).toBe(4)
    expect(roman!.sample).toContain('I')
    expect(roman!.sample).toContain('II')
  })

  it('classifies Arabic numeral tokens', () => {
    const results = scanRefs('[1] [2] [3]')
    const arabic = results.find(r => r.format === 'Arabic')
    expect(arabic).toBeDefined()
    expect(arabic!.count).toBe(3)
  })

  it('classifies Greek letter tokens', () => {
    const results = scanRefs('[α] [β] [γ]')
    const greek = results.find(r => r.format === 'Greek')
    expect(greek).toBeDefined()
    expect(greek!.count).toBe(3)
    expect(greek!.sample).toContain('α')
  })

  it('classifies Alpha (lowercase letter) tokens', () => {
    // Note: 'c' matches Roman numerals (C=100), so use letters that don't: a, b, e
    const results = scanRefs('[a] [b] [e]')
    const alpha = results.find(r => r.format === 'Alpha')
    expect(alpha).toBeDefined()
    expect(alpha!.count).toBe(3)
  })

  it('returns multiple buckets when multiple formats are present', () => {
    const results = scanRefs('[I] [II] [1] [2] [3]')
    expect(results.length).toBeGreaterThanOrEqual(2)
    const formats = results.map(r => r.format)
    expect(formats).toContain('Roman')
    expect(formats).toContain('Arabic')
  })

  it('sorts results by count descending', () => {
    // 3 Arabic + 1 Roman → Arabic should come first
    const results = scanRefs('[1] [2] [3] [I]')
    expect(results[0].format).toBe('Arabic')
  })

  it('ignores tokens longer than 20 characters', () => {
    const longToken = '[' + 'x'.repeat(21) + ']'
    const results = scanRefs(longToken)
    expect(results).toEqual([])
  })

  it('deduplicates: same token counted only once in the bucket', () => {
    // [I] appears 3 times but count is distinct values → still 1
    const results = scanRefs('[I] [I] [I]')
    const roman = results.find(r => r.format === 'Roman')
    expect(roman!.count).toBe(1)
  })

  it('sample is capped at 8 entries for large inputs', () => {
    const tokens = Array.from({ length: 15 }, (_, i) => `[${i + 1}]`).join(' ')
    const results = scanRefs(tokens)
    const arabic = results.find(r => r.format === 'Arabic')
    expect(arabic!.sample.length).toBeLessThanOrEqual(8)
  })

  it('sample is sorted by frequency descending', () => {
    // [II] appears 3 times, [I] appears once → [II] should come first in sample
    const results = scanRefs('[I] [II] [II] [II]')
    const roman = results.find(r => r.format === 'Roman')
    expect(roman!.sample[0]).toBe('II')
  })

  it('ignores tokens that do not match any known format', () => {
    // Mixed uppercase/lowercase that doesn't match Roman, Arabic, Greek, or Alpha
    const results = scanRefs('[Hello] [World123]')
    expect(results).toEqual([])
  })

  it('handles text with both markers and plain text correctly', () => {
    const md = 'Some text [I] more text [1] end'
    const results = scanRefs(md)
    const formats = results.map(r => r.format)
    expect(formats).toContain('Roman')
    expect(formats).toContain('Arabic')
  })
})
