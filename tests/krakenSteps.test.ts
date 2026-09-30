import { describe, it, expect } from 'vitest'
import type { LineGeometry, PageZone } from '../src/shared/types'
import { applyLineStep, applyTextStep, applyZoneStep, matchLines, type ProcessedLine } from '../src/main/krakenSteps'
import type { DetectedRegion } from '../src/main/regionMerge'

type P = [number, number][]
const box = (x0: number, y0: number, x1: number, y1: number): P => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const geo = (id: string, polygon: P, extra: Partial<LineGeometry> = {}): LineGeometry => ({ id, polygon, source: 'kraken', ...extra })
const region = (type: string, x0: number, y0: number, x1: number, y1: number): DetectedRegion => ({ type, bbox: [x0, y0, x1, y1] })

// A heading and a two-line paragraph, already OCRed and corrected by hand.
const geometry: LineGeometry[] = [
  geo('k0', box(100, 100, 800, 130), { text: 'Chaptr' }),
  geo('k1', box(100, 200, 800, 230), { text: 'frist line' }),
  geo('k2', box(100, 240, 800, 270), { text: 'second line' }),
]
const corrected = '<pb n="1"/>\n<lb n="k0"/>Chapter\n<lb n="k1"/>first line\n<lb n="k2"/>second line\n\n'
const regions = [region('MainZone-Head', 90, 90, 810, 140), region('MainZone-P', 90, 190, 810, 280)]

describe('matchLines', () => {
  it('pairs lines one-to-one by box overlap, leaving far lines unmatched', () => {
    const out = matchLines(geometry, [{ polygon: box(102, 201, 801, 231) }, { polygon: box(100, 600, 800, 630) }])
    expect(out.map((l) => l?.id)).toEqual(['k1', undefined])
  })
})

describe('applyZoneStep', () => {
  it('wraps each detected block zone with its zone id and keeps the corrected text', () => {
    const r = applyZoneStep(corrected, geometry, regions)
    expect(r.markdown).toBe(
      '<pb n="1"/>\n<head zone="r0">\n<lb n="k0"/>Chapter\n</head>\n' +
        '<p zone="r1">\n<lb n="k1"/>first line\n<lb n="k2"/>second line\n</p>\n\n'
    )
    expect(r.zones.map((z) => [z.id, z.type, z.lineIds])).toEqual([
      ['r0', 'MainZone-Head', ['k0']],
      ['r1', 'MainZone-P', ['k1', 'k2']],
    ])
    expect(r.geometry.map((l) => [l.blockId, l.regionType])).toEqual([
      ['r0', 'MainZone-Head'],
      ['r1', 'MainZone-P'],
      ['r1', 'MainZone-P'],
    ])
    expect(r.unwrapped).toEqual([])
  })

  it('replaces the untagged paragraphs of an earlier run, and is idempotent', () => {
    const old = '<pb n="1"/>\n<p>\n<lb n="k0"/>Chapter\n<lb n="k1"/>first line\n<lb n="k2"/>second line\n</p>\n\n'
    const once = applyZoneStep(old, geometry, regions)
    expect(once.markdown).toBe(applyZoneStep(corrected, geometry, regions).markdown)
    const twice = applyZoneStep(once.markdown, once.geometry, regions, once.zones)
    expect(twice.markdown).toBe(once.markdown)
  })

  it('keeps hand-drawn zones and their wrappers', () => {
    const manual: PageZone = { id: 'mz-1', type: 'MainZone-PQuoted', rect: { x: 0, y: 0, width: 1, height: 1 }, lineIds: ['k0'], source: 'manual' }
    const md = '<pb n="1"/>\n<quote zone="mz-1">\n<lb n="k0"/>Chapter\n</quote>\n<lb n="k1"/>first line\n<lb n="k2"/>second line\n\n'
    const r = applyZoneStep(md, geometry, regions, [manual])
    expect(r.markdown).toContain('<quote zone="mz-1">\n<lb n="k0"/>Chapter\n</quote>')
    expect(r.markdown).toContain('<p zone="r1">')
    expect(r.zones.map((z) => z.id)).toEqual(['r0', 'r1', 'mz-1'])
    expect(r.unwrapped).toEqual(['r0']) // its line is already in the hand-drawn zone's wrapper
  })

  it('does not wrap a zone whose lines are interleaved with another block zone', () => {
    const lines = [
      geo('k0', box(100, 100, 400, 130)),
      geo('k1', box(500, 100, 800, 130)),
      geo('k2', box(100, 140, 400, 170)),
    ]
    const md = '<pb n="1"/>\n<lb n="k0"/>a\n<lb n="k1"/>b\n<lb n="k2"/>c\n\n'
    const r = applyZoneStep(md, lines, [region('MainZone-P', 90, 90, 410, 180), region('MainZone-P', 490, 90, 810, 140)])
    expect(r.unwrapped).toEqual(['r0'])
    expect(r.markdown).toContain('<p zone="r1">\n<lb n="k1"/>b\n</p>')
    expect(r.zones[0].lineIds).toEqual(['k0', 'k2'])
  })

  it('links non-block zones through their lines only', () => {
    const r = applyZoneStep(corrected, geometry, [region('RunningTitleZone', 90, 90, 810, 140)], [], { RunningTitleZone: 'annotate' })
    expect(r.markdown).toBe(corrected)
    expect(r.zones[0].lineIds).toEqual(['k0'])
    expect(r.unwrapped).toEqual([])
  })

  it('makes zones only of the region types the policy annotates, without touching the text', () => {
    expect(applyZoneStep(corrected, geometry, [region('RunningTitleZone', 90, 90, 810, 140)]).zones).toEqual([])
    const r = applyZoneStep(corrected, geometry, regions, [], { 'MainZone-P': 'keep' })
    expect(r.zones.map((z) => z.id)).toEqual(['r0'])
    expect(r.markdown).toBe('<pb n="1"/>\n<head zone="r0">\n<lb n="k0"/>Chapter\n</head>\n<lb n="k1"/>first line\n<lb n="k2"/>second line\n\n')
  })
})

