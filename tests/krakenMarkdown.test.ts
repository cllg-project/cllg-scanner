import { describe, it, expect } from 'vitest'
import { krakenLinesToPageMarkdown } from '../src/main/krakenMarkdown'

describe('krakenLinesToPageMarkdown', () => {
  it('anchors each line with <lb n="id"/> and joins with newlines under a <pb/> marker when there is no zone typing', () => {
    const md = krakenLinesToPageMarkdown(3, [
      { text: 'Hello', id: 'k0' },
      { text: 'world', id: 'k1' },
    ])
    expect(md).toBe('<pb n="3"/>\n<lb n="k0"/>Hello\n<lb n="k1"/>world\n\n')
  })

  it('produces just the <pb/> marker for an empty line list', () => {
    const md = krakenLinesToPageMarkdown(1, [])
    expect(md).toBe('<pb n="1"/>\n\n\n')
  })

  it('joins a LADaS paragraph zone onto one markdown line via <lb/> anchors', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'First line', id: 'k0', regionType: 'MainZone:P' },
      { text: 'second line', id: 'k1', regionType: 'MainZone:P' },
    ])
    expect(md).toBe('<pb n="1"/>\n<lb n="k0"/>First line<lb n="k1"/>second line\n\n')
  })

  it('wraps a LADaS quote zone in <quote>', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'quoted text', id: 'k0', regionType: 'MainZone:PQuoted' },
    ])
    expect(md).toBe('<pb n="1"/>\n<quote><lb n="k0"/>quoted text</quote>\n\n')
  })

  it('prefixes a LADaS head zone with #', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'Chapter One', id: 'k0', regionType: 'MainZone:Head' },
    ])
    expect(md).toBe('<pb n="1"/>\n# <lb n="k0"/>Chapter One\n\n')
  })

  it('emits a LADaS continuation zone as a plain anchored paragraph, no literal marker', () => {
    // Deliberately NOT `__CONTINUATION__...` — that's an internal token md2tei.ts
    // only ever inserts/consumes in memory during TEI generation; writing it into
    // this persisted, user-edited file would leak it into Review as visible text.
    // md2tei.ts's own markContinuations() heuristic (first paragraph-like content
    // right after a <pb> that isn't a heading/ref) picks this up for free since it
    // doesn't start with #/<tab/>/<ref>.
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'continued text', id: 'k0', regionType: 'MainZone:Continued' },
    ])
    expect(md).toBe('<pb n="1"/>\n<lb n="k0"/>continued text\n\n')
    expect(md).not.toContain('__CONTINUATION__')
  })

  it('merges a hyphenated word-wrap across two lines without an <lb/> at the join', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'happi-', id: 'k0', regionType: 'MainZone:P' },
      { text: 'ness', id: 'k1', regionType: 'MainZone:P' },
    ])
    expect(md).toBe('<pb n="1"/>\n<lb n="k0"/>happiness\n\n')
  })

  it('keeps LADaS-typed and untyped zones separate, each grouped independently', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'a paragraph line', id: 'k0', regionType: 'MainZone:P' },
      { text: 'an unrelated line', id: 'k1' },
    ])
    expect(md).toBe('<pb n="1"/>\n<lb n="k0"/>a paragraph line\n<lb n="k1"/>an unrelated line\n\n')
  })
})
