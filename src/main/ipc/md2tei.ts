/**
 * Pure TypeScript md2tei converter.
 * Replaces the Python subprocess — no lxml, no regex module, works on all platforms.
 */

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { parse as parseYaml } from 'yaml'

const NS = 'http://www.tei-c.org/ns/1.0'
const ELEM = 1
const TEXT = 3

// ── XML helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

interface LevelDef { level: number; name: string; isMilestone: boolean }

function buildLevels(structure: Record<string, unknown>, depth = 1): LevelDef[] {
  const out: LevelDef[] = [{
    level: depth,
    name: String(structure.name ?? `lvl${depth}`),
    isMilestone: !!structure.is_milestone,
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

// ── Build div/milestone/p body ────────────────────────────────────────────────

function buildBody(
  md: string,
  lm: Record<number, string>,
  ms: Set<number>
): string {
  const out: string[] = []
  const stack: number[] = []

  for (const line of md.split('\n')) {
    const s = line.trim()
    if (!s) continue

    if (s.startsWith('<pb')) { out.push(s); continue }

    const notes = [...s.matchAll(/<note>(.*?)<\/note>/gs)].map(m => m[1])
    const refs  = [...s.matchAll(/<ref([^>]*)>(.*?)<\/ref>/g)].map(m => [m[1], m[2]] as const)

    if (!refs.length) {
      const notesXml = notes.map(n => n.trim()).filter(Boolean).map(n => `<note>${esc(n)}</note>`).join('')
      const txt = s.replace(/<tab\/>\s*/g, '').replace(/<note>.*?<\/note>/gs, '').trim()
      if (txt || notesXml) out.push(`<p>${esc(txt)}${notesXml}</p>`)
      continue
    }

    const pRef = (a: string, v: string): [string, number | null] => {
      const ls = parseAttrStr(a, 'level')
      const lvl = ls !== null ? (parseInt(ls, 10) || null) : null
      return [v.trim(), lvl]
    }

    const emitInline = (a: string, v: string): string => {
      const [val, lvl] = pRef(a, v)
      if (!lvl) return `<note>${esc(val)}</note>`
      if (ms.has(lvl)) return `<milestone unit="${lm[lvl] ?? `level${lvl}`}" n="${val}"/>`
      return `<note>${esc(val)}</note>`
    }

    const [fa, fv] = refs[0]
    const [rv, rl] = pRef(fa, fv)
    const extras  = refs.slice(1).map(([a, v]) => emitInline(a, v)).join('')
    const txt     = s.replace(/<ref[^>]*>.*?<\/ref>/g, '').replace(/<note>.*?<\/note>/gs, '').replace(/<tab\/>\s*/g, '').trim()
    const pNotes  = notes.map(n => n.trim()).filter(Boolean).map(n => `<note>${esc(n)}</note>`).join('')

    if (!rl) {
      out.push(`<note>${esc(rv)}</note>`)
      if (txt) out.push(`<p>${esc(txt)}${extras}${pNotes}</p>`)
      else if (extras || pNotes) out.push(extras + pNotes)
      continue
    }

    if (ms.has(rl)) {
      out.push(`<milestone unit="${lm[rl] ?? `level${rl}`}" n="${rv}"/>`)
      if (txt) out.push(`<p>${esc(txt)}${extras}${pNotes}</p>`)
      else if (extras || pNotes) out.push(extras + pNotes)
      continue
    }

    while (stack.length && stack[stack.length - 1] >= rl) { out.push('</div>'); stack.pop() }
    out.push(`<div type="${lm[rl] ?? `level${rl}`}" n="${rv}">`)
    stack.push(rl)

    if (s.startsWith('#')) {
      const h = s.replace(/^#+\s*/, '').replace(/<ref[^>]*>.*?<\/ref>\s*/g, '').replace(/<note>.*?<\/note>/gs, '').trim()
      if (h) out.push(`<head>${esc(h)}</head>`)
      if (pNotes) out.push(pNotes)
    } else if (txt || extras || pNotes) {
      out.push(`<p>${esc(txt)}${extras}${pNotes}</p>`)
    }
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

        firstNode.nodeValue = firstNode.nodeValue.slice(MARKER.length)

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

        // Append space to prevP
        const last = prevP.lastChild
        if (last && last.nodeType === TEXT) {
          last.nodeValue = (last.nodeValue ?? '').trimEnd() + ' '
        } else {
          prevP.appendChild(doc.createTextNode(' '))
        }

        // Move <pb> into prevP, carrying continuation text as its tail
        parent.removeChild(pbElem)
        const contText = firstNode.nodeValue ?? ''
        firstNode.nodeValue = ''
        prevP.appendChild(pbElem)
        prevP.appendChild(doc.createTextNode(' ' + contText.trim()))

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

      node.nodeValue = m[1]
      const lb = doc.createElementNS(NS, 'lb')
      lb.setAttribute('break', 'no')
      const next = p.childNodes[i + 1] ?? null
      p.insertBefore(lb, next)
      i += 2
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
  // Normalise: one token per line
  const tokens = xml.match(/(<[^>]+>)|([^<]+)/g) ?? []
  const lines: string[] = []
  let depth = 0

  for (const tok of tokens) {
    const t = tok.trim()
    if (!t) continue
    if (t.startsWith('<?') || t.startsWith('<!')) {
      lines.push(t)
    } else if (t.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      lines.push(space.repeat(depth) + t)
    } else if (t.endsWith('/>')) {
      lines.push(space.repeat(depth) + t)
    } else if (t.startsWith('<')) {
      lines.push(space.repeat(depth) + t)
      depth++
    } else {
      // text content — append to previous line
      if (lines.length) lines[lines.length - 1] += t
      else lines.push(t)
    }
  }
  return lines.join('\n')
}

// ── Main entry ────────────────────────────────────────────────────────────────

export interface Md2TeiParams {
  markdownText: string
  yamlConfigText: string
  log: (line: string) => void
}

export function runMd2Tei({ markdownText, yamlConfigText, log }: Md2TeiParams): string {
  log('[md2tei] Parsing config')
  const config = parseYaml(yamlConfigText) as Record<string, unknown>

  const levels = buildLevels(config.structure as Record<string, unknown>)
  const lm = levelMap(levels)
  const ms = milestoneSet(levels)

  log('[md2tei] Marking continuations')
  const md = markContinuations(markdownText)

  log('[md2tei] Building TEI body')
  const body = buildBody(md, lm, ms)

  const teiStr = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>OCR Document</title></titleStmt>
      <publicationStmt><p>Generated by CLLG Desktop</p></publicationStmt>
      <sourceDesc><p>Born-digital OCR</p></sourceDesc>
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
