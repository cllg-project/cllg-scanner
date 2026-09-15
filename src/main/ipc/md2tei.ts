/**
 * Pure TypeScript md2tei converter.
 * Replaces the Python subprocess — no lxml, no regex module, works on all platforms.
 */

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { parse as parseYaml } from 'yaml'
import type { BibEntry } from '@shared/types'

const NS = 'http://www.tei-c.org/ns/1.0'
const ELEM = 1
const TEXT = 3

// ── XML helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Normalise whitespace inside self-closing `/ >` → `/>` so xmldom's strict SAX parser
// doesn't reject tags that the OCR model emitted with a stray space before or after `/`.
function normSelfClose(tag: string): string {
  return tag.replace(/\/\s+>/g, '/>')
}

function parseAttrStr(attrsStr: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"` ).exec(attrsStr)
  return m ? m[1] : null
}

function childElems(node: Node): Element[] {
  const out: Element[] = []
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i]
    if (c.nodeType === ELEM) out.push(c as Element)
  }
  return out
}

function childNodes(node: Node): Node[] {
  const out: Node[] = []
  for (let i = 0; i < node.childNodes.length; i++) out.push(node.childNodes[i])
  return out
}

function isTag(node: Node, tag: string): node is Element {
  return node.nodeType === ELEM && (node as Element).localName === tag
}

function allElems(root: Node, tag: string): Element[] {
  const out: Element[] = []
  const walk = (n: Node): void => {
    if (n.nodeType === ELEM && (n as Element).localName === tag) out.push(n as Element)
    for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i])
  }
  walk(root)
  return out
}

// ── Level structures ──────────────────────────────────────────────────────────

interface LevelDef {
  level: number
  name: string
  format: string
  isMilestone: boolean
  missingFirst: boolean
}

function buildLevels(structure: Record<string, unknown>, depth = 1): LevelDef[] {
  const out: LevelDef[] = [{
    level: depth,
    name: String(structure.name ?? `lvl${depth}`),
    format: String(structure.format ?? 'Arabic'),
    isMilestone: !!structure.is_milestone,
    missingFirst: !!structure.missing_first,
  }]
  if (structure.child) out.push(...buildLevels(structure.child as Record<string, unknown>, depth + 1))
  return out
}

function levelMap(ls: LevelDef[]): Record<number, string> {
  return Object.fromEntries(ls.map(l => [l.level, l.name]))
}

function milestoneSet(ls: LevelDef[]): Set<number> {
  return new Set(ls.filter(l => l.isMilestone).map(l => l.level))
}

function startValue(format: string): string {
  switch (format.toLowerCase()) {
    case 'roman':     return 'I'
    case 'alpha':     return 'a'
    case 'greek':     return 'α'
    case 'stephanus': return '1a'
    default:          return '1'   // Arabic and custom regexes
  }
}

// Internal-only token md2tei inserts/consumes in memory during TEI generation to mark a
// <continued> block's merge target — never written to the persisted per-page markdown.
const MARKER = '__CONTINUATION__'

// ── Line tokeniser ────────────────────────────────────────────────────────────

type LineToken =
  | { kind: 'text'; value: string }
  | { kind: 'ref';  attrStr: string; inner: string }
  | { kind: 'note'; inner: string }
  | { kind: 'cit';  inner: string }
  | { kind: 'bibl'; inner: string }
  | { kind: 'lb';   raw: string }

function tokenizeLine(s: string): LineToken[] {
  const tokens: LineToken[] = []
  const re = /(<lb[^>]*\/>|<ref[^>]*>.*?<\/ref>|<note>.*?<\/note>|<cit>.*?<\/cit>|<bibl>.*?<\/bibl>)/gs
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: s.slice(last, m.index) })
    const tag = m[0]
    if (tag.startsWith('<lb'))   tokens.push({ kind: 'lb', raw: normSelfClose(tag) })
    else if (tag.startsWith('<ref')) {
      const am = /^<ref([^>]*)>(.*?)<\/ref>$/s.exec(tag)
      if (am) tokens.push({ kind: 'ref', attrStr: am[1], inner: am[2] })
    } else if (tag.startsWith('<note')) {
      const nm = /^<note>(.*?)<\/note>$/s.exec(tag)
      if (nm) tokens.push({ kind: 'note', inner: nm[1] })
    } else if (tag.startsWith('<cit')) {
      const cm = /^<cit>(.*?)<\/cit>$/s.exec(tag)
      if (cm) tokens.push({ kind: 'cit', inner: cm[1] })
    } else if (tag.startsWith('<bibl')) {
      const bm = /^<bibl>(.*?)<\/bibl>$/s.exec(tag)
      if (bm) tokens.push({ kind: 'bibl', inner: bm[1] })
    }
    last = m.index + m[0].length
  }
  if (last < s.length) tokens.push({ kind: 'text', value: s.slice(last) })
  return tokens
}

