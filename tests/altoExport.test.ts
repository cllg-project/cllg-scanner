import { describe, it, expect } from 'vitest'
import { buildAltoXml, approximateBaseline, textByAnchor } from '../src/main/altoExport'
import type { Page, LineGeometry, ManualZoneGroup } from '../src/shared/types'

function line(overrides: Partial<LineGeometry> & { id: string }): LineGeometry {
  return {
    polygon: [[0, 0], [100, 0], [100, 20], [0, 20]],
    source: 'kraken',
    ...overrides,
  }
}

function page(overrides: Partial<Page> = {}): Page {
  return {
    n: 1,
    imagePath: 'pages/page_0001.png',
    masks: [],
    status: 'ocr_done',
    ...overrides,
  }
}

describe('approximateBaseline', () => {
  it('returns a 2-point segment between the midpoints of the short edges', () => {
    const polygon: [number, number][] = [[0, 0], [100, 0], [100, 20], [0, 20]]
    expect(approximateBaseline(polygon)).toEqual([[0, 10], [100, 10]])
  })
})

describe('textByAnchor', () => {
  it('extracts the plain text following each <lb n> anchor', () => {
    const md = '<p>\n<lb n="k0"/>First line\n<lb n="k1"/>second line\n</p>\n'
    const map = textByAnchor(md)
    expect(map.get('k0')).toBe('First line')
    expect(map.get('k1')).toBe('second line')
  })

  it('strips a trailing block-close tag from the last anchor on that line', () => {
    const md = '<quote><lb n="k0"/>quoted text</quote>'
    expect(textByAnchor(md).get('k0')).toBe('quoted text')
  })
})

describe('buildAltoXml', () => {
  it('groups lines into TextBlocks by blockId, typed via TAGREFS + <Tags><OtherTag LABEL>', () => {
    const p = page({
      lineGeometry: [
        line({ id: 'l1', blockId: 'tb1', regionType: 'MainZone:P', text: 'a' }),
        line({ id: 'l2', blockId: 'tb1', regionType: 'MainZone:P', text: 'b' }),
      ],
    })
    const xml = buildAltoXml(p)
    expect(xml).toContain('<OtherTag ID="BT1" LABEL="MainZone-P"/>')
    expect(xml).toContain('<TextBlock ID="tb1" TAGREFS="BT1">')
    expect(xml).not.toContain('TYPE=')
    expect(xml).toContain('<TextLine ID="l1">')
    expect(xml).toContain('<TextLine ID="l2">')
    expect(xml).toContain('CONTENT="a"')
    expect(xml).toContain('CONTENT="b"')
  })

  it('merges adjacent same-role blocks into one TextBlock, regardless of the original blockId', () => {
    // Real ALTO sources routinely segment one logical paragraph into several
    // consecutive same-typed TextBlocks (e.g. one block per transcribed line).
    const p = page({
      lineGeometry: [
        line({ id: 'l1', blockId: 'tb1', regionType: 'MainZone:P', text: 'a' }),
        line({ id: 'l2', blockId: 'tb2', regionType: 'MainZone:P', text: 'b' }),
      ],
    })
    const xml = buildAltoXml(p)
    expect((xml.match(/<TextBlock/g) ?? []).length).toBe(1)
    expect(xml).toContain('<TextBlock ID="tb1" TAGREFS="BT1">')
    expect(xml).toContain('<TextLine ID="l1">')
    expect(xml).toContain('<TextLine ID="l2">')
  })

  it('defines one <OtherTag> per distinct label, shared by every TextBlock using it', () => {
    const p = page({
      lineGeometry: [
        line({ id: 'l1', blockId: 'tb1', regionType: 'MainZone:P', text: 'a' }),
        line({ id: 'l2', blockId: 'tb2', regionType: 'MainZone:Head', text: 'b' }),
        line({ id: 'l3', blockId: 'tb3', regionType: 'MainZone:P', text: 'c' }),
      ],
    })
    const xml = buildAltoXml(p)
    expect((xml.match(/<OtherTag/g) ?? []).length).toBe(2)
    expect(xml).toContain('<TextBlock ID="tb1" TAGREFS="BT1">')
    expect(xml).toContain('<TextBlock ID="tb2" TAGREFS="BT2">')
    expect(xml).toContain('<TextBlock ID="tb3" TAGREFS="BT1">')
  })

  it('uses verbatim baseline points for ALTO-sourced lines', () => {
    const p = page({
      lineGeometry: [
        line({
          id: 'l1', blockId: 'tb1', regionType: 'MainZone:P', text: 'a', source: 'alto',
          baseline: [[5, 15], [95, 15]],
        }),
      ],
    })
    const xml = buildAltoXml(p)
    expect(xml).toContain('<Baseline POINTS="5,15 95,15"/>')
  })

  it('approximates a baseline for Kraken-derived geometry with none archived', () => {
    const p = page({
      lineGeometry: [line({ id: 'l1', blockId: 'tb1', regionType: 'MainZone:P', text: 'a' })],
    })
    const xml = buildAltoXml(p)
    expect(xml).toContain('<Baseline POINTS="0,10 100,10"/>')
  })

  it('a ManualZoneGroup override wins over the line\'s own classified role', () => {
    const p = page({
      lineGeometry: [line({ id: 'l1', blockId: 'tb1', text: 'a' })], // no regionType -> 'unknown' by default
      manualZones: [{ id: 'mz1', role: 'quote', rect: { x: 0, y: 0, width: 10, height: 10 }, lineIds: ['l1'] }] as ManualZoneGroup[],
    })
    const xml = buildAltoXml(p)
    expect(xml).toContain('<OtherTag ID="BT1" LABEL="MainZone-PQuoted"/>')
    expect(xml).toContain('TAGREFS="BT1"')
  })

  it('reflects corrected text from the anchor map when correctedMarkdown is supplied', () => {
    const p = page({
      lineGeometry: [line({ id: 'k0', blockId: 'tb1', text: 'original text' })],
    })
    const corrected = '<p>\n<lb n="k0"/>corrected text\n</p>\n'
    const xml = buildAltoXml(p, corrected)
    expect(xml).toContain('CONTENT="corrected text"')
    expect(xml).not.toContain('CONTENT="original text"')
  })

  it('falls back to archived text when the corrected markdown is missing that anchor', () => {
    const p = page({
      lineGeometry: [line({ id: 'k0', blockId: 'tb1', text: 'archived text' })],
    })
    // corrected markdown never mentions k0's anchor at all (e.g. deleted during editing)
    const corrected = '<p>\nno anchors here\n</p>\n'
    const xml = buildAltoXml(p, corrected)
    expect(xml).toContain('CONTENT="archived text"')
  })

  it('escapes attribute-breaking characters in text content', () => {
    const p = page({
      lineGeometry: [line({ id: 'k0', blockId: 'tb1', text: 'quote " and amp &' })],
    })
    const xml = buildAltoXml(p)
    expect(xml).toContain('CONTENT="quote &quot; and amp &amp;"')
  })
})
