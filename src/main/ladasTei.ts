import type { ZoneAction } from '@shared/types'

// Generic LADaS zone → TEI conversion, following the "Suggested TEI mapping" of every
// label in the LADaS Annotation Guidelines (Level 1 from SegmOnto: MainZone,
// MarginTextZone, GraphicZone, RunningTitleZone…; Level 2 from the TEI: -P, -Head,
// -PQuoted, -Item, -Lg…, joined by a hyphen: "MainZone-Head", "MarginTextZone-P").
//
// Standalone for now: nothing in the pipeline calls it yet. md2tei.ts and
// regionMerge.ts only know the four block roles (p / quote / head / continued), margins
// and drop capitals; this module covers the whole vocabulary. The zones those already
// handle are converted the same way here, so the two can be swapped later:
//
//   MainZone-P → <p>, MainZone-PQuoted → <quote>, MainZone-Head → <head>,
//   MainZone-Continued → merged into the previous page's block (across its <pb/>),
//   MarginTextZone → <note>, (MainZone-)DropCapital(Zone) → glued to the next line,
//   CustomZone-Noise → dropped; running titles, page numbers, quire marks, stamps and
//   digitisation artefacts are dropped too with `materialZones: 'drop'` (what the
//   Kraken merge does today), or kept as <fw>/<stamp>/<ab> per the guidelines ('fw',
//   the default).
//
// Where a guideline mapping is not valid TEI on its own, the nearest valid structure is
// emitted and the deviation is noted next to its entry in LEVEL2 / LEVEL1 below.

export interface LadasLabel {
  raw: string
  level1: string          // "MainZone", "MarginTextZone", "RunningTitleZone", "CustomZone"…
  level2?: string         // "P", "Head", "PQuoted"… — absent for a bare Level-1 label
  suffix?: string         // eScriptorium's trailing "#lang"/"#tag" ("MainZone-P#latin" → "latin")
}

/**
 * Splits a LADaS label into its levels. Accepts the hyphen (guidelines, eScriptorium) and
 * colon (CLLG's internal regionType) separators and a trailing `#suffix`. Material zones
 * take no Level 2 (`-Ab` is implicit, per the guidelines): "RunningTitleZone-Ab" parses
 * the same as "RunningTitleZone". The D-FINE model's own "DropCapitalZone" is read as
 * the guidelines' "MainZone-DropCapital". Returns null for a label that isn't LADaS
 * (no "…Zone" Level 1).
 */
export function parseLadasLabel(type: string | undefined): LadasLabel | null {
  if (!type) return null
  const [body, suffix] = type.split('#', 2)
  const m = /^([A-Za-z]+Zone)(?:[-:](.+))?$/.exec(body.trim())
  if (!m) return null
  let level1 = m[1]
  let level2 = m[2] || undefined
  // The guidelines spell it both ways; the vocabulary's own label is "Digitization".
  if (level1 === 'DigitisationArtefactZone') level1 = 'DigitizationArtefactZone'
  if (level1 === 'DropCapitalZone') {
    level1 = 'MainZone'
    level2 = 'DropCapital'
  }
  if (level2 === 'Ab' && MATERIAL_ZONES.has(level1)) level2 = undefined
  return { raw: type, level1, ...(level2 ? { level2 } : {}), ...(suffix ? { suffix } : {}) }
}

// Material zones: text coming from the materiality of the document, not its content.
const MATERIAL_ZONES = new Set([
  'DigitizationArtefactZone',
  'NumberingZone',
  'RunningTitleZone',
  'StampZone',
  'QuireMarksZone',
])

// Zones that hold other zones (the guidelines' "imbrication": a GraphicZone around its
// GraphicZone-Head caption, a FormZone around its -Field and -Part zones…).
const CONTAINER_ZONES = new Set(['GraphicZone', 'FigureZone', 'TableZone', 'FormZone', 'TitlePageZone', 'MusicZone'])

type Attrs = Record<string, string>

/**
 * How one zone becomes TEI:
 *   block    — a text element holding the zone's lines (`<p>`, `<head>`, `<ab>`…);
 *              `lineEl` wraps each line on its own (`<l>` in `<lg>`), `inList` puts
 *              consecutive items in one `<list>`, `inside` nests the block in other
 *              elements, outermost first (a margin verse group is `<note><lg>…</lg></note>`).
 *   continued — cut text: merged into the previous block (see convertLadasPages).
 *   dropcap  — a drop capital: glued to the start of the next text line.
 *   drop     — not converted (noise).
 */
export type TeiMapping =
  | { kind: 'block'; element: string; attrs: Attrs; lineEl?: string; inList?: boolean; inside?: { element: string; attrs: Attrs }[] }
  | { kind: 'continued' }
  | { kind: 'dropcap' }
  | { kind: 'drop' }

