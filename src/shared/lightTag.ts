import type { LayeredTagger as LayeredTaggerT } from './tagger/tagger.js'

// Automatic tagging of refs, bibliographic citations and notes in a page's markdown,
// with the vendored CLLG light-tagger (a pair of CRFs, see ./tagger/README.md).
//
// The tagger works on plain text; the page markdown also holds `<lb n="…"/>` anchors,
// block wrapper lines (`<p zone="r1">`…) and tags already written (`<ref>`, `<note>`,
// `<bibl>`, `<cit>`). Those are masked out before tagging and never touched: a
// suggestion is mapped back to markdown offsets, split at anchors / line ends so each
// piece sits on one line (a tag never straddles an `<lb/>`), and dropped if it would
// overlap an element that is already tagged. No Node/Electron imports (web demo).

export type SuggestionKind = 'REF' | 'BIBL' | 'NOTE' | 'NOTEBIBL' | 'NOTEREF'

export interface Suggestion {
  id: string
  kind: SuggestionKind
  /** The tagged text, anchors removed, lines joined with a space. */
  text: string
  /** Markdown offsets; one piece per line the span covers. */
  pieces: { start: number; end: number }[]
}

const TAG_FOR: Record<SuggestionKind, string> = {
  REF: 'ref', BIBL: 'bibl', NOTE: 'note', NOTEBIBL: 'note', NOTEREF: 'note',
}

const BLOCK_LINE_RE = /^<\/?(?:p|head|quote|continued)(?: zone="[^"]*")?>$/
// Inline anchors that only split a span, and elements already tagged, which are opaque.
const ANCHOR_RE = /<(?:lb|pb)\b[^>]*\/>/y
const TAGGED_RE = /<(ref|note|cit|bibl)\b[^>]*>[\s\S]*?<\/\1>/y

interface Unit {
  /** Masked text of the chunk (lines joined by a space), and for each char its markdown offset. */
  text: string
  offs: number[]
  /** Markdown offsets of masked ranges: [start, end, opaque]. */
  masks: [number, number, boolean][]
}

/** Splits the markdown into chunks of consecutive text lines (paragraph-like units). */
function units(md: string): Unit[] {
  const out: Unit[] = []
  let cur: Unit | null = null
  const flush = () => { if (cur && cur.text.trim()) out.push(cur); cur = null }
  let pos = 0
  for (const line of md.split('\n')) {
    const lineStart = pos
    pos += line.length + 1
    if (!line.trim() || BLOCK_LINE_RE.test(line.trim()) || /^<pb\b[^>]*\/>$/.test(line.trim())) { flush(); continue }
    if (!cur) cur = { text: '', offs: [], masks: [] }
    else { cur.text += ' '; cur.offs.push(lineStart - 1) }
    let i = 0
    while (i < line.length) {
      if (line[i] === '<') {
        ANCHOR_RE.lastIndex = i
        let m = ANCHOR_RE.exec(line)
        if (m) {
          cur.masks.push([lineStart + i, lineStart + i + m[0].length, false])
          i += m[0].length
          continue
        }
        TAGGED_RE.lastIndex = i
        m = TAGGED_RE.exec(line)
        if (m) {
          cur.masks.push([lineStart + i, lineStart + i + m[0].length, true])
          cur.text += ' '
          cur.offs.push(lineStart + i)
          i += m[0].length
          continue
        }
      }
      cur.text += line[i]
      cur.offs.push(lineStart + i)
      i++
    }
  }
  flush()
  return out
}

let taggerPromise: Promise<LayeredTaggerT> | null = null

async function getTagger(): Promise<LayeredTaggerT> {
  taggerPromise ??= (async () => {
    const [{ LayeredTagger }, note, cite] = await Promise.all([
      import('./tagger/tagger.js'),
      import('./tagger/note.json'),
      import('./tagger/cite.json'),
    ])
    return new LayeredTagger(note.default as never, cite.default as never)
  })()
  return taggerPromise
}

/** Pieces of the markdown range [s, e) with anchors and line breaks cut out; null if it overlaps tagged text. */
function piecesOf(md: string, u: Unit, s: number, e: number): { start: number; end: number }[] | null {
  for (const [ms, me, opaque] of u.masks) {
    if (opaque && ms < e && me > s) return null
  }
  const cuts = u.masks.filter(([ms, me, op]) => !op && ms < e && me > s)
  const pieces: { start: number; end: number }[] = []
  let from = s
  const flushTo = (to: number) => {
    // also cut at newlines
    let a = from
    for (let k = from; k <= to; k++) {
      if (k === to || md[k] === '\n') {
        if (k > a) pieces.push({ start: a, end: k })
        a = k + 1
      }
    }
  }
  for (const [ms, me] of cuts) {
    if (ms > from) flushTo(ms)
    from = Math.max(from, me)
  }
  if (from < e) flushTo(e)
  return pieces
    .map((p) => {
      let { start, end } = p
      while (start < end && /\s/.test(md[start])) start++
      while (end > start && /\s/.test(md[end - 1])) end--
      return { start, end }
    })
    .filter((p) => p.end > p.start)
}

/** Suggested tags for a page's markdown, in document order. */
export async function tagPageText(md: string): Promise<Suggestion[]> {
  const tagger = await getTagger()
  const out: Suggestion[] = []
  for (const u of units(md)) {
    const { notes, cites } = tagger.annotate(u.text)
    const spans: { s: number; e: number; kind: SuggestionKind; text: string }[] = []
    for (const n of notes) spans.push({ s: n.start, e: n.end, kind: n.kind, text: n.text })
    for (const c of cites) {
      // A cite that straddles a note boundary cannot be nested as XML: drop it.
      if (notes.some((n) => c.start < n.end && c.end > n.start && !(c.start >= n.start && c.end <= n.end))) continue
      spans.push({ s: c.start, e: c.end, kind: c.label as SuggestionKind, text: c.text })
    }
    for (const sp of spans) {
      const pieces = piecesOf(md, u, u.offs[sp.s], u.offs[sp.e - 1] + 1)
      if (!pieces || !pieces.length) continue
      out.push({ id: `${pieces[0].start}-${sp.kind}`, kind: sp.kind, text: sp.text, pieces })
    }
  }
  return out.sort((a, b) => a.pieces[0].start - b.pieces[0].start)
}

/** Writes the given suggestions into the markdown as `<ref>`, `<bibl>`, `<note>` tags. */
export function applySuggestions(md: string, accepted: Suggestion[]): string {
  interface Ins { pos: number; open: boolean; tag: string; len: number }
  const ins: Ins[] = []
  for (const sg of accepted) {
    const tag = TAG_FOR[sg.kind]
    for (const p of sg.pieces) {
      ins.push({ pos: p.start, open: true, tag, len: p.end - p.start })
      ins.push({ pos: p.end, open: false, tag, len: p.end - p.start })
    }
  }
  // At one position: closes first (inner = shorter first), then opens (outer = longer first).
  ins.sort((a, b) => a.pos - b.pos || Number(a.open) - Number(b.open) || (a.open ? b.len - a.len : a.len - b.len))
  let out = ''
  let last = 0
  for (const i of ins) {
    out += md.slice(last, i.pos) + (i.open ? `<${i.tag}>` : `</${i.tag}>`)
    last = i.pos
  }
  return out + md.slice(last)
}
