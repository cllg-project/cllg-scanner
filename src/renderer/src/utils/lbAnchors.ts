export interface AnchorMatch {
  id: string
  start: number
  end: number
}

const LB_ANCHOR_RE = /<lb n="([^"]*)"\/>/g

/** Every `<lb n="id"/>` occurrence in `markdown`, in document order. */
export function findAnchors(markdown: string): AnchorMatch[] {
  const out: AnchorMatch[] = []
  const re = new RegExp(LB_ANCHOR_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    out.push({ id: m[1], start: m.index, end: m.index + m[0].length })
  }
  return out
}

/**
 * The line id of the last `<lb n="id"/>` anchor at or before `cursorPos` — the anchor
 * that "owns" the text the cursor is currently sitting in. Used to drive Review's
 * click-to-highlight: find the anchor under the cursor, look up its source line's
 * geometry, and highlight it on the page image.
 */
export function findAnchorAt(markdown: string, cursorPos: number): string | null {
  let last: string | null = null
  for (const a of findAnchors(markdown)) {
    if (a.start > cursorPos) break
    last = a.id
  }
  return last
}

const BLOCK_OPEN_LINE_RE = /^<(p|head|quote|continued)>$/
const BLOCK_CLOSE_LINE_RE = /^<\/(p|head|quote|continued)>$/

/**
 * The character span in `markdown` covering every `<lb n="id"/>` anchor whose id is in
 * `lineIds`, from the first matching anchor's start to the end of the line containing
 * the last matching anchor. Used by the manual region-grouping tool to know exactly what
 * multi-line span to wrap with a `<p>`/`<quote>`/`<head>`/`<continued>` block — md2tei.ts's
 * buildBody() understands a real, genuinely multi-line block (open tag on its own line,
 * content, close tag on its own line) natively, so the span's line breaks are kept as-is,
 * just wrapped. Returns null when none of `lineIds` has an anchor in the markdown (e.g.
 * the page hasn't been through Sequence 3's anchored markdown builder).
 *
 * If the matched lines are already immediately wrapped by a single block tag on its own
 * line before and after (the form every block-producer here emits — krakenMarkdown.ts's
 * zone builder, Review's own insertBlockTag, and a previous manual group) — the span is
 * expanded to include that wrapper. Otherwise regrouping already-grouped lines (e.g.
 * redrawing a manual region over content that's already zone-typed) would wrap a *new*
 * tag around the old one instead of replacing it, producing doubled `<p><p>...</p></p>`.
 */
export function spanForLineIds(markdown: string, lineIds: string[] | Set<string>): { start: number; end: number } | null {
  const ids = lineIds instanceof Set ? lineIds : new Set(lineIds)
  const anchors = findAnchors(markdown).filter((a) => ids.has(a.id))
  if (!anchors.length) return null
  let start = anchors[0].start
  const lastAnchor = anchors[anchors.length - 1]
  const nl = markdown.indexOf('\n', lastAnchor.end)
  let end = nl === -1 ? markdown.length : nl

  if (start > 0 && markdown[start - 1] === '\n') {
    const prevLineEnd = start - 1
    const prevLineStart = markdown.lastIndexOf('\n', prevLineEnd - 1) + 1
    const openMatch = BLOCK_OPEN_LINE_RE.exec(markdown.slice(prevLineStart, prevLineEnd))
    if (openMatch && markdown[end] === '\n') {
      const nextLineStart = end + 1
      const nlAfter = markdown.indexOf('\n', nextLineStart)
      const nextLineEnd = nlAfter === -1 ? markdown.length : nlAfter
      const closeMatch = BLOCK_CLOSE_LINE_RE.exec(markdown.slice(nextLineStart, nextLineEnd))
      if (closeMatch && closeMatch[1] === openMatch[1]) {
        start = prevLineStart
        end = nextLineEnd
      }
    }
  }

  return { start, end }
}
