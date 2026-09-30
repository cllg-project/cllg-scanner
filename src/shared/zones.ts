import type { ManualZoneGroup, PageZone, ZoneAction } from './types'
import { findAnchors, findBlocks, hasBlockTagLine, spanForLineIds, unwrapLegacyZone, unwrapOrphanZones, unwrapZone } from './lbAnchors'

// ── LADaS zone typing ──
//
// LADaS is an eScriptorium zone-typing convention (see src/main/ladas.ts's module
// comment). The classification lives here, in shared code, because both the main
// process (markdown building, exports) and Review (zone editing) need it.

export type ZoneRole = 'p' | 'quote' | 'head' | 'continuation' | 'unknown'

export function classifyLadasType(regionType?: string): ZoneRole {
  if (!regionType) return 'unknown'
  if (/^MainZone[-:]PQuoted/.test(regionType)) return 'quote'
  if (/^MainZone[-:]Continued/.test(regionType)) return 'continuation'
  if (/^MainZone[-:]Head/.test(regionType)) return 'head'
  if (/^MainZone[-:]P/.test(regionType)) return 'p' // PQuoted already matched above
  return 'unknown'
}

// Inverse of classifyLadasType — used when exporting/round-tripping zone typing
// (e.g. back into ALTO) from a role that was determined some other way (manual
// tagging, a Kraken run with no ALTO involved at all).
export function ladasTypeForRole(role: ZoneRole): string {
  return {
    p: 'MainZone:P',
    quote: 'MainZone:PQuoted',
    head: 'MainZone:Head',
    continuation: 'MainZone:Continued',
    unknown: 'MainZone:P',
  }[role]
}

// Hyphen-separated form matching eScriptorium's real-world LADaS LABEL convention — used
// wherever a label/type is written into an actual ALTO export (OtherTag/@LABEL, or a
// pseudo-tag naming convention derived from it), and for PageZone.type, as opposed to
// ladasTypeForRole()'s colon form used for CLLG's own internal regionType.
export function ladasLabelForRole(role: ZoneRole): string {
  return ladasTypeForRole(role).replace(':', '-')
}

export type RegionKind = 'main' | 'margin' | 'dropcap' | 'skip' | 'other'

const SKIPPED_REGION_RE =
  /^(RunningTitleZone|NumberingZone|QuireMarksZone|DigitizationArtefactZone|StampZone|CustomZone-Noise|GraphicZone(-Decoration)?$)/

export function regionKind(type?: string): RegionKind {
  if (!type) return 'other'
  if (/^MainZone/.test(type)) return 'main'
  if (/^MarginTextZone/.test(type)) return 'margin'
  if (/^DropCapitalZone/.test(type)) return 'dropcap'
  if (SKIPPED_REGION_RE.test(type)) return 'skip'
  return 'other'
}

/**
 * What happens to a region type nobody chose for: the forme work and noise the Kraken
 * merge always left out (running titles, page and quire numbers, stamps, artefacts,
 * decorations, noise) are dropped; everything else is annotated.
 */
export function defaultZoneAction(type: string): ZoneAction {
  return regionKind(type) === 'skip' ? 'drop' : 'annotate'
}

/** The action for a region type under a project's zone policy. */
export function zoneAction(type: string | undefined, policy?: Record<string, ZoneAction>): ZoneAction {
  if (!type) return 'annotate'
  return policy?.[type] ?? defaultZoneAction(type)
}

/** Zone types offered in Review's type picker (a zone may carry any other type too). */
export const LADAS_ZONE_TYPES = [
  'MainZone-P',
  'MainZone-PQuoted',
  'MainZone-Head',
  'MainZone-Continued',
  'MainZone-Lg',
  'MainZone-List',
  'MainZone-Entry',
  'MarginTextZone',
  'MarginTextZone-Notes',
  'RunningTitleZone',
  'NumberingZone',
  'QuireMarksZone',
  'DropCapitalZone',
  'GraphicZone',
  'TableZone',
  'StampZone',
  'DigitizationArtefactZone',
  'CustomZone-Noise',
] as const

export type BlockTag = 'p' | 'quote' | 'head' | 'continued'

/**
 * The block tag a zone's lines are wrapped in, or null when the zone is linked to its
 * lines' `<lb n>` anchors only (margins, running titles, drop capitals…). Main-zone
 * subtypes with no TEI container of their own (MainZone-Lg, -List, …) are still running
 * text, so they are paragraphs — as in regionMerge.ts's mergeRegionLines().
 */
export function blockTagForType(type: string): BlockTag | null {
  const role = classifyLadasType(type)
  if (role === 'continuation') return 'continued'
  if (role !== 'unknown') return role
  return regionKind(type) === 'main' ? 'p' : null
}

// ── Zone ↔ markdown tags ──

/**
 * (Re)writes one zone's block tags in `markdown`: removes whatever tags the zone
 * previously had (by its `zone="id"` attribute, or — for zones created before tags
 * carried an id — the bare wrapper around `previous`'s lines), then wraps the span
 * covering the zone's current lines with `<tag zone="id">…</tag>`.
 *
 * Nothing is wrapped (`wrapped: false`) when the zone's type has no block tag, when none
 * of its lines has an anchor, or when the span would take in a foreign block tag line
 * or a line of another block zone in `others` (lines read in an interleaved order) —
 * wrapping would then nest blocks or swallow foreign lines. `replacedZoneId` is the id
 * of another zone whose wrapper exactly covered the span and was replaced.
 */
