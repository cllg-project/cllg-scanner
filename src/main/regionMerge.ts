import { classifyLadasType, type ZoneRole } from './ladas'
import { regionKind, zoneAction, type RegionKind } from '@shared/zones'
import type { DocumentType, PageZone, ZoneAction } from '@shared/types'

// Merging Kraken's recognized lines with the layout regions a D-FINE region model
// (kraken-js DFineSegmenter) detected on the same page, into a page's markdown.
//
// Kraken's baseline segmenter gives lines in reading order but no zone typing; the
// region model gives typed zones (LADaS vocabulary: "MainZone-P", "MarginTextZone",
// "RunningTitleZone", …) but no text. Each line is assigned to the region that covers
// it, then the page is rebuilt one block per region. What happens to the non-main
// regions depends on the kind of document:
//
//   • both   — by default, running titles, page/quire numbers, stamps, digitization
//              artefacts and noise are dropped from the markdown (their geometry is still
//              kept); a drop capital is glued to the start of the main-text line beside it.
//              The project's zone policy (chosen in the Document step) overrides this per
//              region type: `annotate` (tagged, a zone), `keep` (plain text) or `drop`.
//   • ladas  — (Latin, LADaS) a margin region is a real marginal note: it's kept as a
//              `<note>` at its place in reading order.
//   • cllg   — (Greek, CLLG editions) the margins carry section markers (Stephanus,
//              Bekker, chapter numbers…), which the CLLG convention encodes inline — the
//              same as the LM Studio OCR prompt asks for. Each margin line is attached to
//              the main-text line at its height: a short marker as `<ref>X</ref>` at the
//              line's start, anything longer as an inline `<note>` at its end.

export type BBox = [number, number, number, number]

export interface DetectedRegion {
  bbox: BBox
  type: string
  score?: number
}

export interface PlacedLine {
  id: string
  text: string
  polygon: [number, number][]
  regionType?: string
  blockId?: string
}

export { regionKind }

export function polygonBBox(polygon: [number, number][]): BBox {
  const xs = polygon.map(([x]) => x)
  const ys = polygon.map(([, y]) => y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

const area = ([x0, y0, x1, y1]: BBox): number => Math.max(0, x1 - x0) * Math.max(0, y1 - y0)

function intersection(a: BBox, b: BBox): number {
  return area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])])
}

// Two detected regions overlapping more than this (intersection over union) are the
// same zone reported twice.
export const MAX_REGION_IOU = 0.8

/**
 * Drops duplicate detections: D-FINE applies no non-maximum suppression, so a model can
 * report the same zone twice, under the same type or a different one. Whenever two
 * regions overlap with an IoU above `maxIoU`, only the higher-scoring one is kept (the
 * earlier one on a tie). The kept regions stay in their original order.
 */
export function suppressOverlappingRegions(regions: DetectedRegion[], maxIoU = MAX_REGION_IOU): DetectedRegion[] {
  const order = regions.map((_, i) => i).sort((a, b) => (regions[b].score ?? 0) - (regions[a].score ?? 0) || a - b)
  const kept: number[] = []
  for (const i of order) {
    if (kept.every((k) => boxIoU(regions[i].bbox, regions[k].bbox) <= maxIoU)) kept.push(i)
  }
  return kept.sort((a, b) => a - b).map((i) => regions[i])
}

function boxIoU(a: BBox, b: BBox): number {
  const inter = intersection(a, b)
  const union = area(a) + area(b) - inter
  return union > 0 ? inter / union : 0
}

// Share of a line's box a region must cover for the line to belong to it. D-FINE boxes
// are often a few pixels tighter than the line's ascenders/descenders, hence not ~1.
const MIN_COVERAGE = 0.5

/**
 * Give each line the type of the region covering most of it (`regionType`) and that
 * region's id (`blockId`, `r<index>`). When overlapping regions cover a line equally,
 * the smaller, more specific one wins. A line no region covers keeps its own
 * segmenter type and no blockId.
 */
export function assignLinesToRegions<L extends PlacedLine>(lines: L[], regions: DetectedRegion[]): L[] {
  return lines.map((line) => {
    const box = polygonBBox(line.polygon)
    const lineArea = area(box) || 1
    let best = -1
    let bestCov = MIN_COVERAGE
    regions.forEach((r, i) => {
      const cov = intersection(box, r.bbox) / lineArea
      if (cov > bestCov + 1e-6 || (best >= 0 && Math.abs(cov - bestCov) <= 1e-6 && area(r.bbox) < area(regions[best].bbox))) {
        best = i
        bestCov = cov
      }
    })
    if (best < 0) return line
    return { ...line, regionType: regions[best].type, blockId: `r${best}` }
  })
}

/**
 * The detected regions as page zones (`r<index>`, the ids assignLinesToRegions() gives
 * as `blockId`), each holding the lines assigned to it. Every region the zone policy
 * annotates is kept, even one no line fell into: it can still be edited, retyped or
 * removed in Review. Regions whose type is only kept as text, or dropped, give no zone.
 */
