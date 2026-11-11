import { describe, it, expect } from 'vitest'
import { tagPageText, applySuggestions } from '@shared/lightTag'

describe('lightTag', () => {
  it('suggests refs and leaves anchors intact', async () => {
    const md = '<p zone="r1">\n<lb n="a1"/>καὶ ταῦτα ( cf . Aelian . n . a . 5 , 39 ) λέγει\n<lb n="a2"/>τὸν [ 95 ] ἄνδρα\n</p>'
    const sugg = await tagPageText(md)
    expect(sugg.length).toBeGreaterThan(0)
    const out = applySuggestions(md, sugg)
    // removing the added tags gives back the input
    expect(out.replace(/<\/?(?:ref|bibl|note)>/g, '')).toBe(md)
    expect(out).toContain('<lb n="a1"/>')
    expect(out).toContain('<lb n="a2"/>')
    // no tag straddles an anchor
    expect(out).not.toMatch(/<(ref|bibl|note)>[^<]*<lb/)
  })

  it('does not retag existing elements', async () => {
    const md = '<lb n="a1"/>texte <ref>12</ref> suite'
    const sugg = await tagPageText(md)
    for (const s of sugg) for (const p of s.pieces) {
      expect(md.slice(p.start, p.end)).not.toContain('<ref>')
    }
  })

  it('nests tags at one position outer-first', () => {
    const md = 'abc def'
    const out = applySuggestions(md, [
      { id: '1', kind: 'REF', text: 'abc', pieces: [{ start: 0, end: 3 }] },
      { id: '2', kind: 'NOTE', text: 'abc def', pieces: [{ start: 0, end: 7 }] },
    ])
    expect(out).toBe('<note><ref>abc</ref> def</note>')
  })
})
