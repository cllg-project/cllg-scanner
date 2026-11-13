import { describe, it, expect } from 'vitest'
import { lineConfidence, lowConfidenceRanges } from '../src/shared/confidence'
import type { LineGeometry } from '../src/shared/types'

const chars = (s: string, confs: number[]) => [...s].map((char, i) => ({ char, conf: confs[i] }))

describe('lineConfidence', () => {
  it('stores 0–100 integers per UTF-16 unit', () => {
    expect(lineConfidence('ab', chars('ab', [0.991, 0.5]))).toEqual({ text: 'ab', c: [99, 50] })
  })
  it('drops confidences that do not line up with the text', () => {
    expect(lineConfidence('abc', chars('ab', [1, 1]))).toBeUndefined()
  })
})

describe('lowConfidenceRanges', () => {
  const geo = (text: string, confs: number[]): LineGeometry => ({
    id: 'k0', polygon: [], source: 'kraken', text, conf: lineConfidence(text, chars(text, confs)),
  })
  it('marks doubtful characters, merged, skipping spaces', () => {
    const md = '<pb n="1"/>\n<lb n="k0"/>ab cd ef\n'
    const g = geo('ab cd ef', [1, 0.2, 1, 0.3, 0.3, 1, 1, 1])
    const start = md.indexOf('ab cd')
    expect(lowConfidenceRanges(md, [g], 0.85)).toEqual([{ start: start + 1, end: start + 2 }, { start: start + 3, end: start + 5 }])
  })
  it('shows nothing once the line has been edited', () => {
    const md = '<lb n="k0"/>ab cd XX\n'
    expect(lowConfidenceRanges(md, [geo('ab cd ef', [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])], 0.85)).toEqual([])
  })
})
