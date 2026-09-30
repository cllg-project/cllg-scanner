export interface ZoneTypeOption {
  type: string          // LADaS label, e.g. "MainZone-Head" (never translated)
  shortcut?: string     // single key that picks it directly, shown in the list
  note?: string         // short description shown after the type (its group)
}

// Letters and digits only, lowercased: "MainZone-Head" and "mainzone head" compare equal.
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Every character of `q` appears in `s`, in order ("mzh" → "mainzonehead").
function isSubsequence(q: string, s: string): boolean {
  let i = 0
  for (const c of s) if (c === q[i]) i++
  return i === q.length
}

/**
 * Options matching a typed query, best first: the option whose shortcut is the query,
 * then an exact match, a type (or its Level-2 part, after the hyphen) starting with the
 * query, the query anywhere in the type, and last the query's letters in order
 * ("mzh" finds MainZone-Head). Separators and case are ignored. Options keep their
 * given order within each rank; an empty query returns them all.
 */
export function filterZoneTypes(options: ZoneTypeOption[], query: string): ZoneTypeOption[] {
  const q = norm(query)
  if (!q) return options
  const rank = (o: ZoneTypeOption): number => {
    const t = norm(o.type)
    const level2 = norm(o.type.split(/[-:]/).slice(1).join(''))
    if (o.shortcut && norm(o.shortcut) === q) return 0
    if (t === q) return 1
    if (t.startsWith(q) || (level2 && level2.startsWith(q))) return 2
    if (t.includes(q)) return 3
    if (isSubsequence(q, t)) return 4
    return -1
  }
  return options
    .map((o, i) => ({ o, i, r: rank(o) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.o)
}
