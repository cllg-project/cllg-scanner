import { effectiveZones, ladasLabelForRole, type Zone } from './ladas'
import type { LineGeometry, Page } from '@shared/types'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ALTO's own spec defines POINTS as comma-paired ("x1,y1 x2,y2 ..."), matching
// altoImport.ts's parsePoints() reader for that same convention.
function formatPoints(points: [number, number][]): string {
  return points.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ')
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

// Approximates a baseline for Kraken-derived geometry (no verbatim ALTO baseline
// available): a straight 2-point segment between the midpoints of the polygon's two
// short edges — computable from the 4 OBB corners alone. Corner order matches
// krakenOcr.ts's expandedLinePolygon(): [topLeft, topRight, bottomRight, bottomLeft], so
// the short (vertical) edges are 0-3 (left) and 1-2 (right).
export function approximateBaseline(polygon: [number, number][]): [number, number][] {
  if (polygon.length < 4) return polygon
  return [midpoint(polygon[0], polygon[3]), midpoint(polygon[1], polygon[2])]
}

// Splits corrected markdown on <lb n="id"/> boundaries into a map from line id to its
// corrected plain-text span (from that anchor to the next anchor, or end of string) —
// good enough for round-tripping into ALTO's String/@CONTENT. Any block-wrapper tag
// (<p>/<head>/<quote>/<continued>) trailing right after the last anchor's text on that
// line is stripped; this is a plain-text extraction, not a full markdown-tag stripper.
export function textByAnchor(markdown: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /<lb n="([^"]*)"\/>/g
  const matches: { id: string; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ id: m[1], start: m.index, end: m.index + m[0].length })
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end
    const end = i + 1 < matches.length ? matches[i + 1].start : markdown.length
    const text = markdown.slice(start, end).replace(/<\/?(p|head|quote|continued)>/g, '').trim()
    out.set(matches[i].id, text)
  }
  return out
}

/**
 * Builds a round-trip ALTO XML export for one page from its persisted LineGeometry.
 *
 * When `correctedMarkdown` is supplied (the page's current, possibly hand-corrected
 * markdown), each line's `String/@CONTENT` reflects the corrected text at that line's
 * `<lb n="id">` anchor, falling back to the archived `LineGeometry.text` for any line
 * whose anchor is missing (e.g. deleted during editing). With no `correctedMarkdown`,
 * every line uses its archived original text — a strict "exactly what the model
 * originally produced" export.
 *
 * Lines are grouped into `<TextBlock>`s via ladas.ts's effectiveZones() — the same
 * grouping used to build the markdown in the first place, with any `ManualZoneGroup`
 * override applied *before* grouping so a manually regrouped run of lines merges into
 * one `<TextBlock>` instead of just getting relabeled while staying fragmented. Rather
 * than writing that type directly as a `TextBlock/@TYPE` attribute, this reuses the same
 * `TAGREFS` + `<Tags><OtherTag ID LABEL/></Tags>` indirection real-world eScriptorium
 * ALTO exports use (see altoImport.ts's resolveRegionType(), which reads it back) — one
 * `<OtherTag>` per distinct label actually used on the page, referenced by each
 * `TextBlock`'s `TAGREFS`.
 */
export function buildAltoXml(page: Page, correctedMarkdown?: string): string {
  const geometry = page.lineGeometry ?? []
  const correctedById = correctedMarkdown ? textByAnchor(correctedMarkdown) : null

  const byId = new Map<string, LineGeometry>(geometry.map((l) => [l.id, l]))
  const zones: Zone[] = effectiveZones(geometry.map((l) => ({ ...l, text: l.text ?? '' })), page.manualZones ?? [])

  const tagIdByLabel = new Map<string, string>()
  for (const zone of zones) {
    const label = ladasLabelForRole(zone.role)
    if (!tagIdByLabel.has(label)) tagIdByLabel.set(label, `BT${tagIdByLabel.size + 1}`)
  }
  const tagsXml = [...tagIdByLabel.entries()]
    .map(([label, id]) => `    <OtherTag ID="${esc(id)}" LABEL="${esc(label)}"/>`)
    .join('\n')

  const blocks = zones.map((zone) => {
    const tagId = tagIdByLabel.get(ladasLabelForRole(zone.role))!

    const textLines = zone.lines.map((zl) => {
      const line = byId.get(zl.id)
      if (!line) return ''
      const text = correctedById?.get(zl.id) ?? line.text ?? ''
      const baseline = line.baseline ?? approximateBaseline(line.polygon)
      return [
        `        <TextLine ID="${esc(zl.id)}">`,
        `          <Shape><Polygon POINTS="${formatPoints(line.polygon)}"/></Shape>`,
        `          <Baseline POINTS="${formatPoints(baseline)}"/>`,
        `          <String CONTENT="${esc(text)}"/>`,
        `        </TextLine>`,
      ].join('\n')
    }).join('\n')

    return [
      `      <TextBlock ID="${esc(zone.blockId)}" TAGREFS="${esc(tagId)}">`,
      textLines,
      `      </TextBlock>`,
    ].join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<alto xmlns="http://www.loc.gov/standards/alto/ns-v4#">
  <Tags>
${tagsXml}
  </Tags>
  <Layout>
    <Page ID="page_${page.n}">
      <PrintSpace>
${blocks}
      </PrintSpace>
    </Page>
  </Layout>
</alto>`
}
