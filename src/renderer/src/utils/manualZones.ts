import type { LineGeometry, ManualZoneGroup } from '@shared/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Maps a ManualZoneGroup role to the block tag name md2tei.ts's buildBody() actually
 * recognizes. Only 'continuation' differs — md2tei.ts's explicit continuation cue is the
 * tag `<continued>`, not `<continuation>`; wrapping with the role name directly would
 * produce a tag buildBody() doesn't parse, silently failing to merge the continuation
 * (and leaking the literal tag into the output as escaped text).
 */
export function blockTagForRole(role: ManualZoneGroup['role']): 'p' | 'quote' | 'head' | 'continued' {
  return role === 'continuation' ? 'continued' : role
}

function centroid(polygon: [number, number][]): [number, number] {
  const n = polygon.length
  const sx = polygon.reduce((s, [x]) => s + x, 0)
  const sy = polygon.reduce((s, [, y]) => s + y, 0)
  return [sx / n, sy / n]
}

/** Returns the ids of every LineGeometry whose polygon centroid falls inside `rect`. */
export function linesInRect(rect: Rect, lineGeometry: LineGeometry[]): string[] {
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.width
  const y1 = rect.y + rect.height
  return lineGeometry
    .filter((l) => {
      const [cx, cy] = centroid(l.polygon)
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
    })
    .map((l) => l.id)
}
