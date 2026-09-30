// LADaS is an eScriptorium zone-typing convention (TextBlock region names like
// "MainZone-P"/"MainZone-PQuoted"/"MainZone-Head"/"MainZone-Continued" — real-world
// eScriptorium exports use a hyphen separator and sometimes a trailing "#lang" or
// "#tag" suffix, e.g. "MainZone-Continued#latin"; a colon separator is accepted too
// since it's the form used in some other LADaS-adjacent documentation). ALTO import
// can carry this typing directly (resolved from TAGREFS via the document's <Tags> —
// see altoImport.ts); a Kraken segmentation model can *also* emit it directly as its
// own per-line `type` when the model's own class_mapping happens to use these names
// (confirmed: Kraken's segmenter output is not hardcoded to
// 'DefaultLine'/'DefaultLine-Margin' — it's whatever the loaded model defines). So
// the same classification function applies to both sources.
// The classification itself lives in src/shared/zones.ts (the renderer needs it too).
import { classifyLadasType, type ZoneRole } from '@shared/zones'
export { classifyLadasType, ladasTypeForRole, ladasLabelForRole, type ZoneRole } from '@shared/zones'

export function isLadasCompatible(lines: { regionType?: string }[]): boolean {
  return lines.some((l) => classifyLadasType(l.regionType) !== 'unknown')
}

export interface Zone {
  blockId: string
  role: ZoneRole
  lines: { text: string; id: string }[]
}

// Groups lines into zones for markdown-building: consecutive lines that classify to the
// same LADaS role are one zone, regardless of `blockId` (ALTO's TextBlock/@ID) — real
// ALTO sources routinely segment one logical paragraph into several consecutive
// same-typed TextBlocks (e.g. one block per transcribed line), and document order
// generally follows reading order, so treating a run of same-typed blocks as one zone
// is what produces a correct real paragraph instead of fragmenting it one `<p>` per
// original block. The role changing (including dropping to 'unknown') always starts a
// new zone. Unknown-role lines additionally never merge with each other — only lines
// with a real classified role (p/quote/head/continuation) group into runs; without this,
// two unrelated untyped lines (the common case — plain Kraken segmentation has no zone
// info at all) would collapse into one zone instead of staying the one-line-per-<p>
// flat output that's the whole point of the 'unknown' fallback. A zone's own `blockId`
// (used e.g. for ALTO round-trip export) is simply its first line's blockId.
//
// A line's `roleOverride` (from a manual ManualZoneGroup tagging, if any covers it) wins
// over its own `regionType` classification — and, crucially, participates in the same
// run-merging: manually regrouping several previously-separate lines under one role
// makes them merge into one zone here too, not just get a relabeled-but-still-fragmented
// zone per original line/block.
export function groupIntoZones(
  lines: { blockId?: string; regionType?: string; text: string; id: string; roleOverride?: ZoneRole }[]
): Zone[] {
  const zones: Zone[] = []
  let current: Zone | null = null
  let lastKey: string | null = null
  let idx = 0
  for (const l of lines) {
    const role = l.roleOverride ?? classifyLadasType(l.regionType)
    const key = role === 'unknown' ? `unknown-${idx}` : `run:${role}`
    if (key !== lastKey || !current) {
      current = { blockId: l.blockId ?? `k-${zones.length}`, role, lines: [] }
      zones.push(current)
      lastKey = key
    }
    current.lines.push({ text: l.text, id: l.id })
    idx++
  }
  return zones
}

// Convenience wrapper around groupIntoZones() that applies the page's zone typing
// (detected D-FINE zones, as edited in Review, and hand-drawn ones) before grouping —
// shared by every consumer that needs a page's *effective* zones (raw LADaS
// classification, corrected by any zone editing), e.g. the ALTO round-trip export and
// the "Plain Text + LADaS" export. Without funnelling the override through
// groupIntoZones itself, a manually regrouped run of lines would only get relabeled
// while staying fragmented into one zone per original block — the whole point of a
// manual regroup is to merge them into one. A zone is given either as a legacy
// `role` or as a LADaS `type`; a type with no block role (margin, running title…)
// overrides nothing. Hand-drawn zones win over detected ones.
export function effectiveZones(
  lines: { blockId?: string; regionType?: string; text: string; id: string }[],
  zones: ({ role: ZoneRole; lineIds: string[] } | { type: string; lineIds: string[]; source?: string })[] = []
): Zone[] {
  const overrideById = new Map<string, ZoneRole>()
  const ordered = [...zones].sort((a, b) => Number('source' in a && a.source === 'manual') - Number('source' in b && b.source === 'manual'))
  for (const group of ordered) {
    const role = 'role' in group ? group.role : classifyLadasType(group.type)
    if (role === 'unknown') continue
    for (const id of group.lineIds) overrideById.set(id, role)
  }
  return groupIntoZones(lines.map((l) => ({ ...l, roleOverride: overrideById.get(l.id) })))
}
