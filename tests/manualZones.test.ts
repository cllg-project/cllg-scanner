import { describe, it, expect } from 'vitest'
import { linesInRect, blockTagForRole } from '../src/renderer/src/utils/manualZones'
import type { LineGeometry } from '../src/shared/types'

function line(id: string, polygon: [number, number][]): LineGeometry {
  return { id, polygon, source: 'kraken' }
}

describe('linesInRect', () => {
  it('includes a line whose polygon centroid falls inside the rect', () => {
    const lines = [line('a', [[10, 10], [20, 10], [20, 20], [10, 20]])]
    expect(linesInRect({ x: 0, y: 0, width: 30, height: 30 }, lines)).toEqual(['a'])
  })

  it('excludes a line whose centroid falls outside the rect', () => {
    const lines = [line('a', [[100, 100], [120, 100], [120, 120], [100, 120]])]
    expect(linesInRect({ x: 0, y: 0, width: 30, height: 30 }, lines)).toEqual([])
  })

  it('includes only lines whose centroid is inside, preserving input order', () => {
    const lines = [
      line('a', [[10, 10], [20, 10], [20, 20], [10, 20]]),
      line('b', [[200, 200], [220, 200], [220, 220], [200, 220]]),
      line('c', [[12, 12], [22, 12], [22, 22], [12, 22]]),
    ]
    expect(linesInRect({ x: 0, y: 0, width: 30, height: 30 }, lines)).toEqual(['a', 'c'])
  })

  it('treats rect edges as inclusive', () => {
    const lines = [line('a', [[10, 10], [10, 10], [10, 10], [10, 10]])]
    expect(linesInRect({ x: 10, y: 10, width: 0, height: 0 }, lines)).toEqual(['a'])
  })
})

describe('blockTagForRole', () => {
  it('maps the "continuation" zone role to md2tei.ts\'s "continued" block tag', () => {
    // Regression: wrapping with the role name directly (<continuation>) produces a tag
    // buildBody() doesn't recognize, so the continuation silently fails to merge and the
    // literal tag leaks into the exported TEI as escaped text.
    expect(blockTagForRole('continuation')).toBe('continued')
  })

  it('passes p/quote/head through unchanged — they already match the block tag name', () => {
    expect(blockTagForRole('p')).toBe('p')
    expect(blockTagForRole('quote')).toBe('quote')
    expect(blockTagForRole('head')).toBe('head')
  })
})