// ── Build div/milestone/p body ────────────────────────────────────────────────
//
// Two coexisting conventions, so LM Studio's existing "one line = one paragraph"
// output stays byte-for-byte unaffected while Kraken/ALTO's zone-aware markdown (and
// Review's manual-tagging tools) get real, genuinely-multi-line TEI containers:
//
//   • Explicit block tags — `<p>`/`<head>`/`<quote>`/`<continued>`, either spanning
//     several raw lines (open tag alone on its own line ... close tag alone on its own
//     line) or a single line (`<p>...</p>` all on one line). Everything between open
//     and close becomes that element's content verbatim (lines joined with `\n`); a
//     `<ref level="N">` for a div-level found as the very first real content of a block
//     (only `<lb n>` anchors before it) opens a `<div>` there instead — the block
//     resumes as that div's first paragraph — since OCR/import puts the ref right at
//     the start of the physical line it was recognized on, not necessarily outside the
//     `<p>` wrapper. Anywhere else inside a block, a div-level ref degrades to `<note>`
//     (TEI can't open a `<div>` mid-`<p>`) rather than being dropped or crashing.
//   • Implicit bare lines (no block currently open) — unchanged from before: each
//     non-empty line is its own `<p>` (or `<head>` via the `#` shorthand), and
//     `<ref level="N">` for a div-level closes/opens `<div>`s exactly as it always has.
//
// `<continued>` doesn't become its own element: it's md2tei's cue that this block is
// the continuation of the immediately preceding page's still-open paragraph, so it's
// emitted as a MARKER-prefixed `<p>` and spliced into that preceding `<p>`/`<quote>` by
// mergeContinuations() below — the same mechanism as before, just triggered by an
// explicit tag (page authors decide) instead of a fragile "first content after a <pb>"
// position heuristic.
//
// Other rules, unchanged:
//   • <ref level="N"> where N is a div-level  → close current <p>, close deeper
//     divs, open <div type="…" n="…">; if any ancestor div-level with
//     missing_first=true hasn't been opened yet, auto-open it first
//   • <ref level="N"> where N is a milestone  → inline within current <p>;
//     outside only if no paragraph is open yet
//   • Unclassified <ref> (no level or level 0) → treated as <note>
//   • Plain text before any div is open + a div-level with missing_first=true
//     → auto-open that div with its format's start value

type BlockKind = 'p' | 'head' | 'quote' | 'continued'
const BLOCK_OPEN_RE = /^<(p|head|quote|continued)>$/
const BLOCK_CLOSE_RE = /^<\/(p|head|quote|continued)>$/
const BLOCK_INLINE_RE = /^<(p|head|quote|continued)>([\s\S]*)<\/\1>$/