describe('applyLineStep', () => {
  it('keeps matched lines\' ids and corrected text, inserts new lines, drops unmatched geometry', () => {
    const processed: ProcessedLine[] = [
      { text: 'Chaptr', polygon: box(101, 101, 801, 131), type: 'default' },
      { text: 'a new line', polygon: box(100, 150, 800, 180), type: 'default' },
      { text: 'frist line', polygon: box(100, 199, 800, 229), type: 'default' },
    ]
    const r = applyLineStep(corrected, geometry, processed)
    expect(r.geometry.map((l) => l.id)).toEqual(['k0', 'k3', 'k1'])
    expect(r.geometry[0].polygon).toEqual(processed[0].polygon)
    expect(r.newLines).toBe(1)
    expect(r.orphanLines).toBe(1)
    expect(r.markdown).toBe('<pb n="1"/>\n<lb n="k0"/>Chapter\n<lb n="k3"/>a new line\n<lb n="k1"/>first line\n<lb n="k2"/>second line\n\n')
  })

  it('recomputes zone lines and rewrites their tags', () => {
    const zoned = applyZoneStep(corrected, geometry, regions)
    const processed: ProcessedLine[] = [
      ...geometry.map((l) => ({ text: l.text ?? '', polygon: l.polygon })),
      { text: 'third line', polygon: box(100, 250, 800, 278) },
    ]
    const r = applyLineStep(zoned.markdown, zoned.geometry, processed, zoned.zones)
    expect(r.zones[1].lineIds).toEqual(['k1', 'k2', 'k3'])
    expect(r.markdown).toContain('<p zone="r1">\n<lb n="k1"/>first line\n<lb n="k2"/>second line\n<lb n="k3"/>third line\n</p>')
  })
})

describe('applyTextStep', () => {
  it('replaces matched lines\' text and keeps margin markup around it', () => {
    const md = '<pb n="1"/>\n<p zone="r1">\n<lb n="k1"/><ref>5</ref>first line <note>cf.</note>\n<lb n="k2"/>second line\n</p>\n\n'
    const r = applyTextStep(md, geometry, [
      { text: 'FIRST', polygon: geometry[1].polygon },
      { text: 'elsewhere', polygon: box(0, 900, 50, 950) },
    ])
    expect(r.markdown).toBe('<pb n="1"/>\n<p zone="r1">\n<lb n="k1"/><ref>5</ref>FIRST <note>cf.</note>\n<lb n="k2"/>second line\n</p>\n\n')
    expect(r.textLines).toBe(1)
    expect(r.unmatched).toBe(1)
  })

  it('replaces the inside of a LADaS margin note line', () => {
    const md = '<pb n="1"/>\n<lb n="k0"/><note zone="r3">old</note>\n\n'
    const r = applyTextStep(md, geometry, [{ text: 'new', polygon: geometry[0].polygon }])
    expect(r.markdown).toBe('<pb n="1"/>\n<lb n="k0"/><note zone="r3">new</note>\n\n')
  })
})
