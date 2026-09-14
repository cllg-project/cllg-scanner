import { DOMParser } from '@xmldom/xmldom'
import type { AltoLine } from '@shared/types'

export interface ParsedAltoPage {
  imageFileName: string | null
  lines: AltoLine[]
}

function firstChild(node: Element, tag: string): Element | null {
  const els = node.getElementsByTagName(tag)
  return els.length > 0 ? (els[0] as Element) : null
}

// ALTO's own spec defines POINTS as comma-paired ("x1,y1 x2,y2 ..."), but real-world
// exporters vary — eScriptorium's own export uses flat space-separated coordinates
// ("x1 y1 x2 y2 ..."), no commas at all. Support both: if any comma is present,
// treat every whitespace-separated token as its own "x,y" pair; otherwise treat the
// whole list as flat consecutive x, y numbers.
function parsePoints(pointsAttr: string): [number, number][] {
  const trimmed = pointsAttr.trim()
  if (trimmed.includes(',')) {
    return trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number)
        return [x, y] as [number, number]
      })
  }
  const nums = trimmed.split(/\s+/).filter(Boolean).map(Number)
  const points: [number, number][] = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push([nums[i], nums[i + 1]])
  }
  return points
}

function isValidPolygon(polygon: [number, number][] | null): polygon is [number, number][] {
  return !!polygon && polygon.length > 0 && polygon.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
}

function rectPolygon(hpos: number, vpos: number, width: number, height: number): [number, number][] {
  return [
    [hpos, vpos],
    [hpos + width, vpos],
    [hpos + width, vpos + height],
    [hpos, vpos + height],
  ]
}

// Resolves a TextBlock's region type. Some ALTO exports put it directly on
// TYPE="..."; eScriptorium's own export instead references a tag definition via
// TAGREFS="BT556801", where the actual name ("MainZone-Head") lives on a sibling
// <OtherTag ID="BT556801" LABEL="MainZone-Head"/> under the document's <Tags>
// section. TAGREFS can list multiple space-separated ids — the first one that
// resolves to a known tag is used.
function buildTagLabelMap(doc: Document): Map<string, string> {
  const map = new Map<string, string>()
  const tags = doc.getElementsByTagName('OtherTag')
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i] as unknown as Element
    const id = tag.getAttribute('ID')
    const label = tag.getAttribute('LABEL')
    if (id && label) map.set(id, label)
  }
  return map
}

function resolveRegionType(block: Element, tagLabels: Map<string, string>): string | undefined {
  const type = block.getAttribute('TYPE')
  if (type) return type
  const tagrefs = block.getAttribute('TAGREFS')
  if (!tagrefs) return undefined
  for (const ref of tagrefs.trim().split(/\s+/)) {
    const label = tagLabels.get(ref)
    if (label) return label
  }
  return undefined
}

// Zone types never worth importing at all — running page headers and margin text
// (marginalia, critical apparatus) aren't body text. Prefix-matched so variants like
// "MarginTextZone-PLabelled" or "MarginTextZone-Ab#att_crit" are caught too.
const IGNORED_REGION_PREFIXES = [/^RunningTitleZone/, /^MarginTextZone/]

function isIgnoredRegion(regionType: string | undefined): boolean {
  return !!regionType && IGNORED_REGION_PREFIXES.some((re) => re.test(regionType))
}

/**
 * Parse an ALTO XML document into per-line polygon geometry + region types.
 * Handles both explicit <Shape><Polygon POINTS="..."/></Shape> lines and lines
 * with only HPOS/VPOS/WIDTH/HEIGHT (rectangle derived from those attributes).
 */
export function parseAlto(xmlText: string): ParsedAltoPage {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml') as unknown as Document

  let imageFileName: string | null = null
  const sourceImageInfo = doc.getElementsByTagName('sourceImageInformation')[0] as Element | undefined
  if (sourceImageInfo) {
    const fileName = firstChild(sourceImageInfo, 'fileName')
    if (fileName?.textContent) imageFileName = fileName.textContent.trim()
  }

  const tagLabels = buildTagLabelMap(doc)
  const lines: AltoLine[] = []
  const textBlocks = doc.getElementsByTagName('TextBlock')

  let lineCounter = 0
  for (let b = 0; b < textBlocks.length; b++) {
    const block = textBlocks[b] as Element
    const regionType = resolveRegionType(block, tagLabels)
    if (isIgnoredRegion(regionType)) continue
    const blockId = block.getAttribute('ID') ?? undefined
    const textLines = block.getElementsByTagName('TextLine')

    for (let l = 0; l < textLines.length; l++) {
      const lineEl = textLines[l] as Element

      let polygon: [number, number][] | null = null
      const shape = firstChild(lineEl, 'Shape')
      if (shape) {
        const polygonEl = firstChild(shape, 'Polygon')
        const points = polygonEl?.getAttribute('POINTS')
        if (points) polygon = parsePoints(points)
      }
      if (!polygon) {
        const hpos = Number(lineEl.getAttribute('HPOS'))
        const vpos = Number(lineEl.getAttribute('VPOS'))
        const width = Number(lineEl.getAttribute('WIDTH'))
        const height = Number(lineEl.getAttribute('HEIGHT'))
        if ([hpos, vpos, width, height].every((n) => Number.isFinite(n))) {
          polygon = rectPolygon(hpos, vpos, width, height)
        }
      }
      // Skip lines with no usable geometry at all, and lines whose POINTS/HPOS-VPOS
      // parsed into non-finite coordinates (malformed real-world ALTO) — an SVG
      // <polygon> with NaN in its points silently renders nothing at all (no console
      // error), which made such lines invisible while still counting toward the
      // line total, which was confusing on its own.
      if (!isValidPolygon(polygon)) continue

      // <Baseline POINTS="..."/> is a direct child of <TextLine> (sibling of <Shape>) in
      // most ALTO exports; some tools instead put the points on TextLine/@BASELINE.
      let baseline: [number, number][] | undefined
      const baselineEl = firstChild(lineEl, 'Baseline')
      const basePoints = baselineEl?.getAttribute('POINTS') ?? lineEl.getAttribute('BASELINE')
      if (basePoints) {
        const parsedBaseline = parsePoints(basePoints)
        if (isValidPolygon(parsedBaseline)) baseline = parsedBaseline
      }

      const strings = lineEl.getElementsByTagName('String')
      const words: string[] = []
      for (let s = 0; s < strings.length; s++) {
        const content = (strings[s] as Element).getAttribute('CONTENT')
        if (content && content.trim()) words.push(content)
      }
      const text = words.length > 0 ? words.join(' ') : undefined

      // Don't import lines with no real transcribed text — eScriptorium ALTO exports
      // commonly carry placeholder/segmented-but-untranscribed lines with empty or
      // absent CONTENT. Importing them just adds noise (empty boxes, empty zones) to
      // both the geometry overlay and the reimported transcription.
      if (!text) continue

      const id = lineEl.getAttribute('ID') ?? `${blockId ?? 'b' + b}-${lineCounter}`
      lineCounter++

      lines.push({ id, polygon, baseline, regionType, blockId, text, source: 'alto' })
    }
  }

  return { imageFileName, lines }
}
