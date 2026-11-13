import type { LineGeometry } from './types'
import { lineTextSpan } from './lbAnchors'

// Recognition confidence, kept with the line geometry (never in the page text):
// `LineGeometry.conf = { text, c }` where `c[i]` is the model's confidence (0–100) for
// the UTF-16 unit `text[i]`, and `text` is what the model read (the markdown line may
// have been edited since: confidence is only shown for text that is still as read).

export interface RecognizedChar { char: string; conf: number }

/** Per-UTF-16-unit confidences (0–100) of a recognized line, or undefined if they don't line up with its text. */
export function lineConfidence(text: string, chars?: RecognizedChar[]): LineGeometry['conf'] {
  if (!chars?.length) return undefined
  const c: number[] = []
  for (const ch of chars) {
    const v = Math.max(0, Math.min(100, Math.round(ch.conf * 100)))
    for (let i = 0; i < ch.char.length; i++) c.push(v)
  }
  return c.length === text.length && chars.map((x) => x.char).join('') === text ? { text, c } : undefined
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85

/**
 * Ranges (markdown offsets) of the characters the model was unsure of: those whose
 * confidence is below `threshold` (0–1), in lines whose text in the markdown is still
 * exactly what the model read. Spaces are skipped.
 */
export function lowConfidenceRanges(
  markdown: string,
  geometry: LineGeometry[],
  threshold = DEFAULT_CONFIDENCE_THRESHOLD
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  for (const l of geometry) {
    if (!l.conf) continue
    const span = lineTextSpan(markdown, l.id)
    if (!span) continue
    const idx = markdown.slice(span.start, span.end).indexOf(l.conf.text)
    if (idx < 0) continue
    const base = span.start + idx
    for (let i = 0; i < l.conf.text.length; i++) {
      if (l.conf.c[i] / 100 >= threshold || /\s/.test(l.conf.text[i])) continue
      const last = out[out.length - 1]
      if (last && last.end === base + i) last.end++
      else out.push({ start: base + i, end: base + i + 1 })
    }
  }
  return out
}

/** Lowest confidence (0–1) in a line, or null. */
export function minConfidence(l: LineGeometry): number | null {
  return l.conf?.c.length ? Math.min(...l.conf.c) / 100 : null
}
