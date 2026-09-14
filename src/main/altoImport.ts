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

function parsePoints(pointsAttr: string): [number, number][] {
  return pointsAttr
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return [x, y] as [number, number]
    })
}

function rectPolygon(hpos: number, vpos: number, width: number, height: number): [number, number][] {
  return [
    [hpos, vpos],
    [hpos + width, vpos],
    [hpos + width, vpos + height],
    [hpos, vpos + height],
  ]
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

  const lines: AltoLine[] = []
  const textBlocks = doc.getElementsByTagName('TextBlock')

  let lineCounter = 0
  for (let b = 0; b < textBlocks.length; b++) {
    const block = textBlocks[b] as Element
    const regionType = block.getAttribute('TYPE') ?? undefined
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
      if (!polygon) continue

      // <Baseline POINTS="..."/> is a direct child of <TextLine> (sibling of <Shape>) in
      // most ALTO exports; some tools instead put the points on TextLine/@BASELINE.
      let baseline: [number, number][] | undefined
      const baselineEl = firstChild(lineEl, 'Baseline')
      const basePoints = baselineEl?.getAttribute('POINTS') ?? lineEl.getAttribute('BASELINE')
      if (basePoints) baseline = parsePoints(basePoints)

      const strings = lineEl.getElementsByTagName('String')
      const words: string[] = []
      for (let s = 0; s < strings.length; s++) {
        const content = (strings[s] as Element).getAttribute('CONTENT')
        if (content) words.push(content)
      }
      const text = words.length > 0 ? words.join(' ') : undefined

      const id = lineEl.getAttribute('ID') ?? `${blockId ?? 'b' + b}-${lineCounter}`
      lineCounter++

      lines.push({ id, polygon, baseline, regionType, blockId, text, source: 'alto' })
    }
  }

  return { imageFileName, lines }
}
