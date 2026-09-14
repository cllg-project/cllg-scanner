import { describe, it, expect } from 'vitest'
import { classifyLadasType, ladasTypeForRole, ladasLabelForRole, isLadasCompatible, groupIntoZones, effectiveZones } from '../src/main/ladas'

describe('classifyLadasType', () => {
  it('classifies MainZone:P as a paragraph', () => {
    expect(classifyLadasType('MainZone:P')).toBe('p')
  })

  it('classifies MainZone:PQuoted as a quote, not a paragraph', () => {
    expect(classifyLadasType('MainZone:PQuoted')).toBe('quote')
  })

  it('classifies any MainZone:Head* as a heading', () => {
    expect(classifyLadasType('MainZone:Head')).toBe('head')
    expect(classifyLadasType('MainZone:HeadMain')).toBe('head')
  })

  it('classifies MainZone:Continued as a continuation', () => {
    expect(classifyLadasType('MainZone:Continued')).toBe('continuation')
  })

  it('returns unknown for undefined, empty, or non-LADaS types', () => {
    expect(classifyLadasType(undefined)).toBe('unknown')
    expect(classifyLadasType('')).toBe('unknown')
    expect(classifyLadasType('DefaultLine')).toBe('unknown')
    expect(classifyLadasType('margin')).toBe('unknown')
  })

  // Real eScriptorium exports use a hyphen separator (and sometimes a trailing
  // "#lang"/"#tag" suffix), not the colon form.
  it('accepts the hyphen-separated convention real eScriptorium exports use', () => {
    expect(classifyLadasType('MainZone-P')).toBe('p')
    expect(classifyLadasType('MainZone-PQuoted')).toBe('quote')
    expect(classifyLadasType('MainZone-Head')).toBe('head')
    expect(classifyLadasType('MainZone-Continued')).toBe('continuation')
  })

  it('classifies past a trailing #suffix (e.g. "#latin")', () => {
    expect(classifyLadasType('MainZone-Continued#latin')).toBe('continuation')
    expect(classifyLadasType('MainZone-PLabelled')).toBe('p')
  })

  it('does not misclassify a non-MainZone prefix (e.g. MarginTextZone)', () => {
    expect(classifyLadasType('MarginTextZone-PStructured')).toBe('unknown')
  })
})

describe('ladasTypeForRole', () => {
  it('round-trips each role to its LADaS type', () => {
    expect(ladasTypeForRole('p')).toBe('MainZone:P')
    expect(ladasTypeForRole('quote')).toBe('MainZone:PQuoted')
    expect(ladasTypeForRole('head')).toBe('MainZone:Head')
    expect(ladasTypeForRole('continuation')).toBe('MainZone:Continued')
  })

  it('falls back to MainZone:P for unknown', () => {
    expect(ladasTypeForRole('unknown')).toBe('MainZone:P')
  })
})

describe('ladasLabelForRole', () => {
  it('produces the hyphen-separated LABEL form real eScriptorium ALTO exports use', () => {
    expect(ladasLabelForRole('p')).toBe('MainZone-P')
    expect(ladasLabelForRole('quote')).toBe('MainZone-PQuoted')
    expect(ladasLabelForRole('head')).toBe('MainZone-Head')
    expect(ladasLabelForRole('continuation')).toBe('MainZone-Continued')
    expect(ladasLabelForRole('unknown')).toBe('MainZone-P')
  })

  it('round-trips through classifyLadasType back to the same role', () => {
    for (const role of ['p', 'quote', 'head', 'continuation'] as const) {
      expect(classifyLadasType(ladasLabelForRole(role))).toBe(role)
    }
  })
})

describe('isLadasCompatible', () => {
  it('is false when no line has a LADaS-recognized regionType', () => {
    expect(isLadasCompatible([{ regionType: 'main' }, { regionType: undefined }])).toBe(false)
  })

  it('is true when at least one line has a LADaS-recognized regionType', () => {
    expect(isLadasCompatible([{ regionType: 'main' }, { regionType: 'MainZone:P' }])).toBe(true)
  })
})

