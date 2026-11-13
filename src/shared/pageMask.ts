import type { Mask, Page } from './types'

// A page's masking has two parts:
//   selections — rectangles of content to KEEP: when there is at least one, everything
//                outside their union is hidden (whited out) before OCR;
//   masks      — legacy rectangles to HIDE (the older, negative way), still applied.

type Masked = Pick<Page, 'masks' | 'selections'>

export function hasMasking(page: Masked): boolean {
  return (page.selections?.length ?? 0) > 0 || (page.masks?.length ?? 0) > 0
}

/** Rectangles to draw/clip for a page, as a single description the renderer can apply. */
export function maskingPlan(page: Masked): { keep: Mask[]; hide: Mask[] } {
  return { keep: page.selections ?? [], hide: page.masks ?? [] }
}

/** Whether a point (page pixels) survives the masking. Used by tests and geometry checks. */
export function isVisible(page: Masked, x: number, y: number): boolean {
  const { keep, hide } = maskingPlan(page)
  const inside = (r: Mask): boolean => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
  if (keep.length > 0 && !keep.some(inside)) return false
  return !hide.some(inside)
}
