import { ladasLabelForRole, type Zone } from './ladas'

/** Strips every pseudo-markdown tag (including `<lb n=...>` anchors), leaving plain text. */
export function stripPseudoTags(markdown: string): string {
  return markdown.replace(/<[^>]+>/g, '')
}

/**
 * Re-walks a page's zones (ladas.ts's groupIntoZones — already one zone per contiguous
 * run of same-role content, regardless of the original ALTO blockId boundaries) and
 * emits one self-closing marker at the *start* of each zone — reusing the real LADaS
 * LABEL string as-is (e.g. `<MainZone-P/>`, `<MainZone-PQuoted/>`, `<MainZone-Head/>`),
 * the same convention as eScriptorium's own `<Tags><OtherTag LABEL="...">` system —
 * followed by that zone's plain text, one physical line per line (no `<lb>` anchors, no
 * pseudo-markdown). Used for the "Plain Text + LADaS pseudo-tags" per-page export format.
 */
export function zonesToPseudoTaggedText(zones: Zone[]): string {
  return zones
    .map((zone) => `<${ladasLabelForRole(zone.role)}/>${zone.lines.map((l) => l.text).join('\n')}`)
    .join('\n')
}
