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

// A block open tag may carry a `zone="<PageZone id>"` attribute linking it back to the
// zone (detected or hand-drawn) that produced it, so editing or deleting the zone can
// find exactly its tags.
const BLOCK_OPEN_LINE_RE = /^<(p|head|quote|continued)(?: zone="([^"]*)")?>$/
const BLOCK_CLOSE_LINE_RE = /^<\/(p|head|quote|continued)>$/

export interface BlockSpan {
  tag: string
  zoneId?: string
  start: number       // start of the open-tag line
  innerStart: number  // just after the open-tag line's newline
  innerEnd: number    // end of the last inner line (before the close-tag line's newline)
  end: number         // end of the close-tag line
}

/**
 * Every block wrapper (`<p|head|quote|continued …>` open line … matching close line) in
 * `markdown`, in document order. md2tei.ts's buildBody() has no nested blocks, so the
 * next close line of the same kind closes an open one.
 */
export function findBlocks(markdown: string): BlockSpan[] {
  const out: BlockSpan[] = []
  let open: { tag: string; zoneId?: string; start: number; innerStart: number } | null = null
  let pos = 0
  let prevLineEnd = 0
  while (pos <= markdown.length) {
    const nl = markdown.indexOf('\n', pos)
    const lineEnd = nl === -1 ? markdown.length : nl
    const line = markdown.slice(pos, lineEnd).trim()
    if (!open) {
      const m = BLOCK_OPEN_LINE_RE.exec(line)
      if (m) open = { tag: m[1], zoneId: m[2] || undefined, start: pos, innerStart: lineEnd + 1 }
    } else {
      const c = BLOCK_CLOSE_LINE_RE.exec(line)
      if (c && c[1] === open.tag) {
        out.push({ ...open, innerEnd: Math.max(open.innerStart, prevLineEnd), end: lineEnd })
        open = null
      }
    }
    if (nl === -1) break
    prevLineEnd = lineEnd
    pos = nl + 1
  }
  return out
}

/** The block wrapper enclosing `pos` (anywhere from its open line to its close line). */
export function blockAt(markdown: string, pos: number): BlockSpan | null {
  return findBlocks(markdown).find((b) => pos >= b.start && pos <= b.end) ?? null
}

/** True when `text` holds a block open or close line. */
export function hasBlockTagLine(text: string): boolean {
  return text.split('\n').some((l) => BLOCK_OPEN_LINE_RE.test(l.trim()) || BLOCK_CLOSE_LINE_RE.test(l.trim()))
}

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
export function spanForLineIds(
  markdown: string,
  lineIds: string[] | Set<string>
): { start: number; end: number; innerStart: number; innerEnd: number; wrapped: boolean; wrapperZoneId?: string } | null {
  const ids = lineIds instanceof Set ? lineIds : new Set(lineIds)
  const anchors = findAnchors(markdown).filter((a) => ids.has(a.id))
  if (!anchors.length) return null
  let start = anchors[0].start
  const lastAnchor = anchors[anchors.length - 1]
  const nl = markdown.indexOf('\n', lastAnchor.end)
  let end = nl === -1 ? markdown.length : nl
  const innerStart = start
  const innerEnd = end
  let wrapped = false
  let wrapperZoneId: string | undefined

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
        wrapped = true
        wrapperZoneId = openMatch[2]
      }
    }
  }

  return { start, end, innerStart, innerEnd, wrapped, wrapperZoneId }
}

/** Removes a whole line (and its trailing newline, or the preceding one at end of text). */
function removeLine(markdown: string, lineStart: number, lineEnd: number): string {
  if (markdown[lineEnd] === '\n') return markdown.slice(0, lineStart) + markdown.slice(lineEnd + 1)
  if (lineStart > 0) return markdown.slice(0, lineStart - 1) + markdown.slice(lineEnd)
  return markdown.slice(0, lineStart) + markdown.slice(lineEnd)
}