function buildBody(
  md: string,
  lm: Record<number, string>,
  ms: Set<number>,
  levels: LevelDef[],
  warn: (msg: string) => void
): string {
  const out: string[] = []
  const stack: number[] = []
  let pParts: string[] = []
  let inHead = false
  let block: BlockKind | null = null
  let blockLines: string[] = []
  // True right after a <continued> block closes, until either the next <pb> or
  // another explicit block tag is seen. A bare (untagged) line with real text in
  // that gap is almost always OCR noise (a catchword, signature mark, running
  // header…) that got left outside the <continued> wrapper by mistake — it silently
  // becomes its own <p> and steals the *next* page's <continued> merge target
  // (mergeContinuations() just grabs the nearest preceding <p>), splitting what
  // should be one running sentence across two paragraphs with no visible error.
  let justClosedContinued = false

  // div-level defs in ascending level order, excluding milestones
  const divLevels = levels.filter(l => !l.isMilestone).sort((a, b) => a.level - b.level)

  function flushP(): void {
    const content = pParts.join('').trim()
    pParts = []
    if (!content) { return }
    out.push(inHead ? `<head>${content}</head>` : `<p>${content}</p>`)
    inHead = false
  }

  // Before opening a div at `targetLevel` (or before emitting top-level content),
  // auto-open any ancestor div-levels that have missing_first=true and aren't yet open.
  function autoOpenAncestors(targetLevel: number): void {
    for (const ldef of divLevels) {
      if (ldef.level >= targetLevel) break
      if (stack.includes(ldef.level)) continue
      if (!ldef.missingFirst) continue
      out.push(`<div type="${escAttr(ldef.name)}" n="${escAttr(startValue(ldef.format))}">`)
      stack.push(ldef.level)
    }
  }

  // Closes divs down to `lvl`, auto-opens any missing_first ancestors, then opens the
  // new div — shared by the bare-line ref path and the inside-block first-ref path
  // below. If no div is open yet at all (stack was empty), the new div also reclaims an
  // immediately-preceding, still-unclaimed run of `<head>` elements (a title that
  // appeared before any explicit ref existed conceptually belongs to the division that
  // follows it) by splicing the open tag in before them, rather than after.
  function openDiv(lvl: number, val: string): void {
    while (stack.length && stack[stack.length - 1] >= lvl) { out.push('</div>'); stack.pop() }
    autoOpenAncestors(lvl)
    const divTag = `<div type="${escAttr(lm[lvl] ?? `level${lvl}`)}" n="${escAttr(val)}">`
    if (stack.length === 0) {
      let insertAt = out.length
      while (insertAt > 0 && /^<head>[\s\S]*<\/head>$/.test(out[insertAt - 1])) insertAt--
      out.splice(insertAt, 0, divTag)
    } else {
      out.push(divTag)
    }
    stack.push(lvl)
  }

  // Inline tokenizer used *inside* an explicit block: same lb/note/text handling as the
  // bare-line path. A div-level ref can't open a <div> mid-<p> in general, so it
  // degrades to a <note> — UNLESS it's the very first real content this block has seen
  // (only `<lb n>` anchors before it, nothing else) — an OCR-line artifact of where the
  // ref token physically landed, not a genuine mid-paragraph structural marker. In that
  // case treat it as the block's real division boundary: open the <div> (via openDiv(),
  // which also reclaims a still-unclaimed preceding <head>) and let this block resume
  // as that div's first paragraph, exactly like the bare-line path already does.
  function tokenizeBlockLine(s: string): string {
    const parts: string[] = []
    for (const tok of tokenizeLine(s)) {
      switch (tok.kind) {
        case 'text': {
          const t = tok.value.replace(/\s+/g, ' ')
          if (t) parts.push(esc(t))
          break
        }
        case 'lb':
          parts.push(tok.raw)
          break
        case 'note':
          parts.push(`<note>${esc(tok.inner.trim())}</note>`)
          break
        case 'cit':
          parts.push(`<cit>${esc(tok.inner.trim())}</cit>`)
          break
        case 'bibl':
          parts.push(`<bibl>${esc(tok.inner.trim())}</bibl>`)
          break
        case 'ref': {
          const lvlStr = parseAttrStr(tok.attrStr, 'level')
          const lvl = lvlStr !== null ? (parseInt(lvlStr, 10) || null) : null
          const val = tok.inner.trim()
          if (!lvl) {
            parts.push(`<note>${esc(val)}</note>`)
          } else if (ms.has(lvl)) {
            parts.push(`<milestone unit="${escAttr(lm[lvl] ?? `level${lvl}`)}" n="${escAttr(val)}"/>`)
          } else if (blockLines.length === 0 && parts.every((p) => p.startsWith('<lb '))) {
            openDiv(lvl, val)
          } else {
            parts.push(`<note>${esc(val)}</note>`)
          }
          break
        }
      }
    }
    return parts.join('')
  }

  function emitBlock(kind: BlockKind, lines: string[]): void {
    const content = lines.join('\n').trim()
    if (!content) return
    if (kind === 'continued') {
      out.push(`<p>${MARKER}${content}</p>`)
    } else {
      if (stack.length === 0) autoOpenAncestors(Infinity)
      out.push(`<${kind}>${content}</${kind}>`)
    }
  }

  // A block-close tag or <pb/> glued directly onto the next tag with no newline
  // between them (e.g. `</continued><pb n="3"/>`) can't be told apart from ordinary
  // text by the line-based parser below and would otherwise be escaped verbatim —
  // this has happened in practice when two page cache files got concatenated without
  // a newline in between. Split them back onto separate lines before parsing; this is
  // a no-op for any already-well-formed input.
  const normalizedMd = md.replace(/(<\/(?:p|head|quote|continued)>|<pb[^>]*\/?>)(?=<)/g, '$1\n')

  for (const rawLine of normalizedMd.split('\n')) {
    const s = rawLine.trim()

    if (block) {
      const closeMatch = BLOCK_CLOSE_RE.exec(s)
      if (closeMatch && closeMatch[1] === block) {
        emitBlock(block, blockLines)
        justClosedContinued = block === 'continued'
        block = null
        blockLines = []
        continue
      }
      if (!s) continue
      blockLines.push(tokenizeBlockLine(s))
      continue
    }

    if (!s) continue

    if (s.startsWith('<pb')) { flushP(); out.push(normSelfClose(s)); justClosedContinued = false; continue }

    const openMatch = BLOCK_OPEN_RE.exec(s)
    if (openMatch) { flushP(); block = openMatch[1] as BlockKind; blockLines = []; justClosedContinued = false; continue }

    const inlineMatch = BLOCK_INLINE_RE.exec(s)
    if (inlineMatch) {
      flushP()
      emitBlock(inlineMatch[1] as BlockKind, [tokenizeBlockLine(inlineMatch[2])])
      justClosedContinued = inlineMatch[1] === 'continued'
      continue
    }

    if (justClosedContinued) {
      warn(`[md2tei] WARNING: orphan text between </continued> and the next <pb> — it will be treated as a new paragraph and may steal the following page's continuation merge: "${s}"`)
      justClosedContinued = false
    }

    const isHeading = s.startsWith('#')
    const stripped  = isHeading ? s.replace(/^#+\s*/, '') : s
    inHead = isHeading

    for (const tok of tokenizeLine(stripped)) {
      switch (tok.kind) {
        case 'text': {
          const t = tok.value.replace(/\s+/g, ' ')
          if (t.trim()) {
            // Text before any div is open: auto-open missing_first ancestors
            if (stack.length === 0) autoOpenAncestors(Infinity)
            pParts.push(esc(t))
          } else if (pParts.length > 0) {
            pParts.push(esc(t))
          }
          break
        }
        case 'lb':
          pParts.push(tok.raw)
          break
        case 'note':
          pParts.push(`<note>${esc(tok.inner.trim())}</note>`)
          break
        case 'cit':
          pParts.push(`<cit>${esc(tok.inner.trim())}</cit>`)
          break
        case 'bibl':
          pParts.push(`<bibl>${esc(tok.inner.trim())}</bibl>`)
          break
        case 'ref': {
          const lvlStr = parseAttrStr(tok.attrStr, 'level')
          const lvl    = lvlStr !== null ? (parseInt(lvlStr, 10) || null) : null
          const val    = tok.inner.trim()
          if (!lvl) {
            pParts.push(`<note>${esc(val)}</note>`)
          } else if (ms.has(lvl)) {
            const ms_xml = `<milestone unit="${escAttr(lm[lvl] ?? `level${lvl}`)}" n="${escAttr(val)}"/>`
            if (pParts.length > 0) {
              pParts.push(ms_xml)
            } else {
              autoOpenAncestors(lvl)
              out.push(ms_xml)
            }
          } else {
            flushP()
            openDiv(lvl, val)
          }
          break
        }
      }
    }

    flushP()
  }

  // An explicit block left unclosed at EOF (malformed input) — flush best-effort rather
  // than silently dropping its content.
  if (block) emitBlock(block, blockLines)

  while (stack.length) { out.push('</div>'); stack.pop() }
  return out.join('\n')
}

// ── Merge continuation paragraphs ─────────────────────────────────────────────

function mergeContinuations(doc: Document): void {
  // Walk actual doc root
  const candidates = [doc.documentElement, ...allElems(doc.documentElement, 'div'), ...allElems(doc.documentElement, 'body')]

  for (const parent of candidates) {
    let changed = true
    while (changed) {
      changed = false
      const kids = childElems(parent)
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i]
        if (!isTag(child, 'p')) continue

        // First text node must start with MARKER
        const firstNode = child.childNodes[0]
        if (!firstNode || firstNode.nodeType !== TEXT) continue
        if (!firstNode.nodeValue?.startsWith(MARKER)) continue

        // Extract content without mutating the text node (nodeValue setter is unreliable in @xmldom/xmldom)
        const contText = (firstNode.nodeValue ?? '').slice(MARKER.length)

        // Find preceding <pb>
        let pbElem: Element | null = null
        let pbIdx = -1
        for (let k = i - 1; k >= 0; k--) {
          if (isTag(kids[k], 'pb')) { pbElem = kids[k]; pbIdx = k; break }
          break // any other elem breaks the chain
        }
        // Find <p> before the <pb>
        let prevP: Element | null = null
        if (pbElem) {
          for (let k = pbIdx - 1; k >= 0; k--) {
            if (isTag(kids[k], 'p')) { prevP = kids[k]; break }
            break
          }
        }
        // No real continuation target (e.g. this <continued> block is on the
        // document's very first page, with no preceding <p> to merge into) — strip
        // the internal marker but keep the block's content intact as its own <p>
        // rather than discarding it.
        if (!pbElem || !prevP) {
          child.replaceChild(doc.createTextNode(contText), firstNode)
          continue
        }
        child.removeChild(firstNode)

        // Append trailing space to prevP's last text node so the <pb> reads as a word boundary
        const last = prevP.lastChild
        if (last && last.nodeType === TEXT) {
          prevP.replaceChild(doc.createTextNode((last.nodeValue ?? '').trimEnd() + ' '), last)
        }

        // Move <pb> into prevP then append continuation text (no leading space — <pb> is the separator)
        parent.removeChild(pbElem)
        prevP.appendChild(pbElem)
        if (contText.trim()) prevP.appendChild(doc.createTextNode(contText.trim()))

        // Move remaining children of continuation <p> into prevP
        const toMove = childNodes(child)
        for (const n of toMove) prevP.appendChild(n)

        parent.removeChild(child)
        changed = true
        break
      }
    }
  }
}

