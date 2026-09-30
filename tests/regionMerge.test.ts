import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import {
  assignLinesToRegions,
  mergeRegionLines,
  regionKind,
  regionsToZones,
  suppressOverlappingRegions,
  type BBox as BBoxT,
  type DetectedRegion,
  type PlacedLine,
} from '../src/main/regionMerge'
import { regionLinesToPageMarkdown } from '../src/main/krakenMarkdown'

// A line as an axis-aligned box polygon.
function line(id: string, text: string, x0: number, y0: number, x1: number, y1: number): PlacedLine {
  return { id, text, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] }
}

function region(type: string, x0: number, y0: number, x1: number, y1: number): DetectedRegion {
  return { type, bbox: [x0, y0, x1, y1], score: 0.9 }
}

// A page: running title, a heading, a two-paragraph main column with a margin marker
// beside its second line, and a page number at the bottom. Lines in reading order.
const lines: PlacedLine[] = [
  line('k0', 'RUNNING TITLE', 200, 20, 800, 50),
  line('k1', 'Chapter heading', 200, 100, 800, 130),
  line('k2', 'First paragraph line one', 200, 200, 800, 230),
  line('k3', '5', 60, 240, 120, 270),
  line('k4', 'first paragraph line two', 200, 240, 800, 270),
  line('k5', 'Second paragraph', 200, 320, 800, 350),
  line('k6', '12', 480, 900, 520, 930),
]
const regions: DetectedRegion[] = [
  region('RunningTitleZone', 190, 10, 810, 60),
  region('MainZone-Head', 190, 90, 810, 140),
  region('MainZone-P', 190, 190, 810, 280),
  region('MarginTextZone', 50, 235, 130, 275),
  region('MainZone-P', 190, 310, 810, 360),
  region('NumberingZone', 470, 890, 530, 940),
]

describe('regionKind', () => {
  it('sorts LADaS zone names into main / margin / dropcap / skip / other', () => {
    expect(regionKind('MainZone-P')).toBe('main')
    expect(regionKind('MainZone-Lg')).toBe('main')
    expect(regionKind('MarginTextZone-Notes')).toBe('margin')
    expect(regionKind('DropCapitalZone')).toBe('dropcap')
    expect(regionKind('RunningTitleZone')).toBe('skip')
    expect(regionKind('NumberingZone')).toBe('skip')
    expect(regionKind('CustomZone-Noise')).toBe('skip')
    expect(regionKind('GraphicZone')).toBe('skip')
    expect(regionKind('GraphicZone-FigDesc')).toBe('other')
    expect(regionKind('TableZone')).toBe('other')
    expect(regionKind(undefined)).toBe('other')
  })
})

describe('assignLinesToRegions', () => {
  it('gives each line the type and id of the region covering it', () => {
    const out = assignLinesToRegions(lines, regions)
    expect(out.map((l) => [l.id, l.regionType, l.blockId])).toEqual([
      ['k0', 'RunningTitleZone', 'r0'],
      ['k1', 'MainZone-Head', 'r1'],
      ['k2', 'MainZone-P', 'r2'],
      ['k3', 'MarginTextZone', 'r3'],
      ['k4', 'MainZone-P', 'r2'],
      ['k5', 'MainZone-P', 'r4'],
      ['k6', 'NumberingZone', 'r5'],
    ])
  })

  it('leaves a line no region covers enough untouched', () => {
    const stray = { ...line('k9', 'stray', 900, 500, 1000, 530), regionType: 'default' }
    const [out] = assignLinesToRegions([stray], [region('MainZone-P', 950, 500, 1200, 530)])
    expect(out).toEqual(stray)
  })

  it('prefers the smaller region when two cover a line equally', () => {
    const [out] = assignLinesToRegions(
      [line('k0', 'x', 100, 100, 200, 120)],
      [region('MainZone-P', 0, 0, 1000, 1000), region('MainZone-Head', 90, 90, 210, 130)]
    )
    expect(out.regionType).toBe('MainZone-Head')
    expect(out.blockId).toBe('r1')
  })
})

