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

// ── Continuation marking ──────────────────────────────────────────────────────

function markContinuations(md: string): string {
  const lines = md.split('\n')
  const out = [...lines]
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('<pb')) continue
    let j = i + 1
    while (j < lines.length && !lines[j].trim()) j++
    if (j >= lines.length) continue
    const nxt = lines[j].trim()
    if (nxt.startsWith('#') || nxt.startsWith('<tab/>') || nxt.startsWith('<ref>')) continue
    out[j] = '__CONTINUATION__' + lines[j]
  }
  return out.join('\n')
}

// ── Line tokeniser ────────────────────────────────────────────────────────────

type LineToken =
  | { kind: 'text'; value: string }
  | { kind: 'ref';  attrStr: string; inner: string }
  | { kind: 'note'; inner: string }
  | { kind: 'lb';   raw: string }

function tokenizeLine(s: string): LineToken[] {
  const tokens: LineToken[] = []
  const re = /(<lb[^>]*\/>|<ref[^>]*>.*?<\/ref>|<note>.*?<\/note>|<tab\/>)/gs
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: s.slice(last, m.index) })
    const tag = m[0]
    if (tag.startsWith('<lb'))   tokens.push({ kind: 'lb', raw: normSelfClose(tag) })
    else if (tag.startsWith('<tab')) { /* structural indent — drop */ }
    else if (tag.startsWith('<ref')) {
      const am = /^<ref([^>]*)>(.*?)<\/ref>$/s.exec(tag)
      if (am) tokens.push({ kind: 'ref', attrStr: am[1], inner: am[2] })
    } else if (tag.startsWith('<note')) {
      const nm = /^<note>(.*?)<\/note>$/s.exec(tag)
      if (nm) tokens.push({ kind: 'note', inner: nm[1] })
    }
    last = m.index + m[0].length
  }
  if (last < s.length) tokens.push({ kind: 'text', value: s.slice(last) })
  return tokens
}

// ── Build div/milestone/p body ────────────────────────────────────────────────
//
// Rules:
//   • <ref level="N"> where N is a div-level  → close current <p>, close deeper
//     divs, open <div type="…" n="…">; if any ancestor div-level with
//     missing_first=true hasn't been opened yet, auto-open it first
//   • <ref level="N"> where N is a milestone  → inline within current <p>;
//     outside only if no paragraph is open yet
//   • Heading lines (#…): text after the first div-ref goes into <head>, not <p>
//   • All other text / <note> / <lb/>          → inline content of current <p>
//   • Unclassified <ref> (no level or level 0) → treated as <note>
//   • Plain text before any div is open + a div-level with missing_first=true
//     → auto-open that div with its format's start value

function buildBody(
  md: string,
  lm: Record<number, string>,
  ms: Set<number>,
  levels: LevelDef[]
): string {
  const out: string[] = []
  const stack: number[] = []
  let pParts: string[] = []
  let inHead = false

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

  for (const rawLine of md.split('\n')) {
    const s = rawLine.trim()
    if (!s) continue

    if (s.startsWith('<pb')) { flushP(); out.push(normSelfClose(s)); continue }

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
            while (stack.length && stack[stack.length - 1] >= lvl) { out.push('</div>'); stack.pop() }
            autoOpenAncestors(lvl)
            out.push(`<div type="${escAttr(lm[lvl] ?? `level${lvl}`)}" n="${escAttr(val)}">`)
            stack.push(lvl)
          }
          break
        }
      }
    }

    flushP()
  }

  while (stack.length) { out.push('</div>'); stack.pop() }
  return out.join('\n')
}

// ── Merge continuation paragraphs ─────────────────────────────────────────────

const MARKER = '__CONTINUATION__'

function mergeContinuations(doc: Document): void {
  // Collect all parent elements that may contain <p> children
  const parents = allElems(doc, '*').filter(el => childElems(el).some(c => isTag(c, 'p')))
  // Also walk actual doc root
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
        child.removeChild(firstNode)

        // Find preceding <pb>
        let pbElem: Element | null = null
        let pbIdx = -1
        for (let k = i - 1; k >= 0; k--) {
          if (isTag(kids[k], 'pb')) { pbElem = kids[k]; pbIdx = k; break }
          break // any other elem breaks the chain
        }
        if (!pbElem) continue

        // Find <p> before the <pb>
        let prevP: Element | null = null
        for (let k = pbIdx - 1; k >= 0; k--) {
          if (isTag(kids[k], 'p')) { prevP = kids[k]; break }
          break
        }
        if (!prevP) continue

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
      const lb = doc.createElementNS(NS, 'lb')
      lb.setAttribute('break', 'no')
      p.insertBefore(lb, p.childNodes[i + 1] ?? null)

      // If the element after lb is a <pb>, mark it break="no" and strip its leading space
      const afterLb = p.childNodes[i + 2]
      if (afterLb?.nodeType === ELEM && (afterLb as Element).localName === 'pb') {
        ;(afterLb as Element).setAttribute('break', 'no')
        const afterPb = p.childNodes[i + 3]
        if (afterPb?.nodeType === TEXT) {
          const v = afterPb.nodeValue ?? ''
          if (v.startsWith(' ')) p.replaceChild(doc.createTextNode(v.slice(1)), afterPb)
        }
      }
      i += 2
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
  const config = parseYaml(yamlConfigText) as Record<string, unknown>

  const levels = buildLevels(config.structure as Record<string, unknown>)
  const lm = levelMap(levels)
  const ms = milestoneSet(levels)

  log('[md2tei] Marking continuations')
  const md = markContinuations(markdownText)

  log('[md2tei] Building TEI body')
  const body = buildBody(md, lm, ms, levels)

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

  log('[md2tei] Injecting citeStructure')
  addCiteStructure(doc, config)

  log('[md2tei] Serializing')
  const raw = new XMLSerializer().serializeToString(doc)
  const pretty = prettyPrint(raw)
  log('[md2tei] Done')
  return pretty
}