// ── Replace trailing hyphens with <lb break="no"/> ────────────────────────────

const HYPHEN_RE = /^(.*\p{L}+)-\s*$/su

function replaceHyphenation(doc: Document): void {
  const pElems = allElems(doc.documentElement, 'p')
  for (const p of pElems) {
    let i = 0
    while (i < p.childNodes.length) {
      const node = p.childNodes[i]
      if (node.nodeType !== TEXT) { i++; continue }

      const text = node.nodeValue ?? ''
      const m = HYPHEN_RE.exec(text)
      if (!m) { i++; continue }

      // Only insert lb if followed by more content
      let hasFollowing = false
      for (let k = i + 1; k < p.childNodes.length; k++) {
        const sib = p.childNodes[k]
        if (sib.nodeType === ELEM || (sib.nodeType === TEXT && sib.nodeValue?.trim())) {
          hasFollowing = true; break
        }
      }
      if (!hasFollowing) { i++; continue }

      // Replace text node via replaceChild (nodeValue setter is unreliable in @xmldom/xmldom)
      p.replaceChild(doc.createTextNode(m[1]), node)

      // If a real <lb n="id"/> anchor already sits right where the join happens (the
      // common case for Kraken/ALTO's per-physical-line anchors), mark that one
      // break="no" instead of inserting a redundant synthetic <lb/>.
      const nextNode = p.childNodes[i + 1]
      let lbIdx: number
      if (nextNode?.nodeType === ELEM && (nextNode as Element).localName === 'lb') {
        ;(nextNode as Element).setAttribute('break', 'no')
        lbIdx = i + 1
      } else {
        const lb = doc.createElementNS(NS, 'lb')
        lb.setAttribute('break', 'no')
        p.insertBefore(lb, nextNode ?? null)
        lbIdx = i + 1
      }

      // If the element after lb is a <pb>, mark it break="no" and strip its leading space
      const afterLb = p.childNodes[lbIdx + 1]
      if (afterLb?.nodeType === ELEM && (afterLb as Element).localName === 'pb') {
        ;(afterLb as Element).setAttribute('break', 'no')
        const afterPb = p.childNodes[lbIdx + 2]
        if (afterPb?.nodeType === TEXT) {
          const v = afterPb.nodeValue ?? ''
          if (v.startsWith(' ')) p.replaceChild(doc.createTextNode(v.slice(1)), afterPb)
        }
      }
      i = lbIdx + 1
    }
  }
}

