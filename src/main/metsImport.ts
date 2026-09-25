import { DOMParser } from '@xmldom/xmldom'

function firstChild(node: Element, tag: string): Element | null {
  const els = node.getElementsByTagName(tag)
  return els.length > 0 ? (els[0] as Element) : null
}

function basenameOf(pathOrUrl: string): string {
  return pathOrUrl.split(/[/\\]/).pop() ?? pathOrUrl
}

/**
 * Reads a METS manifest's page order for its ALTO files: eScriptorium (and other
 * archival tools) export ALTO folders with filenames that are internal IDs, not page
 * numbers — natural filename sort is not reliable reading order. The METS file's
 * `fileSec` maps file IDs to hrefs, and its physical `structMap`'s `<div>`/`<fptr>`
 * sequence (document order, honoring `ORDER` when present) is the actual page order.
 * Returns an ordered list of ALTO file basenames, or `[]` if the METS can't be read or
 * has no usable structMap — callers should fall back to filename sort in that case.
 */
export function parseMetsFileOrder(xmlText: string): string[] {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xmlText, 'text/xml') as unknown as Document
  } catch {
    return []
  }

  const hrefById = new Map<string, string>()
  const files = doc.getElementsByTagName('file')
  for (let i = 0; i < files.length; i++) {
    const file = files[i] as Element
    const id = file.getAttribute('ID')
    if (!id) continue
    const flocat = firstChild(file, 'FLocat')
    const href = flocat?.getAttribute('xlink:href') || flocat?.getAttribute('href')
    if (href) hrefById.set(id, href)
  }
  if (hrefById.size === 0) return []

  const structMaps = doc.getElementsByTagName('structMap')
  let physical: Element | null = null
  for (let i = 0; i < structMaps.length; i++) {
    const sm = structMaps[i] as Element
    if ((sm.getAttribute('TYPE') || '').toLowerCase() === 'physical') {
      physical = sm
      break
    }
  }
  if (!physical && structMaps.length > 0) physical = structMaps[0] as Element
  if (!physical) return []

  // <div ORDER="n"> is only sometimes present (and not always contiguous/1-based in
  // real exports) — document order of the <fptr> elements is the one thing every
  // structMap variant agrees on, so that's what's used, with ORDER only as a tiebreak
  // for divs that do carry it.
  type Entry = { order: number | null; seq: number; href: string }
  const entries: Entry[] = []
  const fptrs = physical.getElementsByTagName('fptr')
  for (let i = 0; i < fptrs.length; i++) {
    const fptr = fptrs[i] as Element
    const fileId = fptr.getAttribute('FILEID')
    const href = fileId ? hrefById.get(fileId) : undefined
    if (!href) continue
    const parentDiv = fptr.parentNode as Element | null
    const orderAttr = parentDiv?.getAttribute?.('ORDER')
    const order = orderAttr && /^\d+$/.test(orderAttr) ? Number(orderAttr) : null
    entries.push({ order, seq: entries.length, href })
  }

  entries.sort((a, b) => {
    if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order
    return a.seq - b.seq
  })

  return entries.map((e) => basenameOf(e.href))
}

/**
 * Reorders `fileNames` (already filename-sorted) to follow `metsOrder` (from
 * parseMetsFileOrder()), matched case-insensitively by basename. Any name METS doesn't
 * mention is kept out of the way at the end, in its original relative order — a partial
 * or slightly-mismatched METS (e.g. one extra scan added after export) degrades to "METS
 * pages first, then whatever's left" rather than losing pages outright.
 */
export function applyMetsOrder(fileNames: string[], metsOrder: string[]): string[] {
  if (metsOrder.length === 0) return fileNames
  const rank = new Map(metsOrder.map((name, i) => [name.toLowerCase(), i]))
  return [...fileNames].sort((a, b) => {
    const ra = rank.get(a.toLowerCase()) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b.toLowerCase()) ?? Number.MAX_SAFE_INTEGER
    return ra - rb
  })
}
