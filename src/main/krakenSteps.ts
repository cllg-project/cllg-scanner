import type { LineGeometry, PageZone, ZoneAction } from '@shared/types'
import { findAnchors, lineTextSpan, unwrapOrphanZones } from '@shared/lbAnchors'
import { linesInRect } from '@shared/manualZones'
import { unwrapUntaggedBlocksOf, writeAllZoneTags } from '@shared/zones'
import { assignLinesToRegions, polygonBBox, regionsToZones, type BBox, type DetectedRegion } from './regionMerge'

// The separable Kraken steps, applied to a page that was already OCRed: each one changes
// only its own layer (zones, line geometry, or text) and keeps everything else — above
// all the text corrections made in Review, which live in the page's markdown and are
// tied to the lines through their `<lb n="id"/>` anchors.
//
//   zone — D-FINE regions: reassign lines, replace the detected zones (hand-drawn zones
//          stay), rewrite the zone tags. Text untouched.
//   line — Kraken segmentation: new geometry. A line matching an existing one keeps its
//          id (so its anchor and corrected text stay); a new line is inserted with its
//          freshly recognized text; an old line with no match loses its geometry.
//   text — Kraken recognition: replaces the text of every line matched to the existing
//          geometry. Geometry and ids are unchanged.
//
// Recognition only ever runs through pipeline.process() (see ipc/krakenOcr.ts), so the
// line and text steps both take its full output and keep only what they need.

/** One line of pipeline.process() output. */
export interface ProcessedLine {
  text: string
  polygon: [number, number][]
  type?: string
}

// Share of the union two line boxes must overlap to be "the same line".
const MIN_IOU = 0.5

function area([x0, y0, x1, y1]: BBox): number {
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
}

function iou(a: BBox, b: BBox): number {
  const inter = area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])])
  const union = area(a) + area(b) - inter
  return union > 0 ? inter / union : 0
}

/**
 * One-to-one matching of new lines to old ones by box IoU (≥ MIN_IOU), best pairs
 * first. Returns, for each new line index, the matched old line (or undefined).
 */
export function matchLines<O extends { polygon: [number, number][] }>(
  oldLines: O[],
  newLines: { polygon: [number, number][] }[]
): (O | undefined)[] {
  const oldBoxes = oldLines.map((l) => polygonBBox(l.polygon))
  const pairs: { i: number; j: number; v: number }[] = []
  newLines.forEach((n, j) => {
    const nb = polygonBBox(n.polygon)
    oldBoxes.forEach((ob, i) => {
      const v = iou(ob, nb)
      if (v >= MIN_IOU) pairs.push({ i, j, v })
    })
  })
  pairs.sort((a, b) => b.v - a.v)
  const usedOld = new Set<number>()
  const out: (O | undefined)[] = new Array(newLines.length).fill(undefined)
  for (const { i, j } of pairs) {
    if (usedOld.has(i) || out[j]) continue
    usedOld.add(i)
    out[j] = oldLines[i]
  }
  return out
}

/**
 * Recomputes which lines each zone holds after the geometry changed: detected zones by
 * box coverage (as a D-FINE run assigns them), hand-drawn zones by line centroid (as
 * Review's draw tool does).
 */
export function reassignZoneLines(zones: PageZone[], geometry: LineGeometry[]): PageZone[] {
  const dfine = zones.filter((z) => z.source === 'dfine')
  const regions: DetectedRegion[] = dfine.map((z) => ({
    type: z.type,
    bbox: [z.rect.x, z.rect.y, z.rect.x + z.rect.width, z.rect.y + z.rect.height],
  }))
  const assigned = assignLinesToRegions(
    geometry.map((l) => ({ id: l.id, text: '', polygon: l.polygon, blockId: undefined as string | undefined })),
    regions
  )
  return zones.map((z) => {
    if (z.source !== 'dfine') return { ...z, lineIds: linesInRect(z.rect, geometry) }
    const idx = dfine.indexOf(z)
    return { ...z, lineIds: assigned.filter((l) => l.blockId === `r${idx}`).map((l) => l.id) }
  })
}

/** Region typing on the geometry, from the zones (detected zones only). */
function applyZoneTyping(geometry: LineGeometry[], zones: PageZone[]): LineGeometry[] {
  const byLine = new Map<string, PageZone>()
  for (const z of zones) if (z.source === 'dfine') for (const id of z.lineIds) byLine.set(id, z)
  return geometry.map((l) => {
    const z = byLine.get(l.id)
    if (z) return { ...l, regionType: z.type, blockId: z.id }
    if (!l.blockId || l.source === 'alto') return l
    // No longer in any detected region: drop the region typing it got from one.
    const { blockId: _b, regionType: _r, ...rest } = l
    return rest
  })
}

export interface ZoneStepResult {
  markdown: string
  geometry: LineGeometry[]
  zones: PageZone[]
  unwrapped: string[]
}

/**
 * Zone step: replaces the page's detected zones with `regions`, keeps hand-drawn ones,
 * and rewrites the zone tags. Untagged block wrappers holding only zoned lines (from a
 * run made before zones were linked) are replaced by the zones' own. Text is untouched;
 * CLLG margin markers a full run folded into `<ref>`s are not re-derived. Only region
 * types the zone `policy` annotates become zones; since the text is untouched, a type
 * set to `drop` is not removed from text that is already there.
 */
