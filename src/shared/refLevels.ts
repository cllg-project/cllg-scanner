import type { HierarchyLevel } from './types'

// Assigning a hierarchy level to the `<ref>` markers of a page's markdown.
//   - one declared level  → every ref is level 1, whatever its shape;
//   - several levels      → the declaration decides: a token must match a level's format;
//     when several levels match, ties are broken by the declared structure (sequence
//     continuity with the last ref seen at that level, then the shallowest level, i.e. the
//     parent before its child).

export interface FlatLevel { depth: number; name: string; pattern: string; color?: string; isMilestone?: boolean; missingFirst?: boolean }

export function flattenHierarchy(levels: HierarchyLevel[]): FlatLevel[] {
  const out: FlatLevel[] = []
  function walk(node: HierarchyLevel, depth: number): void {
    out.push({ depth, name: node.name, pattern: node.pattern, color: node.color, isMilestone: node.isMilestone, missingFirst: node.missingFirst })
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  for (const l of levels) walk(l, 1)
  return out
}

const FORMAT_RE: Record<string, RegExp> = {
  Roman:     /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i,
  Arabic:    /^\d+$/,
  Greek:     /^[Ͱ-Ͽἀ-῿]+$/,
  Alpha:     /^[a-z]{1,2}$/,
  Stephanus: /^\d+[a-e]$/,
}

function formatMatches(token: string, pattern: string): boolean {
  if (!token) return false
  if (pattern === 'Roman' && !/^[IVXLCDM]+$/i.test(token)) return false   // the regex also accepts ''
  const re = FORMAT_RE[pattern] ?? (() => { try { return new RegExp(`^${pattern}$`) } catch { return null } })()
  return !!re?.test(token)
}

const ROMAN_VAL: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

/** Numeric value of a token for sequence checks, or null when it has none. */
function ordinal(token: string, pattern: string): number | null {
  if (pattern === 'Roman') {
    let total = 0
    const t = token.toUpperCase()
    for (let i = 0; i < t.length; i++) {
      const v = ROMAN_VAL[t[i]], n = ROMAN_VAL[t[i + 1]] ?? 0
      total += v < n ? -v : v
    }
    return total
  }
  if (pattern === 'Alpha') return token.length === 1 ? token.toLowerCase().charCodeAt(0) - 96 : null
  const m = token.match(/^\d+/)
  return m ? parseInt(m[0], 10) : null
}

/** Last token seen per level depth, to judge sequence continuity. */
export type RefContext = Map<number, string>

/** The level a ref token belongs to, or null when the declaration can't place it. */
export function classifyRefLevel(token: string, levels: FlatLevel[], ctx?: RefContext): FlatLevel | null {
  const tok = token.trim()
  if (!tok || levels.length === 0) return null
  if (levels.length === 1) return levels[0]
  const cands = levels.filter((l) => formatMatches(tok, l.pattern))
  if (cands.length === 0) return null
  let best = cands[0]
  if (cands.length > 1) {
    // Prefer the level where this token directly follows the previous one.
    const follows = cands.filter((l) => {
      const prev = ctx?.get(l.depth)
      if (prev === undefined) return false
      const a = ordinal(prev, l.pattern), b = ordinal(tok, l.pattern)
      return a !== null && b !== null && b === a + 1
    })
    if (follows.length) best = follows[0]
    else {
      // A level whose parent hasn't started yet is unlikely, unless it may start without one.
      const started = (l: FlatLevel): boolean => l.depth === 1 || l.missingFirst === true || ctx?.has(l.depth - 1) === true
      best = cands.find(started) ?? cands[0]
    }
  }
  ctx?.set(best.depth, tok)
  return best
}

export const UNCLASSIFIED_REF = /<ref(?:\s+level="(?:0|)")?>(.*?)<\/ref>/gs

/** Writes `level="N"` on every unclassified `<ref>` of a markdown text the declaration can place. */
export function annotateRefLevels(text: string, levels: FlatLevel[], ctx: RefContext = new Map()): string {
  return text.replace(UNCLASSIFIED_REF, (match, inner: string) => {
    const level = classifyRefLevel(inner, levels, ctx)
    return level ? `<ref level="${level.depth}">${inner}</ref>` : match
  })
}
