import { groupIntoZones, type Zone } from './ladas'
import { joinLinesWithAnchors } from './textJoin'

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
 * Every physical line is anchored with `<lb n="id"/>` (see textJoin.ts) so a word
 * stays linked to its source line even after the text is corrected later — this is
 * what Review's click-to-highlight and any future line-provenance use relies on.
 *
 * When lines carry LADaS-vocabulary regionType (ALTO import, or a Kraken
 * segmentation model whose own classes happen to be LADaS-named), they're grouped
 * into zones and wrapped by role: a paragraph zone's lines are joined onto one
 * markdown line (so md2tei.ts's existing <p> parser sees one real multi-line
 * paragraph, via <lb/>, instead of one <p> per physical line); quote/head zones get
 * <quote>/# wrapping. A continuation zone is deliberately given NO special marker —
 * md2tei.ts's markContinuations() already detects "first paragraph-like content
 * right after a <pb> that isn't a heading/ref" purely from context, which is exactly
 * what a Continued zone's plain joined output looks like, so it's picked up for free.
 * (An earlier version wrote a literal `__CONTINUATION__` marker here, but that's an
 * internal token md2tei.ts is only ever meant to insert/consume in memory during TEI
 * generation — writing it into this persisted, user-edited file leaked it into
 * Review as visible text, which is why that approach was dropped.) Lines with no
 * recognizable zone typing (the common case — plain Kraken segmentation has no zone
 * concept at all) fall back to exactly today's flat one-line-per-markdown-line
 * output, just anchored.
 */
export function krakenLinesToPageMarkdown(pageN: number, lines: KrakenLineOut[]): string {
  const zones = groupIntoZones(lines)
  const body = zones.map(zoneToMarkdown).join('\n')
  return `<pb n="${pageN}"/>\n${body}\n\n`
}

function zoneToMarkdown(zone: Zone): string {
  const joined = joinLinesWithAnchors(zone.lines)
  switch (zone.role) {
    case 'quote':
      return `<quote>${joined}</quote>`
    case 'head':
      return `# ${joined}`
    case 'p':
    case 'unknown':
    case 'continuation':
    default:
      return joined
  }
}