// ── Inject missing-first child structural elements ────────────────────────────
//
// Post-processing pass: for every <div type="X"> whose child level has
// missing_first=true, if the first meaningful child (after <head>) is not
// already the expected <div type="…"> or <milestone unit="…">, inject the
// implicit start element before it.
//
// This catches cases where content runs at the start of a parent div before
// any explicit first child reference was written.

function injectMissingFirstChildren(doc: Document, levels: LevelDef[]): void {
  // Build map: parent div-type name → child LevelDef (only when missingFirst=true)
  const childMap = new Map<string, LevelDef>()
  for (let i = 0; i < levels.length - 1; i++) {
    const parent = levels[i]
    const child  = levels[i + 1]
    if (!parent.isMilestone && child.missingFirst) {
      childMap.set(parent.name, child)
    }
  }
  if (childMap.size === 0) return

  for (const div of allElems(doc.documentElement, 'div')) {
    const divType = (div as Element).getAttribute('type') ?? ''
    const childDef = childMap.get(divType)
    if (!childDef) continue

    // Find first meaningful child — skip <head> and <pb>
    const kids = childElems(div)
    const firstMeaningful = kids.find(k => !isTag(k, 'head') && !isTag(k, 'pb'))
    if (!firstMeaningful) continue

    const sv = startValue(childDef.format)

    if (childDef.isMilestone) {
      // Already has the expected milestone at the start?
      if (isTag(firstMeaningful, 'milestone') &&
          (firstMeaningful as Element).getAttribute('unit') === childDef.name) continue
      const ms = doc.createElementNS(NS, 'milestone')
      ms.setAttribute('unit', childDef.name)
      ms.setAttribute('n', sv)
      div.insertBefore(ms, firstMeaningful)
    } else {
      // Already has the expected child div at the start?
      if (isTag(firstMeaningful, 'div') &&
          (firstMeaningful as Element).getAttribute('type') === childDef.name) continue
      // Inject an empty opening div — content that precedes the first explicit
      // child div is wrapped into it by moving siblings until the next child div.
      const newDiv = doc.createElementNS(NS, 'div')
      newDiv.setAttribute('type', childDef.name)
      newDiv.setAttribute('n', sv)
      div.insertBefore(newDiv, firstMeaningful)
      // Move all children up to (but not including) the next sibling div of same type
      let sib = firstMeaningful as Node | null
      while (sib) {
        const next = sib.nextSibling
        if (sib.nodeType === ELEM) {
          const sibEl = sib as Element
          if (sibEl.localName === 'div' && sibEl.getAttribute('type') === childDef.name) break
        }
        newDiv.appendChild(sib)
        sib = next
      }
    }
  }
}