describe('groupIntoZones', () => {
  it('merges consecutive ALTO blocks that share a role into one zone, regardless of blockId', () => {
    // Real ALTO sources routinely segment one logical paragraph into several
    // consecutive same-typed TextBlocks (e.g. one block per transcribed line) —
    // treating each as its own zone would fragment a real paragraph into many.
    const lines = [
      { blockId: 'tb1', regionType: 'MainZone:P', text: 'a', id: 'l1' },
      { blockId: 'tb1', regionType: 'MainZone:P', text: 'b', id: 'l2' },
      { blockId: 'tb2', regionType: 'MainZone:P', text: 'c', id: 'l3' },
    ]
    const zones = groupIntoZones(lines)
    expect(zones).toHaveLength(1)
    expect(zones[0].blockId).toBe('tb1')
    expect(zones[0].lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
  })

  it('still starts a new zone when the role changes, even with no blockId change', () => {
    const lines = [
      { blockId: 'tb1', regionType: 'MainZone:P', text: 'a', id: 'l1' },
      { blockId: 'tb1', regionType: 'MainZone:Head', text: 'b', id: 'l2' },
    ]
    const zones = groupIntoZones(lines)
    expect(zones).toHaveLength(2)
    expect(zones[0].role).toBe('p')
    expect(zones[1].role).toBe('head')
  })

  it('groups Kraken lines (no blockId) into runs of consecutive same-role lines', () => {
    const lines = [
      { regionType: 'MainZone:P', text: 'a', id: 'k0' },
      { regionType: 'MainZone:P', text: 'b', id: 'k1' },
      { regionType: 'MainZone:Head', text: 'c', id: 'k2' },
      { regionType: 'MainZone:P', text: 'd', id: 'k3' },
    ]
    const zones = groupIntoZones(lines)
    expect(zones).toHaveLength(3)
    expect(zones[0].role).toBe('p')
    expect(zones[0].lines.map((l) => l.text)).toEqual(['a', 'b'])
    expect(zones[1].role).toBe('head')
    expect(zones[1].lines.map((l) => l.text)).toEqual(['c'])
    expect(zones[2].role).toBe('p')
    expect(zones[2].lines.map((l) => l.text)).toEqual(['d'])
  })

  it('puts every line in its own zone when there is no zone typing at all', () => {
    const lines = [
      { text: 'a', id: 'k0' },
      { text: 'b', id: 'k1' },
    ]
    const zones = groupIntoZones(lines)
    expect(zones).toHaveLength(2)
    expect(zones.every((z) => z.role === 'unknown')).toBe(true)
  })
})

describe('effectiveZones', () => {
  it('applies a manual override role, merging previously-separate lines into one zone', () => {
    // Three originally distinct blocks with no LADaS typing at all (unknown role) —
    // a manual "Paragraph" regroup covering all three should merge them into one zone.
    const lines = [
      { blockId: 'tb1', text: 'a', id: 'l1' },
      { blockId: 'tb2', text: 'b', id: 'l2' },
      { blockId: 'tb3', text: 'c', id: 'l3' },
    ]
    const zones = effectiveZones(lines, [{ role: 'p', lineIds: ['l1', 'l2', 'l3'] }])
    expect(zones).toHaveLength(1)
    expect(zones[0].role).toBe('p')
    expect(zones[0].lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
  })

  it('a manual override on some lines still merges them with adjacent same-role lines', () => {
    const lines = [
      { blockId: 'tb1', regionType: 'MainZone:P', text: 'a', id: 'l1' },
      { blockId: 'tb2', text: 'b', id: 'l2' }, // unknown, but manually tagged 'p' below
    ]
    const zones = effectiveZones(lines, [{ role: 'p', lineIds: ['l2'] }])
    expect(zones).toHaveLength(1)
    expect(zones[0].lines.map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('with no manual zones, behaves exactly like groupIntoZones', () => {
    const lines = [
      { blockId: 'tb1', regionType: 'MainZone:P', text: 'a', id: 'l1' },
      { blockId: 'tb2', regionType: 'MainZone:Head', text: 'b', id: 'l2' },
    ]
    expect(effectiveZones(lines)).toEqual(groupIntoZones(lines))
  })
})