describe('mergeRegionLines', () => {
  const assigned = assignLinesToRegions(lines, regions)

  it('cllg: drops running title and page number, puts the margin marker inline as <ref>', () => {
    expect(mergeRegionLines(assigned, 'cllg')).toEqual([
      { kind: 'zone', role: 'head', blockId: 'r1', lines: [{ id: 'k1', text: 'Chapter heading' }] },
      {
        kind: 'zone',
        role: 'p',
        blockId: 'r2',
        lines: [
          { id: 'k2', text: 'First paragraph line one' },
          { id: 'k4', text: '<ref>5</ref>first paragraph line two' },
        ],
      },
      { kind: 'zone', role: 'p', blockId: 'r4', lines: [{ id: 'k5', text: 'Second paragraph' }] },
    ])
  })

  it('ladas: keeps the margin as a <note> block after the paragraph it sits in', () => {
    const blocks = mergeRegionLines(assigned, 'ladas')
    expect(blocks.map((b) => (b.kind === 'zone' ? b.role : 'note'))).toEqual(['head', 'p', 'note', 'p'])
    expect(blocks[1].lines.map((l) => l.id)).toEqual(['k2', 'k4'])
    expect(blocks[2]).toEqual({ kind: 'note', blockId: 'r3', lines: [{ id: 'k3', text: '5' }] })
  })

  it('cllg: a long margin text becomes an inline <note> at the end of the line', () => {
    const withNote = assignLinesToRegions(
      [line('k0', 'Main text', 200, 100, 800, 130), line('k1', 'cf. Plato, Republic', 820, 100, 990, 130)],
      [region('MainZone-P', 190, 90, 810, 140), region('MarginTextZone', 815, 90, 1000, 140)]
    )
    expect(mergeRegionLines(withNote, 'cllg')).toEqual([
      { kind: 'zone', role: 'p', blockId: 'r0', lines: [{ id: 'k0', text: 'Main text <note>cf. Plato, Republic</note>' }] },
    ])
  })

  it('glues a drop capital to the start of the main-text line beside it', () => {
    const withCap = assignLinesToRegions(
      [line('k0', 'L', 100, 100, 180, 200), line('k1', 'orem ipsum', 200, 100, 800, 130)],
      [region('DropCapitalZone', 95, 95, 185, 205), region('MainZone-P', 190, 90, 810, 140)]
    )
    for (const type of ['cllg', 'ladas'] as const) {
      expect(mergeRegionLines(withCap, type)).toEqual([
        { kind: 'zone', role: 'p', blockId: 'r1', lines: [{ id: 'k1', text: 'Lorem ipsum' }] },
      ])
    }
  })

  it('keeps other MainZone subtypes as paragraphs and region-less lines bare', () => {
    const mixed = assignLinesToRegions(
      [line('k0', 'Arma virumque cano', 200, 100, 800, 130), line('k1', 'loose', 200, 600, 800, 630)],
      [region('MainZone-Lg', 190, 90, 810, 140)]
    )
    expect(mergeRegionLines(mixed, 'ladas')).toEqual([
      { kind: 'zone', role: 'p', blockId: 'r0', lines: [{ id: 'k0', text: 'Arma virumque cano' }] },
      { kind: 'zone', role: 'unknown', lines: [{ id: 'k1', text: 'loose' }] },
    ])
  })
})

describe('regionLinesToPageMarkdown', () => {
  const assigned = assignLinesToRegions(lines, regions)

  it('renders a CLLG page with <lb> anchors and inline <ref>, each block linked to its zone', () => {
    expect(regionLinesToPageMarkdown(4, assigned, 'cllg')).toBe(
      '<pb n="4"/>\n' +
        '<head zone="r1">\n<lb n="k1"/>Chapter heading\n</head>\n' +
        '<p zone="r2">\n<lb n="k2"/>First paragraph line one\n<lb n="k4"/><ref>5</ref>first paragraph line two\n</p>\n' +
        '<p zone="r4">\n<lb n="k5"/>Second paragraph\n</p>\n\n'
    )
  })

  it('renders a LADaS margin as an anchored <note> line linked to its zone', () => {
    const md = regionLinesToPageMarkdown(4, assigned, 'ladas')
    expect(md).toContain('</p>\n<lb n="k3"/><note zone="r3">5</note>\n<p zone="r4">')
  })
})