// ── citeStructure ─────────────────────────────────────────────────────────────

function buildCiteStructure(doc: Document, structNode: Record<string, unknown>, isRoot = true): Element {
  const name = String(structNode.name)
  const isMilestone = !!structNode.is_milestone
  const match = isRoot
    ? `/TEI/text/body/div[@type='${name}']`
    : isMilestone ? `milestone[@unit='${name}']` : `div[@type='${name}']`

  const el = doc.createElementNS(NS, 'citeStructure')
  el.setAttribute('match', match)
  el.setAttribute('unit', name)
  el.setAttribute('use', '@n')
  if (!isRoot) el.setAttribute('delim', '.')
  if (structNode.child) {
    el.appendChild(buildCiteStructure(doc, structNode.child as Record<string, unknown>, false))
  }
  return el
}

function addCiteStructure(doc: Document, config: Record<string, unknown>): void {
  const root = doc.documentElement
  let header = root.getElementsByTagNameNS(NS, 'teiHeader')[0] as Element | undefined
  if (!header) { header = doc.createElementNS(NS, 'teiHeader'); root.insertBefore(header, root.firstChild) }

  let encDesc = header.getElementsByTagNameNS(NS, 'encodingDesc')[0] as Element | undefined
  if (!encDesc) { encDesc = doc.createElementNS(NS, 'encodingDesc'); header.appendChild(encDesc) }

  // Ensure <appInfo> is present (inject programmatically to avoid namespace issues with template parsing)
  if (!encDesc.getElementsByTagNameNS(NS, 'appInfo')[0]) {
    const appInfo = doc.createElementNS(NS, 'appInfo')
    const application = doc.createElementNS(NS, 'application')
    application.setAttribute('ident', 'cllg-editor')
    application.setAttribute('version', '1.0')
    const label = doc.createElementNS(NS, 'label')
    label.textContent = 'CLLG Editor'
    const ptr = doc.createElementNS(NS, 'ptr')
    ptr.setAttribute('target', 'https://github.com/cllg-project/cllg-scanner')
    application.appendChild(label)
    application.appendChild(ptr)
    appInfo.appendChild(application)
    encDesc.insertBefore(appInfo, encDesc.firstChild)
  }

  const old = encDesc.getElementsByTagNameNS(NS, 'refsDecl')[0] as Element | undefined
  if (old) encDesc.removeChild(old)

  const refsDecl = doc.createElementNS(NS, 'refsDecl')
  refsDecl.appendChild(buildCiteStructure(doc, config.structure as Record<string, unknown>))
  encDesc.appendChild(refsDecl)
}