const block = (element: string, attrs: Attrs = {}, extra: Partial<Extract<TeiMapping, { kind: 'block' }>> = {}): TeiMapping =>
  ({ kind: 'block', element, attrs, ...extra })

// Level-2 labels of the text zones (MainZone, MarginTextZone).
const LEVEL2: Record<string, TeiMapping> = {
  Head: block('head'),
  HeadStructured: block('head', { type: 'structured' }),
  P: block('p'),
  PLabelled: block('p', { rend: 'labelled' }),
  // <bibl> is only suggested for manually annotated bibliographic entries.
  PStructured: block('p', { type: 'structured' }),
  PQuoted: block('quote'),
  PStyled: block('p', { rend: 'styled' }),
  Item: block('item', {}, { inList: true }),
  Lg: block('lg', {}, { lineEl: 'l' }),
  Dateline: block('dateline'),
  // <address> holds <addrLine>s, not text.
  Address: block('address', {}, { lineEl: 'addrLine' }),
  Signed: block('signed'),
  Ab: block('ab'),
  Continued: { kind: 'continued' },
  // Guidelines: <graphic type="maths">, but <graphic> is empty — the recognized text
  // is kept in a typed <figure>.
  Maths: block('figure', { type: 'maths' }, { lineEl: 'ab' }),
  DropCapital: { kind: 'dropcap' },
  // Not in the guidelines, but emitted by models trained on older LADaS versions.
  Notes: block('p'),
}

// Bare Level-1 labels (and the default of each Level 1 when its Level 2 is unknown).
const LEVEL1: Record<string, TeiMapping> = {
  MainZone: block('p'),
  MarginTextZone: block('note'),
  // Not manually annotated: <div type="titlePage"> (a <titlePage> needs <front>).
  TitlePageZone: block('div', { type: 'titlePage' }, { lineEl: 'ab' }),
  GraphicZone: block('figure', {}, { lineEl: 'ab' }),
  FigureZone: block('figure', { type: 'code' }, { lineEl: 'ab' }),
  // No table extractor: <figure type="table">.
  TableZone: block('figure', { type: 'table' }, { lineEl: 'ab' }),
  FormZone: block('figure', { type: 'form' }, { lineEl: 'ab' }),
  // <notatedMusic> holds no text: the recognized lines go in its <desc>.
  MusicZone: block('notatedMusic', {}, { lineEl: 'desc' }),
  DigitizationArtefactZone: block('ab', { type: 'digitisation-artefact' }),
  NumberingZone: block('fw', { type: 'numbering' }),
  RunningTitleZone: block('fw', { type: 'runningTitle' }),
  QuireMarksZone: block('fw', { type: 'quiremarks' }),
  // <stamp> is phrase-level: it sits in an <ab>.
  StampZone: block('stamp', {}, { inside: [{ element: 'ab', attrs: { type: 'stamp' } }] }),
}

// Level 2 inside a container zone (GraphicZone-Head, FormZone-Field…).
const CONTAINER_LEVEL2: Record<string, TeiMapping> = {
  Head: block('head'),
  P: block('p'),
  Ab: block('ab'),
  // Guidelines: <graphic> / <graphic type="decoration">, both empty: a nested <figure>
  // keeps the part's own text (a subcaption).
  Part: block('figure', {}, { lineEl: 'ab' }),
  Decoration: block('figure', { type: 'decoration' }, { lineEl: 'ab' }),
  Maths: block('figure', { type: 'maths' }, { lineEl: 'ab' }),
  // Guidelines: <cell>, which needs a <table>/<row>; until fields are extracted as
  // key–value pairs, each field is a typed <ab>.
  Field: block('ab', { type: 'field' }),
  Continued: { kind: 'continued' },
}

export interface ConvertOptions {
  /** Running titles, numbers, quire marks, stamps, artefacts: kept per the guidelines, or dropped. */
  materialZones?: 'fw' | 'drop'
  /** The project's zone policy (Document step): a type set to `drop` is left out. */
  zonePolicy?: Record<string, ZoneAction>
}

