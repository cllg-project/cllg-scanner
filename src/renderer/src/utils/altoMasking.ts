import type { AltoLine, Mask } from '@shared/types'

const DEFAULT_MARGIN_REGION_TYPES = ['margin', 'MarginTextGroup']

/**
 * Convert ALTO region geometry into rectangular masks, one per non-main region
 * (grouped by regionType), by taking the bounding box of that region's lines.
 * Lines with no regionType, or a regionType not in `marginRegionTypes`, are
 * treated as main text and left unmasked.
 */
export function regionsToMasks(
  lines: AltoLine[],
  marginRegionTypes: string[] = DEFAULT_MARGIN_REGION_TYPES
): Mask[] {
  const groups = new Map<string, AltoLine[]>()
  for (const line of lines) {
    if (!line.regionType || !marginRegionTypes.includes(line.regionType)) continue
    const group = groups.get(line.regionType) ?? []
    group.push(line)
    groups.set(line.regionType, group)
  }

  const masks: Mask[] = []
  for (const group of groups.values()) {
    const xs = group.flatMap((l) => l.polygon.map((p) => p[0]))
    const ys = group.flatMap((l) => l.polygon.map((p) => p[1]))
    if (!xs.length) continue
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const width = Math.max(...xs) - x
    const height = Math.max(...ys) - y
    if (width <= 0 || height <= 0) continue
    masks.push({ x, y, width, height, fill: '#ffffff' })
  }
  return masks
}
