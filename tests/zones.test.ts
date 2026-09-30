import { describe, it, expect } from 'vitest'
import type { PageZone } from '../src/shared/types'
import { blockTagForType, migratePageZones, writeZoneTags } from '../src/shared/zones'
import { blockAt, findBlocks } from '../src/shared/lbAnchors'

const zone = (id: string, type: string, lineIds: string[], source: PageZone['source'] = 'dfine'): PageZone => ({
  id, type, lineIds, source, rect: { x: 0, y: 0, width: 1, height: 1 },
})

describe('blockTagForType', () => {
  it('maps block types to their tag and leaves the others unwrapped', () => {
    expect(blockTagForType('MainZone-P')).toBe('p')
    expect(blockTagForType('MainZone-PQuoted')).toBe('quote')
    expect(blockTagForType('MainZone-Head')).toBe('head')
    expect(blockTagForType('MainZone-Continued#latin')).toBe('continued')
    expect(blockTagForType('MainZone-Lg')).toBe('p')
    expect(blockTagForType('MarginTextZone')).toBeNull()
    expect(blockTagForType('RunningTitleZone')).toBeNull()
  })
})

describe('writeZoneTags', () => {
  const md = '<pb n="1"/>\n<lb n="a"/>one\n<lb n="b"/>two\n<lb n="c"/>three\n'

  it('retyping a zone swaps its tag', () => {
    const p = writeZoneTags(md, zone('r0', 'MainZone-P', ['a', 'b']))
    expect(p.markdown).toBe('<pb n="1"/>\n<p zone="r0">\n<lb n="a"/>one\n<lb n="b"/>two\n</p>\n<lb n="c"/>three\n')
    const h = writeZoneTags(p.markdown, zone('r0', 'MainZone-Head', ['a', 'b']), zone('r0', 'MainZone-P', ['a', 'b']))
    expect(h.markdown).toBe('<pb n="1"/>\n<head zone="r0">\n<lb n="a"/>one\n<lb n="b"/>two\n</head>\n<lb n="c"/>three\n')
    const none = writeZoneTags(h.markdown, zone('r0', 'RunningTitleZone', ['a', 'b']))
    expect(none.markdown).toBe(md)
    expect(none.wrapped).toBe(false)
  })

  it('never nests inside a wrapper that holds more than the zone', () => {
    const wrapped = '<pb n="1"/>\n<p>\n<lb n="a"/>one\n<lb n="b"/>two\n<lb n="c"/>three\n</p>\n'
    const r = writeZoneTags(wrapped, zone('r0', 'MainZone-P', ['b']))
    expect(r.wrapped).toBe(false)
    expect(r.markdown).toBe(wrapped)
  })
})

describe('findBlocks / blockAt', () => {
  it('finds wrappers with their zone ids and the one around a position', () => {
    const md = '<pb n="1"/>\n<p zone="r0">\n<lb n="a"/>one\n</p>\n<lb n="c"/>three\n'
    const blocks = findBlocks(md)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].zoneId).toBe('r0')
    expect(md.slice(blocks[0].innerStart, blocks[0].innerEnd)).toBe('<lb n="a"/>one')
    expect(blockAt(md, md.indexOf('one'))?.zoneId).toBe('r0')
    expect(blockAt(md, md.indexOf('three'))).toBeNull()
  })
})

describe('migratePageZones', () => {
  it('moves legacy hand-drawn zones into zones, once', () => {
    const page = {
      n: 1,
      manualZones: [{ id: 'mz-1', role: 'quote' as const, rect: { x: 1, y: 2, width: 3, height: 4 }, lineIds: ['a'] }],
    }
    const out = migratePageZones(page)
    expect(out).toEqual({
      n: 1,
      zones: [{ id: 'mz-1', type: 'MainZone-PQuoted', rect: { x: 1, y: 2, width: 3, height: 4 }, lineIds: ['a'], source: 'manual' }],
    })
    expect(migratePageZones(out)).toBe(out)
  })
})