/** The TEI mapping of one LADaS label. A label that isn't LADaS becomes a typed <ab>. */
export function teiMappingFor(type: string | undefined, opts: ConvertOptions = {}): TeiMapping {
  if (type && opts.zonePolicy?.[type] === 'drop') return { kind: 'drop' }
  const label = parseLadasLabel(type)
  if (!label) return block('ab', type ? { type } : {})
  if (label.level1 === 'CustomZone') return label.level2 === 'Noise' ? { kind: 'drop' } : block('ab', { type: label.level2 ?? 'custom' })
  if (MATERIAL_ZONES.has(label.level1) && opts.materialZones === 'drop') return { kind: 'drop' }

  const l2 = label.level2
  let mapping: TeiMapping | undefined
  if (l2 && CONTAINER_ZONES.has(label.level1)) mapping = CONTAINER_LEVEL2[l2]
  if (!mapping && l2) mapping = LEVEL2[l2]
  if (label.level1 === 'MarginTextZone' && l2) {
    if (l2 === 'ManuscriptAddendum') return block('note', { type: 'handwritten' })
    // A margin zone is a <note> (a margin paragraph is the note's own text, as the
    // Kraken merge writes it); any other Level 2 types what the note holds.
    if (mapping?.kind !== 'block' || mapping.element === 'p') return block('note')
    const note = { element: 'note', attrs: {} }
    return mapping.inList
      ? { ...mapping, inList: false, inside: [note, { element: 'list', attrs: {} }] }
      : { ...mapping, inside: [note] }
  }
  return mapping ?? LEVEL1[label.level1] ?? block('ab', { type: label.raw })
}

// ── Conversion ──

export interface ZoneBox {
  x: number
  y: number
  width: number
  height: number
}

export interface LadasZoneIn {
  id?: string
  type: string
  rect?: ZoneBox                             // used to nest captions/parts in their container
  lines: { id?: string; text: string }[]     // in reading order
}

export interface LadasPageIn {
  n: string | number
  zones: LadasZoneIn[]                       // in reading order
}

type TeiNode = { el: string; attrs: Attrs; children: (TeiNode | string)[] }

const node = (el: string, attrs: Attrs = {}, children: (TeiNode | string)[] = []): TeiNode => ({ el, attrs, children })

// Share of a zone's box that must lie inside a container zone for it to nest there.
const MIN_NESTED = 0.8

function containedIn(inner: ZoneBox, outer: ZoneBox): boolean {
  const w = Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x)
  const h = Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y)
  const a = inner.width * inner.height
  return a > 0 && w > 0 && h > 0 && (w * h) / a >= MIN_NESTED
}

/** Lines as TEI content: one `<lb/>` before each line (`n` = the line's id when it has one). */
function lineContent(lines: { id?: string; text: string }[]): (TeiNode | string)[] {
  const out: (TeiNode | string)[] = []
  for (const l of lines) {
    out.push(node('lb', l.id ? { n: l.id } : {}))
    out.push(l.text.trim())
  }
  return out
}

/**
 * Converts pages of LADaS-typed zones into TEI `<body>` content: a `<pb n="…"/>` per page,
 * then each zone's element in reading order.
 *
 * - A `-Continued` zone is merged into the last block before it — typically the previous
 *   page's paragraph, which then holds that page's `<pb/>` — as md2tei.ts does for
 *   `<continued>`. With no block to continue (first zone of the document), it is kept as
 *   `<ab rend="continued">`, as the guidelines suggest.
 * - Consecutive `-Item` zones share one `<list>`.
 * - A zone lying inside a container zone (GraphicZone, TableZone, FormZone…) of the same
 *   Level 1 is nested in it (a caption in its figure), when both have a `rect`.
 * - A drop capital is glued to the start of the first line of the next text zone.
 */