export function writeZoneTags(
  markdown: string,
  zone: PageZone,
  previous?: PageZone,
  others: PageZone[] = []
): { markdown: string; wrapped: boolean; replacedZoneId?: string } {
  let md = unwrapZone(markdown, zone.id)
  if (md === markdown && previous) {
    const prevTag = blockTagForType(previous.type)
    if (prevTag) md = unwrapLegacyZone(md, previous.lineIds, prevTag)
  }
  const tag = blockTagForType(zone.type)
  if (!tag || !zone.lineIds.length) return { markdown: md, wrapped: false }
  const span = spanForLineIds(md, zone.lineIds)
  if (!span) return { markdown: md, wrapped: false }
  // Never take over the wrapper of another zone that is still on the page.
  if (span.wrapperZoneId && span.wrapperZoneId !== zone.id && others.some((o) => o.id === span.wrapperZoneId)) {
    return { markdown: md, wrapped: false }
  }

  const inner = md.slice(span.innerStart, span.innerEnd)
  if (hasBlockTagLine(inner)) return { markdown: md, wrapped: false }
  const own = new Set(zone.lineIds)
  const foreign = new Set(
    others.filter((o) => o.id !== zone.id && blockTagForType(o.type)).flatMap((o) => o.lineIds.filter((id) => !own.has(id)))
  )
  const innerAnchors = findAnchors(md).filter((a) => a.start >= span.innerStart && a.start < span.innerEnd)
  if (innerAnchors.some((a) => foreign.has(a.id))) return { markdown: md, wrapped: false }
  // Inside a wrapper that isn't exactly this span (e.g. one paragraph a previous run
  // made of several regions): wrapping would nest blocks.
  if (!span.wrapped && findBlocks(md).some((b) => span.start > b.start && span.start < b.end)) {
    return { markdown: md, wrapped: false }
  }

  // When the lines are already wrapped by another block, that wrapper is *replaced*
  // (span covers it; only the lines themselves are re-wrapped), never nested.
  const wrappedText = `<${tag} zone="${zone.id}">\n${inner}\n</${tag}>`
  return {
    markdown: md.slice(0, span.start) + wrappedText + md.slice(span.end),
    wrapped: true,
    replacedZoneId: span.wrapperZoneId,
  }
}

/**
 * Rewrites every zone's tags in `markdown`: unwraps wrappers of zones no longer in
 * `zones`, then (re)wraps each zone in reading order (by its first anchor). Returns the
 * ids of block-typed zones that could not be wrapped (see writeZoneTags).
 */
export function writeAllZoneTags(markdown: string, zones: PageZone[]): { markdown: string; unwrapped: string[] } {
  let md = unwrapOrphanZones(markdown, new Set(zones.map((z) => z.id)))
  const order = new Map(findAnchors(md).map((a, i) => [a.id, i]))
  const first = (z: PageZone): number => Math.min(...z.lineIds.map((id) => order.get(id) ?? Infinity))
  const unwrapped: string[] = []
  for (const z of [...zones].sort((a, b) => first(a) - first(b))) {
    const r = writeZoneTags(md, z, undefined, zones)
    md = r.markdown
    if (!r.wrapped && blockTagForType(z.type) && z.lineIds.length) unwrapped.push(z.id)
  }
  return { markdown: md, unwrapped }
}

/**
 * Removes block wrappers that carry no `zone` id and hold only lines of the given zones:
 * the untagged paragraphs a Kraken run made before zones were linked, superseded once
 * those lines get zone-tagged wrappers of their own. Wrappers holding any other line
 * (e.g. typed by hand around LM output) are kept.
 */
export function unwrapUntaggedBlocksOf(markdown: string, zones: PageZone[]): string {
  const zoned = new Set(zones.flatMap((z) => z.lineIds))
  let md = markdown
  for (const b of findBlocks(markdown).reverse()) {
    if (b.zoneId) continue
    const anchors = findAnchors(md.slice(b.innerStart, b.innerEnd))
    if (!anchors.length || !anchors.every((a) => zoned.has(a.id))) continue
    md = md.slice(0, b.start) + md.slice(b.innerStart, b.innerEnd) + md.slice(b.end)
  }
  return md
}

/** The zone holding line `lineId`, preferring a block-typed one. */
export function zoneForLine(zones: PageZone[], lineId: string): PageZone | undefined {
  const holding = zones.filter((z) => z.lineIds.includes(lineId))
  return holding.find((z) => blockTagForType(z.type)) ?? holding[0]
}

/** A legacy hand-drawn ManualZoneGroup as a PageZone. */
export function manualGroupToZone(g: ManualZoneGroup): PageZone {
  return { id: g.id, type: ladasLabelForRole(g.role), rect: g.rect, lineIds: g.lineIds, source: 'manual' }
}

/** Moves a page's legacy `manualZones` into `zones` (idempotent). */
export function migratePageZones<P extends { zones?: PageZone[]; manualZones?: ManualZoneGroup[] }>(page: P): P {
  if (!page.manualZones) return page
  const { manualZones, ...rest } = page
  const existing = page.zones ?? []
  const ids = new Set(existing.map((z) => z.id))
  const migrated = manualZones.filter((g) => !ids.has(g.id)).map(manualGroupToZone)
  const zones = [...existing, ...migrated]
  return { ...(rest as P), ...(zones.length ? { zones } : {}) }
}