export function applyZoneStep(
  markdown: string,
  geometry: LineGeometry[],
  regions: DetectedRegion[],
  zones: PageZone[] = [],
  policy?: Record<string, ZoneAction>
): ZoneStepResult {
  const manual = zones.filter((z) => z.source === 'manual')
  const placed = assignLinesToRegions(
    geometry.map((l) => ({ id: l.id, text: '', polygon: l.polygon, blockId: undefined as string | undefined })),
    regions
  )
  const detected = regionsToZones(regions, placed, policy)
  const next = [...detected, ...manual]

  // Every wrapper but the hand-drawn zones' is rebuilt from the new regions.
  let md = unwrapOrphanZones(markdown, new Set(manual.map((z) => z.id)))
  md = unwrapUntaggedBlocksOf(md, detected)
  const written = writeAllZoneTags(md, next)
  return {
    markdown: written.markdown,
    geometry: applyZoneTyping(geometry, next),
    zones: next,
    unwrapped: written.unwrapped,
  }
}

export interface LineStepResult {
  markdown: string
  geometry: LineGeometry[]
  zones: PageZone[]
  newLines: number
  orphanLines: number
  unwrapped: string[]
}

/**
 * Line step: `processed` (a fresh segmentation, with its recognized text) becomes the
 * page's geometry. Matched lines keep their id, anchor and text; new lines get a fresh
 * `k<n>` id and are inserted, with their recognized text, after the line read before
 * them. Old lines with no match keep their text but lose their geometry (orphans).
 */
export function applyLineStep(
  markdown: string,
  geometry: LineGeometry[],
  processed: ProcessedLine[],
  zones: PageZone[] = []
): LineStepResult {
  const matched = matchLines(geometry, processed)
  let nextK = Math.max(-1, ...geometry.map((l) => (/^k(\d+)$/.exec(l.id)?.[1] ?? '-1')).map(Number)) + 1
  const taken = new Set(geometry.map((l) => l.id))
  const freshId = (): string => {
    while (taken.has(`k${nextK}`)) nextK++
    const id = `k${nextK++}`
    taken.add(id)
    return id
  }

  const next: LineGeometry[] = processed.map((p, j) => {
    const old = matched[j]
    if (old) {
      return {
        ...old,
        polygon: p.polygon,
        baseline: undefined,
        regionType: old.blockId ? old.regionType : p.type ?? old.regionType,
        source: 'kraken',
      }
    }
    return { id: freshId(), polygon: p.polygon, regionType: p.type, source: 'kraken', text: p.text }
  })
  for (const l of next) if (l.baseline === undefined) delete l.baseline

  // Insert each new line after the markdown line of the closest earlier line that has
  // an anchor; with none, right after the page's <pb/> line.
  let md = markdown
  let newLines = 0
  next.forEach((l, j) => {
    if (matched[j]) return
    newLines++
    const anchors = findAnchors(md)
    let insertAt = -1
    for (let k = j - 1; k >= 0 && insertAt < 0; k--) {
      const a = anchors.find((x) => x.id === next[k].id)
      if (a) {
        const nl = md.indexOf('\n', a.end)
        insertAt = nl === -1 ? md.length : nl
      }
    }
    const text = `<lb n="${l.id}"/>${processed[j].text}`
    if (insertAt < 0) {
      const pb = /^<pb[^>]*\/>[^\n]*$/m.exec(md)
      if (pb) insertAt = pb.index + pb[0].length
      else {
        md = text + '\n' + md
        return
      }
    }
    md = md.slice(0, insertAt) + '\n' + text + md.slice(insertAt)
  })

  const kept = new Set(next.map((l) => l.id))
  const orphanLines = geometry.filter((l) => !kept.has(l.id)).length

  let nextZones = zones
  let unwrapped: string[] = []
  if (zones.length) {
    nextZones = reassignZoneLines(zones, next)
    const written = writeAllZoneTags(md, nextZones)
    md = written.markdown
    unwrapped = written.unwrapped
  }
  return { markdown: md, geometry: applyZoneTyping(next, nextZones), zones: nextZones, newLines, orphanLines, unwrapped }
}

export interface TextStepResult {
  markdown: string
  textLines: number
  unmatched: number
}

// Inline markup a full run adds around a line's recognized text, kept by the text step:
// CLLG margin markers (`<ref>` at the start, long margin notes as `<note>` at the end).
const LEADING_REFS_RE = /^((?:<ref[^>]*>.*?<\/ref>)*)/s
const TRAILING_NOTES_RE = /((?:\s*<note[^>]*>.*?<\/note>)*)$/s
const WHOLE_NOTE_RE = /^(<note[^>]*>)(.*)(<\/note>)$/s

function replaceLineText(current: string, text: string): string {
  const whole = WHOLE_NOTE_RE.exec(current)
  if (whole) return whole[1] + text + whole[3]
  const lead = LEADING_REFS_RE.exec(current)?.[1] ?? ''
  const rest = current.slice(lead.length)
  const trail = TRAILING_NOTES_RE.exec(rest)?.[1] ?? ''
  return lead + text + trail
}

/**
 * Text step: replaces the text of every existing line a line of `processed` matches,
 * keeping the `<ref>`/`<note>` markup a full run put around it. Geometry, ids and all
 * other markup are unchanged.
 */
export function applyTextStep(markdown: string, geometry: LineGeometry[], processed: ProcessedLine[]): TextStepResult {
  const matched = matchLines(geometry, processed)
  const edits: { start: number; end: number; text: string }[] = []
  matched.forEach((old, j) => {
    if (!old) return
    const span = lineTextSpan(markdown, old.id)
    if (!span) return
    edits.push({ ...span, text: replaceLineText(markdown.slice(span.start, span.end), processed[j].text) })
  })
  let md = markdown
  for (const e of edits.sort((a, b) => b.start - a.start)) md = md.slice(0, e.start) + e.text + md.slice(e.end)
  return { markdown: md, textLines: edits.length, unmatched: processed.length - edits.length }
}
