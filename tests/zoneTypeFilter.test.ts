import { describe, it, expect } from 'vitest'
import { filterZoneTypes, type ZoneTypeOption } from '../src/renderer/src/utils/zoneTypeFilter'

const options: ZoneTypeOption[] = [
  { type: 'MainZone-P', shortcut: 'P' },
  { type: 'MainZone-PQuoted', shortcut: 'Q' },
  { type: 'MainZone-Head', shortcut: 'H' },
  { type: 'MainZone-Continued', shortcut: 'C' },
  { type: 'MarginTextZone-Notes' },
  { type: 'RunningTitleZone' },
  { type: 'GraphicZone-Head' },
  { type: 'TableZone-Head' },
]
const types = (q: string): string[] => filterZoneTypes(options, q).map((o) => o.type)

describe('filterZoneTypes', () => {
  it('returns every option, in order, for an empty query', () => {
    expect(types('')).toEqual(options.map((o) => o.type))
    expect(types('  - ')).toEqual(options.map((o) => o.type))
  })

  it('puts the option whose shortcut was typed first', () => {
    expect(types('q')[0]).toBe('MainZone-PQuoted')
    expect(types('h')[0]).toBe('MainZone-Head')
  })

  it('matches the Level-2 part as a prefix, ignoring case and separators', () => {
    expect(types('head')).toEqual(['MainZone-Head', 'GraphicZone-Head', 'TableZone-Head'])
    expect(types('mainzone head')).toEqual(['MainZone-Head'])
    expect(types('RUNNING')).toEqual(['RunningTitleZone'])
  })

  it('ranks prefix matches before substring and in-order letter matches', () => {
    expect(types('notes')).toEqual(['MarginTextZone-Notes'])
    expect(types('title')).toEqual(['RunningTitleZone'])
    expect(types('mzh')).toEqual(['MainZone-Head'])
  })

  it('returns nothing when no type matches', () => {
    expect(types('xyz')).toEqual([])
  })
})
