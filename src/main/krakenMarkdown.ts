import { groupIntoZones, type Zone } from './ladas'

export interface KrakenLineOut {
  text: string
  id: string
  blockId?: string
  regionType?: string
}

/**
 * Build a page's markdown cache-file content from Kraken's recognized lines,
 * matching the exact `<pb n="N"/>\n...\n\n` convention `ocr.ts` writes for
 * LM Studio output, so both engines produce interchangeable cache files.
 *
 * Every physical line is anchored with `<lb n="id"/>` so a word stays linked to its
 * source line even after the text is corrected later — this is what Review's
 * click-to-highlight and the manual region-grouping tool rely on.
 *
 * When lines carry LADaS-vocabulary regionType (ALTO import, or a Kraken segmentation
 * model whose own classes happen to be LADaS-named), they're grouped into zones and
 * wrapped in the real TEI containers `<p>`/`<quote>`/`<head>` md2tei.ts's buildBody()
 * understands natively — spanning as many physical lines as the zone actually has, each
 * still individually anchored, so a real multi-line paragraph stays one `<p>` instead of
 * fragmenting into one `<p>` per OCR line. A continuation zone becomes `<continued>` —
 * md2tei.ts's explicit (not heuristic) cue to splice this block into the previous page's
 * still-open paragraph. Lines with no recognizable zone typing (the common case — plain
 * Kraken segmentation has no zone concept at all) are left bare, one per markdown line —
 * exactly today's flat default, and also what makes Review's manual region-grouping tool
 * able to just wrap a plain multi-line span directly.
 */
export function krakenLinesToPageMarkdown(pageN: number, lines: KrakenLineOut[]): string {
  const zones = groupIntoZones(lines)
  const body = zones.map(zoneToMarkdown).join('\n')
  return `<pb n="${pageN}"/>\n${body}\n\n`
}

function anchoredLines(zone: Zone): string {
  return zone.lines.map((l) => `<lb n="${l.id}"/>${l.text}`).join('\n')
}

function zoneToMarkdown(zone: Zone): string {
  const inner = anchoredLines(zone)
  switch (zone.role) {
    case 'quote':
      return `<quote>\n${inner}\n</quote>`
    case 'head':
      return `<head>\n${inner}\n</head>`
    case 'continuation':
      return `<continued>\n${inner}\n</continued>`
    case 'p':
      return `<p>\n${inner}\n</p>`
    case 'unknown':
    default:
      return inner
  }
}