/**
 * Removes the block wrapper belonging to a manual zone: every `<tag zone="zoneId">` open
 * line together with the next matching `</tag>` close line (md2tei.ts's buildBody() has
 * no nested blocks, so the next close of the same kind is the one). The wrapped lines
 * themselves are kept. Returns `markdown` unchanged when no tag carries that id.
 */
export function unwrapZone(markdown: string, zoneId: string): string {
  let out = markdown
  for (;;) {
    let pos = 0
    let found = false
    while (pos <= out.length) {
      const nl = out.indexOf('\n', pos)
      const lineEnd = nl === -1 ? out.length : nl
      const open = BLOCK_OPEN_LINE_RE.exec(out.slice(pos, lineEnd).trim())
      if (open && open[2] === zoneId) {
        // Find the matching close line after it.
        let q = lineEnd + 1
        while (q <= out.length) {
          const nl2 = out.indexOf('\n', q)
          const end2 = nl2 === -1 ? out.length : nl2
          const close = BLOCK_CLOSE_LINE_RE.exec(out.slice(q, end2).trim())
          if (close && close[1] === open[1]) {
            out = removeLine(out, q, end2)
            break
          }
          if (nl2 === -1) break
          q = nl2 + 1
        }
        out = removeLine(out, pos, lineEnd)
        found = true
        break
      }
      if (nl === -1) break
      pos = nl + 1
    }
    if (!found) return out
  }
}

/**
 * Legacy fallback for manual zones created before tags carried a `zone` attribute: if the
 * zone's lines are wrapped by exactly one bare `<tag>`…`</tag>` pair of the zone's kind,
 * strip that pair. Returns `markdown` unchanged otherwise.
 */
export function unwrapLegacyZone(markdown: string, lineIds: string[], tag: string): string {
  const span = spanForLineIds(markdown, lineIds)
  if (!span || !span.wrapped || span.wrapperZoneId !== undefined) return markdown
  const openLineEnd = markdown.indexOf('\n', span.start)
  if (openLineEnd === -1 || markdown.slice(span.start, openLineEnd) !== `<${tag}>`) return markdown
  const closeLineStart = markdown.lastIndexOf('\n', span.end - 1) + 1
  if (markdown.slice(closeLineStart, span.end) !== `</${tag}>`) return markdown
  return removeLine(removeLine(markdown, closeLineStart, span.end), span.start, openLineEnd)
}

/** Every `zone="id"` carried by a block open tag in `markdown`. */
export function zoneIdsInMarkdown(markdown: string): Set<string> {
  const ids = new Set<string>()
  for (const line of markdown.split('\n')) {
    const m = BLOCK_OPEN_LINE_RE.exec(line.trim())
    if (m?.[2]) ids.add(m[2])
  }
  return ids
}

/**
 * Unwraps every block tagged with a `zone` id that isn't in `keepIds` — tags left behind
 * by a manual group that no longer exists (e.g. one replaced by a redraw over the same
 * lines).
 */
export function unwrapOrphanZones(markdown: string, keepIds: Set<string>): string {
  let out = markdown
  for (const id of zoneIdsInMarkdown(markdown)) {
    if (!keepIds.has(id)) out = unwrapZone(out, id)
  }
  return out
}

/**
 * The span of the text belonging to line `id`: from just after its `<lb n="id"/>` anchor
 * to the end of that markdown line, or to the next anchor if another line was joined onto
 * the same markdown line (e.g. a hyphenation join). Null when the line has no anchor.
 */
export function lineTextSpan(markdown: string, id: string): { start: number; end: number } | null {
  const anchors = findAnchors(markdown)
  const i = anchors.findIndex((a) => a.id === id)
  if (i < 0) return null
  const start = anchors[i].end
  const nl = markdown.indexOf('\n', start)
  let end = nl === -1 ? markdown.length : nl
  if (i + 1 < anchors.length && anchors[i + 1].start < end) end = anchors[i + 1].start
  return { start, end }
}
