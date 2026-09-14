import { describe, it, expect } from 'vitest'
import { krakenLinesToPageMarkdown } from '../src/main/krakenMarkdown'

describe('krakenLinesToPageMarkdown', () => {
  it('anchors each line with <lb n="id"/> and leaves them bare when there is no zone typing', () => {
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

  it('wraps a LADaS paragraph zone in a real, genuinely multi-line <p> block', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'First line', id: 'k0', regionType: 'MainZone:P' },
      { text: 'second line', id: 'k1', regionType: 'MainZone:P' },
    ])
    expect(md).toBe('<pb n="1"/>\n<p>\n<lb n="k0"/>First line\n<lb n="k1"/>second line\n</p>\n\n')
  })

  it('wraps a LADaS quote zone in a real <quote> block', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'quoted text', id: 'k0', regionType: 'MainZone:PQuoted' },
    ])
    expect(md).toBe('<pb n="1"/>\n<quote>\n<lb n="k0"/>quoted text\n</quote>\n\n')
  })

  it('wraps a LADaS head zone in a real <head> block', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'Chapter One', id: 'k0', regionType: 'MainZone:Head' },
    ])
    expect(md).toBe('<pb n="1"/>\n<head>\n<lb n="k0"/>Chapter One\n</head>\n\n')
  })

  it('wraps a LADaS continuation zone in an explicit <continued> block', () => {
    // md2tei.ts treats <continued> as an explicit (not heuristic) cue to splice this
    // block into the preceding page's still-open <p>/<quote>.
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'continued text', id: 'k0', regionType: 'MainZone:Continued' },
    ])
    expect(md).toBe('<pb n="1"/>\n<continued>\n<lb n="k0"/>continued text\n</continued>\n\n')
  })

  it('keeps LADaS-typed and untyped zones separate, each grouped independently', () => {
    const md = krakenLinesToPageMarkdown(1, [
      { text: 'a paragraph line', id: 'k0', regionType: 'MainZone:P' },
      { text: 'an unrelated line', id: 'k1' },
    ])
    expect(md).toBe('<pb n="1"/>\n<p>\n<lb n="k0"/>a paragraph line\n</p>\n<lb n="k1"/>an unrelated line\n\n')
  })
})
