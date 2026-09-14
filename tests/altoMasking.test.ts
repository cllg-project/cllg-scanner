import { describe, it, expect } from 'vitest'
import { regionsToMasks } from '../src/renderer/src/utils/altoMasking'
import type { AltoLine } from '../src/shared/types'

describe('regionsToMasks', () => {
  it('ignores lines with no regionType', () => {
    const lines: AltoLine[] = [{ polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }]
    expect(regionsToMasks(lines)).toEqual([])
  })

  it('ignores lines whose regionType is not a margin type', () => {
    const lines: AltoLine[] = [{ polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], regionType: 'main' }]
    expect(regionsToMasks(lines)).toEqual([])
  })

  it('produces one bounding-rect mask per margin region', () => {
    const lines: AltoLine[] = [
      { polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], regionType: 'main' },
      { polygon: [[100, 0], [150, 0], [150, 20], [100, 20]], regionType: 'margin' },
      { polygon: [[100, 30], [160, 30], [160, 50], [100, 50]], regionType: 'margin' },
    ]
    const masks = regionsToMasks(lines)
    expect(masks).toHaveLength(1)
    expect(masks[0]).toEqual({ x: 100, y: 0, width: 60, height: 50, fill: '#ffffff' })
  })

  it('respects a custom marginRegionTypes list', () => {
    const lines: AltoLine[] = [{ polygon: [[0, 0], [20, 0], [20, 20], [0, 20]], regionType: 'illustration' }]
    expect(regionsToMasks(lines, ['illustration'])).toEqual([
      { x: 0, y: 0, width: 20, height: 20, fill: '#ffffff' },
    ])
    expect(regionsToMasks(lines)).toEqual([])
  })
})