export function convertLadasPages(pages: LadasPageIn[], opts: ConvertOptions = {}): string {
  const body: TeiNode[] = []
  let lastBlock: TeiNode | null = null           // merge target of a -Continued zone
  let lastBlockTop = -1                          // its (or its list's) index in `body`
  let openList: TeiNode | null = null
  let pendingPb: TeiNode | null = null           // page break not placed yet
  let placedPb = -1                              // index in `body` of the current page's <pb/>
  let pendingDropCap = ''

  const place = (n: TeiNode): number => {
    if (pendingPb) {
      placedPb = body.push(pendingPb) - 1
      pendingPb = null
    }
    return body.push(n) - 1
  }

  for (const page of pages) {
    pendingPb = node('pb', { n: String(page.n) })
    placedPb = -1
    openList = null

    // Nest zones inside the container zone around them (same Level 1).
    const labels = page.zones.map((z) => parseLadasLabel(z.type))
    const parentOf = new Map<number, number>()
    page.zones.forEach((z, i) => {
      const li = labels[i]
      if (!z.rect || !li || !li.level2) return
      page.zones.forEach((c, j) => {
        const lj = labels[j]
        if (j === i || parentOf.has(i) || !c.rect || !lj || lj.level2) return
        if (lj.level1 === li.level1 && CONTAINER_ZONES.has(lj.level1) && containedIn(z.rect!, c.rect)) parentOf.set(i, j)
      })
    })
    const containerNodes = new Map<number, TeiNode>()

    page.zones.forEach((zone, i) => {
      const mapping = teiMappingFor(zone.type, opts)
      if (mapping.kind === 'drop') return
      if (mapping.kind === 'dropcap') {
        pendingDropCap += zone.lines.map((l) => l.text.trim()).join('')
        return
      }
      let lines = zone.lines.filter((l) => l.text.trim())
      if (pendingDropCap && lines.length) {
        lines = [{ ...lines[0], text: pendingDropCap + lines[0].text.trim() }, ...lines.slice(1)]
        pendingDropCap = ''
      }

      if (mapping.kind === 'continued') {
        if (lastBlock) {
          // The page break falls inside the continued block (md2tei.ts's convention),
          // together with anything of the new page already placed before this zone
          // (its running title, a margin note…).
          if (pendingPb) {
            lastBlock.children.push(pendingPb)
            pendingPb = null
          } else if (placedPb > lastBlockTop) {
            lastBlock.children.push(...body.splice(placedPb))
            placedPb = -1
          }
          lastBlock.children.push(...lineContent(lines))
          return
        }
        const ab = node('ab', { rend: 'continued' }, lineContent(lines))
        lastBlockTop = place(ab)
        lastBlock = ab
        openList = null
        return
      }

      const el = node(
        mapping.element,
        mapping.attrs,
        mapping.lineEl ? lines.map((l) => node(mapping.lineEl!, {}, lineContent([l]))) : lineContent(lines)
      )
      let outer = el
      for (const w of [...(mapping.inside ?? [])].reverse()) outer = node(w.element, w.attrs, [outer])

      const parent = parentOf.get(i)
      if (parent !== undefined) {
        // The container comes first in document order even if the caption was read first.
        let container = containerNodes.get(parent)
        if (!container) {
          container = containerNode(page.zones[parent], opts)
          containerNodes.set(parent, container)
          place(container)
        }
        container.children.push(outer)
        return
      }
      if (containerNodes.has(i)) {
        // Container already placed by one of its children: only add its own lines.
        containerNodes.get(i)!.children.unshift(...el.children)
        return
      }
      if (CONTAINER_ZONES.has(labels[i]?.level1 ?? '') && !labels[i]?.level2) containerNodes.set(i, el)

      let top: number
      if (mapping.inList) {
        if (!openList) {
          openList = node('list')
          top = place(openList)
        } else {
          top = body.lastIndexOf(openList)
        }
        openList.children.push(outer)
      } else {
        openList = null
        top = place(outer)
      }
      // Running text can be continued; a heading, dateline, signature… ends it; notes,
      // figures and forme work (running titles, page numbers) sit alongside it.
      if (CONTINUABLE.has(mapping.element) && !mapping.inside && !(mapping.element === 'ab' && mapping.attrs.type)) {
        lastBlock = el
        lastBlockTop = top
      } else if (ENDS_TEXT.has(mapping.element)) {
        lastBlock = null
      }
    })
  }
  if (pendingPb) body.push(pendingPb)
  return body.map((n) => serialize(n, 0)).join('\n')
}

const CONTINUABLE = new Set(['p', 'quote', 'item', 'lg', 'ab'])
const ENDS_TEXT = new Set(['head', 'dateline', 'signed', 'address', 'div'])

function containerNode(zone: LadasZoneIn, opts: ConvertOptions): TeiNode {
  const m = teiMappingFor(zone.type, opts)
  const n = m.kind === 'block' ? node(m.element, m.attrs) : node('figure')
  if (m.kind === 'block' && m.lineEl) n.children.push(...zone.lines.filter((l) => l.text.trim()).map((l) => node(m.lineEl!, {}, lineContent([l]))))
  else n.children.push(...lineContent(zone.lines.filter((l) => l.text.trim())))
  return n
}

/** Converts a single page's zones; see convertLadasPages. */
export function convertLadasZones(zones: LadasZoneIn[], pageN: string | number, opts: ConvertOptions = {}): string {
  return convertLadasPages([{ n: pageN, zones }], opts)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;')
}

// Elements whose content is mixed text (kept on one line); the others hold elements only
// and are indented one child per line.
const ELEMENT_ONLY = new Set(['list', 'lg', 'address', 'figure', 'div', 'note', 'ab', 'notatedMusic'])

function serialize(n: TeiNode, depth: number): string {
  const pad = '  '.repeat(depth)
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')
  if (!n.children.length) return `${pad}<${n.el}${attrs}/>`
  const onlyElements = n.children.every((c) => typeof c !== 'string') && ELEMENT_ONLY.has(n.el)
  if (onlyElements && !n.children.every((c) => typeof c !== 'string' && c.el === 'lb')) {
    const inner = (n.children as TeiNode[]).map((c) => serialize(c, depth + 1)).join('\n')
    return `${pad}<${n.el}${attrs}>\n${inner}\n${pad}</${n.el}>`
  }
  const inner = n.children.map((c) => (typeof c === 'string' ? esc(c) : serialize(c, 0))).join('')
  return `${pad}<${n.el}${attrs}>${inner}</${n.el}>`
}