// ── Simple pretty-printer ─────────────────────────────────────────────────────

function prettyPrint(xml: string, space = '  '): string {
  const tokens = xml.match(/(<[^>]+>)|([^<]+)/g) ?? []
  const lines: string[] = []
  let depth = 0
  let inline = false  // true while inside <p> or <head>

  function tagName(t: string): string {
    return t.replace(/^<\/?/, '').split(/[\s/>]/)[0].toLowerCase()
  }

  for (const tok of tokens) {
    const t = tok.trim()
    if (!t) continue

    if (t.startsWith('<?') || t.startsWith('<!')) {
      lines.push(t)
    } else if (inline) {
      // Inside <p>/<head>: keep everything on the same line; preserve raw whitespace
      if (t.startsWith('</') && (tagName(t) === 'p' || tagName(t) === 'head')) {
        depth--
        inline = false
        lines.push(space.repeat(depth) + t)
      } else {
        if (lines.length) lines[lines.length - 1] += tok
        else lines.push(tok)
      }
    } else if (t.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      lines.push(space.repeat(depth) + t)
    } else if (t.endsWith('/>')) {
      lines.push(space.repeat(depth) + t)
    } else if (t.startsWith('<')) {
      lines.push(space.repeat(depth) + t)
      depth++
      if (tagName(t) === 'p' || tagName(t) === 'head') inline = true
    } else {
      if (lines.length) lines[lines.length - 1] += t
      else lines.push(t)
    }
  }
  return lines.join('\n')
}

// ── Reference scanner ─────────────────────────────────────────────────────────

export interface RefScanResult {
  format: string
  sample: string[]
  count: number
}

const SCAN_PATTERNS: { format: string; re: RegExp }[] = [
  { format: 'Roman',  re: /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i },
  { format: 'Arabic', re: /^\d+$/ },
  { format: 'Greek',  re: /^[Ͱ-Ͽἀ-῿]+$/ },
  { format: 'Alpha',  re: /^[a-z]{1,2}$/ },
]

export function scanRefs(markdownText: string): RefScanResult[] {
  const tokenRe = /\[([^\]]{1,20})\]/g
  const buckets = new Map<string, Map<string, number>>()
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(markdownText)) !== null) {
    const tok = m[1].trim()
    for (const { format, re } of SCAN_PATTERNS) {
      if (re.test(tok) && tok.length > 0) {
        if (!buckets.has(format)) buckets.set(format, new Map())
        const b = buckets.get(format)!
        b.set(tok, (b.get(tok) ?? 0) + 1)
        break
      }
    }
  }
  return [...buckets.entries()]
    .map(([format, vals]) => ({
      format,
      sample: [...vals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v]) => v),
      count: vals.size,
    }))
    .sort((a, b) => b.count - a.count)
}

