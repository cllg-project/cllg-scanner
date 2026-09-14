import { describe, it, expect } from 'vitest'
import { stripPseudoTags, zonesToPseudoTaggedText } from '../src/main/pageExportFormats'
import { groupIntoZones } from '../src/main/ladas'

describe('stripPseudoTags', () => {
  it('removes every tag, including <lb n> anchors, leaving plain text', () => {
    const md = '<p>\n<lb n="k0"/>First line\n<lb n="k1"/>second line\n</p>\n'
    expect(stripPseudoTags(md)).toBe('\nFirst line\nsecond line\n\n')
  })

  it('strips <ref>/<note> tags too', () => {
    const md = '<ref level="1">I</ref> text with <note>a note</note>.'
    expect(stripPseudoTags(md)).toBe('I text with a note.')
  })
})

describe('zonesToPseudoTaggedText', () => {
  it('emits one self-closing marker at the start of each zone, reusing the real LADaS LABEL string', () => {
    const zones = groupIntoZones([
      { id: 'k0', blockId: 'tb1', regionType: 'MainZone:P', text: 'First line' },
      { id: 'k1', blockId: 'tb1', regionType: 'MainZone:P', text: 'second line' },
      { id: 'k2', blockId: 'tb2', regionType: 'MainZone:PQuoted', text: 'a quote' },
      { id: 'k3', blockId: 'tb3', regionType: 'MainZone:Head', text: 'A Heading' },
    ])
    expect(zonesToPseudoTaggedText(zones)).toBe(
      '<MainZone-P/>First line\nsecond line\n' +
      '<MainZone-PQuoted/>a quote\n' +
      '<MainZone-Head/>A Heading'
    )
  })

  it('never repeats the marker mid-zone, even across several physical lines', () => {
    const zones = groupIntoZones([
      { id: 'k0', blockId: 'tb1', regionType: 'MainZone:P', text: 'one' },
      { id: 'k1', blockId: 'tb1', regionType: 'MainZone:P', text: 'two' },
      { id: 'k2', blockId: 'tb1', regionType: 'MainZone:P', text: 'three' },
    ])
    expect((zonesToPseudoTaggedText(zones).match(/<MainZone-P\/>/g) ?? []).length).toBe(1)
  })

  it('falls back to <MainZone-P/> for zones with no recognized LADaS role', () => {
    const zones = groupIntoZones([{ id: 'k0', text: 'plain line' }])
    expect(zonesToPseudoTaggedText(zones)).toBe('<MainZone-P/>plain line')
  })
})