export function regionsToZones(
  regions: DetectedRegion[],
  lines: { id: string; blockId?: string }[],
  policy?: Record<string, ZoneAction>
): PageZone[] {
  return regions.flatMap((r, i) => {
    if (zoneAction(r.type, policy) !== 'annotate') return []
    const id = `r${i}`
    const [x0, y0, x1, y1] = r.bbox
    return [{
      id,
      type: r.type,
      rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      lineIds: lines.filter((l) => l.blockId === id).map((l) => l.id),
      source: 'dfine' as const,
      ...(r.score != null ? { score: r.score } : {}),
    }]
  })
}

// `blockId` is the region (`r<index>`) the block was built from, when it is annotated.
export type MergedBlock =
  | { kind: 'zone'; role: ZoneRole; blockId?: string; lines: { id: string; text: string }[] }
  | { kind: 'note'; blockId?: string; lines: { id: string; text: string }[] }

// A margin line short enough to be a section marker ("5", "II", "327 a", "p. 12").
function looksLikeMarker(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && t.length <= 12 && t.split(/\s+/).length <= 3
}

function verticalOverlap(a: BBox, b: BBox): number {
  return Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
}

// The main-text line sitting at the same height as `box` (most vertical overlap, then
// the nearest one horizontally), optionally only among lines to its right.
function lineBeside<L extends { box: BBox }>(box: BBox, candidates: L[], rightOnly = false): L | undefined {
  let best: L | undefined
  let bestOverlap = 0
  let bestDist = Infinity
  for (const c of candidates) {
    if (rightOnly && c.box[2] <= box[2]) continue
    const ov = verticalOverlap(box, c.box)
    if (ov <= 0) continue
    const dist = Math.max(0, c.box[0] - box[2], box[0] - c.box[2])
    if (ov > bestOverlap + 1e-6 || (Math.abs(ov - bestOverlap) <= 1e-6 && dist < bestDist)) {
      best = c
      bestOverlap = ov
      bestDist = dist
    }
  }
  return best
}

/**
 * Rebuild a page's blocks from lines already passed through assignLinesToRegions().
 * Lines are expected in reading order. Each region becomes one block, placed where its
 * first line comes in reading order, so a margin line read in the middle of a paragraph
 * doesn't split that paragraph in two. Lines outside any region stay one block each,
 * typed from their own `regionType` as before.
 *
 * `policy` decides per region type: `drop` leaves the lines out, `keep` keeps them as
 * plain untagged lines (margins still become notes/refs, drop capitals are still glued),
 * `annotate` (the default but for forme work and noise) tags the block with its region.
 */
export function mergeRegionLines(
  lines: PlacedLine[],
  documentType: DocumentType,
  policy?: Record<string, ZoneAction>
): MergedBlock[] {
  type Item = PlacedLine & { box: BBox; kind: RegionKind; text: string; action: ZoneAction }
  const items: Item[] = lines.map((l) => {
    // The policy applies to region types; a line outside any region keeps the defaults.
    const action = zoneAction(l.regionType, l.blockId ? policy : undefined)
    const kind = regionKind(l.regionType)
    // A forme-work region kept or annotated on purpose is ordinary text.
    return { ...l, box: polygonBBox(l.polygon), action, kind: action === 'drop' ? 'skip' : kind === 'skip' ? 'other' : kind }
  })
  const main = items.filter((l) => l.kind === 'main')
  const prefix = new Map<string, string>()
  const suffix = new Map<string, string>()
  const absorbed = new Set<string>()

  const attach = (target: Item, map: Map<string, string>, add: string): void => {
    map.set(target.id, (map.get(target.id) ?? '') + add)
  }

  for (const l of items) {
    if (l.kind === 'dropcap') {
      const target = lineBeside(l.box, main, true)
      if (!target) continue
      attach(target, prefix, l.text.trim())
      absorbed.add(l.id)
    } else if (l.kind === 'margin' && documentType === 'cllg') {
      const target = lineBeside(l.box, main)
      if (!target) continue
      const text = l.text.trim()
      if (text && looksLikeMarker(text)) attach(target, prefix, `<ref>${text}</ref>`)
      else if (text) attach(target, suffix, ` <note>${text}</note>`)
      absorbed.add(l.id)
    }
  }

  const blocks: MergedBlock[] = []
  const byRegion = new Map<string, MergedBlock>()
  for (const l of items) {
    if (absorbed.has(l.id) || l.kind === 'skip') continue
    const text = (prefix.get(l.id) ?? '') + l.text + (suffix.get(l.id) ?? '')
    const entry = { id: l.id, text }
    const existing = l.blockId ? byRegion.get(l.blockId) : undefined
    if (existing) {
      existing.lines.push(entry)
      continue
    }
    // Only an annotated region links its block to a zone.
    const blockId = l.action === 'annotate' ? l.blockId : undefined
    let block: MergedBlock
    if (l.kind === 'margin') {
      block = { kind: 'note', blockId, lines: [entry] }
    } else if (l.action === 'keep') {
      block = { kind: 'zone', role: 'unknown', lines: [entry] }
    } else {
      const role = classifyLadasType(l.regionType)
      // Main-zone subtypes with no TEI container of their own (MainZone-Lg, -Sp,
      // -ListItem, -Entry, …) are still running text: keep them as paragraphs.
      block = { kind: 'zone', role: role === 'unknown' && l.kind === 'main' ? 'p' : role, blockId, lines: [entry] }
    }
    blocks.push(block)
    if (l.blockId) byRegion.set(l.blockId, block)
  }
  return blocks
}