// ── Bibliography / sourceDesc builder ────────────────────────────────────────

function buildPerson(tag: string, p: { persName: string; viafId?: string; worldcatId?: string }): string {
  const ref = p.viafId ? ` ref="https://viaf.org/viaf/${escAttr(p.viafId)}/"` : ''
  const idno = p.worldcatId ? `<idno type="worldcat">${esc(p.worldcatId)}</idno>` : ''
  return `<${tag}><persName${ref}>${esc(p.persName)}</persName>${idno}</${tag}>`
}

function buildBiblEntry(e: BibEntry): string {
  const parts: string[] = []

  for (const a of e.authors)  parts.push(buildPerson('author', a))
  for (const ed of e.editors) parts.push(buildPerson('editor', ed))

  if (e.title) {
    const lv = e.titleLevel ? ` level="${escAttr(e.titleLevel)}"` : ''
    parts.push(`<title${lv}>${esc(e.title)}</title>`)
  }

  const imp: string[] = []
  if (e.publisher)   imp.push(`<publisher>${esc(e.publisher)}</publisher>`)
  if (e.pubPlace)    imp.push(`<pubPlace>${esc(e.pubPlace)}</pubPlace>`)
  if (e.date)        imp.push(`<date>${esc(e.date)}</date>`)
  if (e.dateReprint) imp.push(`<date type="reprint">${esc(e.dateReprint)}</date>`)
  if (imp.length)    parts.push(`<imprint>${imp.join('')}</imprint>`)

  for (const s of e.scopes) {
    if (s.value) parts.push(`<biblScope unit="${escAttr(s.unit)}">${esc(s.value)}</biblScope>`)
  }

  const n = e.n ? ` n="${escAttr(e.n)}"` : ''
  return `<biblStruct${n}><monogr>${parts.join('')}</monogr></biblStruct>`
}

function buildSourceDesc(bibliography: BibEntry[]): string {
  if (!bibliography.length) return `<sourceDesc><p>Born-digital OCR</p></sourceDesc>`
  return `<sourceDesc><listBibl>${bibliography.map(buildBiblEntry).join('')}</listBibl></sourceDesc>`
}

// ── Main entry ────────────────────────────────────────────────────────────────

export interface Md2TeiParams {
  markdownText: string
  yamlConfigText: string
  bibliography?: BibEntry[]
  log: (line: string) => void
}

export function runMd2Tei({ markdownText, yamlConfigText, bibliography = [], log }: Md2TeiParams): string {
  log('[md2tei] Parsing config')
  const config = (parseYaml(yamlConfigText) as Record<string, unknown> | null) ?? {}

  // A project can legitimately have no reference hierarchy configured (e.g. a quick
  // transcription with no citation scheme) — TEI generation must still succeed, just
  // without any <div> nesting or <citeStructure>, rather than erroring on undefined.
  const hasStructure = !!config.structure
  const levels = hasStructure ? buildLevels(config.structure as Record<string, unknown>) : []
  const lm = levelMap(levels)
  const ms = milestoneSet(levels)

  log('[md2tei] Building TEI body')
  const body = buildBody(markdownText, lm, ms, levels, log)

  const teiStr = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>OCR Document</title></titleStmt>
      <publicationStmt><p>Generated by CLLG Desktop</p></publicationStmt>
      ${buildSourceDesc(bibliography)}
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
${body}
      </div>
    </body>
  </text>
</TEI>`

  log('[md2tei] Parsing XML tree')
  const parser = new DOMParser()
  const doc = parser.parseFromString(teiStr, 'text/xml')

  log('[md2tei] Merging continuation paragraphs')
  mergeContinuations(doc)

  log('[md2tei] Injecting missing-first child elements')
  injectMissingFirstChildren(doc, levels)

  log('[md2tei] Replacing hyphenation with <lb/>')
  replaceHyphenation(doc)

  if (hasStructure) {
    log('[md2tei] Injecting citeStructure')
    addCiteStructure(doc, config)
  } else {
    log('[md2tei] No hierarchy configured — skipping citeStructure')
  }

  log('[md2tei] Serializing')
  const raw = new XMLSerializer().serializeToString(doc)
  const pretty = prettyPrint(raw)
  log('[md2tei] Done')
  return pretty
}