describe('regionsToZones', () => {
  it('turns every detected region into a page zone holding its assigned lines', () => {
    const assigned = assignLinesToRegions(lines, regions)
    const zones = regionsToZones(regions, assigned, { RunningTitleZone: 'annotate', NumberingZone: 'annotate' })
    expect(zones).toHaveLength(regions.length)
    expect(zones[2]).toEqual({
      id: 'r2',
      type: 'MainZone-P',
      rect: { x: regions[2].bbox[0], y: regions[2].bbox[1], width: regions[2].bbox[2] - regions[2].bbox[0], height: regions[2].bbox[3] - regions[2].bbox[1] },
      lineIds: ['k2', 'k4'],
      source: 'dfine',
      score: 0.9,
    })
    expect(zones[3].lineIds).toEqual(['k3'])
  })
})

// The bundled D-FINE models, run through the kraken-js the app ships with. The CLLG
// model is too large for the git repo and may be absent in CI.
const MODELS = join(__dirname, '..', 'resources', 'models')
describe.each([
  ['ladas', 'dfine_ladas.js_mlmodel'],
  ['cllg', 'dfine_cllg.js_mlmodel'],
])('bundled %s region model', (_type, file) => {
  const path = join(MODELS, file)
  it.skipIf(!existsSync(path))('loads and detects regions on a page image', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DFineSegmenter } = require('kraken-js')
    const seg = await DFineSegmenter.create(path, { threads: 2, allowSpinning: false })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400">
      <rect width="100%" height="100%" fill="white"/>
      ${Array.from({ length: 20 }, (_, i) =>
        `<rect x="150" y="${200 + i * 45}" width="700" height="22" fill="black"/>`).join('')}
    </svg>`
    const page = await sharp(Buffer.from(svg)).png().toBuffer()
    const { regions, lines, imageSize } = await seg.segment(page)
    expect(imageSize).toEqual({ width: 1000, height: 1400 })
    expect(lines).toEqual([])
    for (const r of regions) {
      expect(typeof r.type).toBe('string')
      expect(r.bbox).toHaveLength(4)
    }
  }, 60_000)
})

describe('zone policy', () => {
  const assigned = assignLinesToRegions(lines, regions)

  it('by default makes no zone of forme work (running title, page number)', () => {
    expect(regionsToZones(regions, assigned).map((z) => z.id)).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('drop leaves a region\'s text out, keep keeps it untagged, annotate tags it', () => {
    const md = regionLinesToPageMarkdown(4, assigned, 'cllg', {
      'MainZone-Head': 'drop',
      'MainZone-P': 'keep',
      RunningTitleZone: 'annotate',
    })
    expect(md).toBe(
      '<pb n="4"/>\n' +
        '<lb n="k0"/>RUNNING TITLE\n' +
        '<lb n="k2"/>First paragraph line one\n<lb n="k4"/><ref>5</ref>first paragraph line two\n' +
        '<lb n="k5"/>Second paragraph\n\n'
    )
  })

  it('a kept LADaS margin stays a <note>, without a zone link', () => {
    const md = regionLinesToPageMarkdown(4, assigned, 'ladas', { MarginTextZone: 'keep' })
    expect(md).toContain('<lb n="k3"/><note>5</note>')
  })

  it('a dropped margin is not turned into a CLLG <ref>', () => {
    const md = regionLinesToPageMarkdown(4, assigned, 'cllg', { MarginTextZone: 'drop' })
    expect(md).not.toContain('<ref>')
  })
})

describe('suppressOverlappingRegions', () => {
  it('keeps the higher-scoring of two regions overlapping by more than 80% IoU', () => {
    const a = { type: 'MainZone-P', bbox: [0, 0, 100, 100] as BBoxT, score: 0.6 }
    const b = { type: 'MainZone-Continued', bbox: [0, 0, 100, 95] as BBoxT, score: 0.9 }  // IoU 0.95
    const c = { type: 'MarginTextZone', bbox: [110, 0, 150, 100] as BBoxT, score: 0.7 }
    expect(suppressOverlappingRegions([a, b, c])).toEqual([b, c])
  })

  it('keeps regions overlapping at or under 80%, and the earlier one on a score tie', () => {
    const a = { type: 'MainZone-P', bbox: [0, 0, 100, 100] as BBoxT, score: 0.8 }
    const b = { type: 'MainZone-P', bbox: [0, 0, 100, 80] as BBoxT, score: 0.9 }     // IoU 0.8
    expect(suppressOverlappingRegions([a, b])).toEqual([a, b])
    const c = { type: 'MainZone-Head', bbox: [0, 0, 100, 99] as BBoxT, score: 0.8 }
    expect(suppressOverlappingRegions([a, c])).toEqual([a])
  })
})
