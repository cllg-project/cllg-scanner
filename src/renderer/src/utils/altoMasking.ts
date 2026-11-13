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

const MAIN_REGION_RE = /^MainZone/

/**
 * The positive counterpart of regionsToMasks: one selection rectangle around the
 * main-text lines of a page (those with no regionType, or a MainZone* one), i.e.
 * everything but margins and the other zones.
 */
export function regionsToSelections(
  lines: AltoLine[],
  marginRegionTypes: string[] = DEFAULT_MARGIN_REGION_TYPES
): Mask[] {
  const main = lines.filter((l) => !l.regionType || MAIN_REGION_RE.test(l.regionType) || !marginRegionTypes.includes(l.regionType))
  const xs = main.flatMap((l) => l.polygon.map((p) => p[0]))
  const ys = main.flatMap((l) => l.polygon.map((p) => p[1]))
  if (!xs.length) return []
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(...xs) - x
  const height = Math.max(...ys) - y
  return width > 0 && height > 0 ? [{ x, y, width, height, fill: '#ffffff' }] : []
}
