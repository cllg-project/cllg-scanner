import { describe, it, expect } from 'vitest'
import { findAnchors, findAnchorAt, spanForLineIds } from '../src/renderer/src/utils/lbAnchors'

describe('findAnchors', () => {
  it('finds every <lb n="id"/> occurrence with its position', () => {
    const md = 'x<lb n="k0"/>hello<lb n="k1"/>world'
    expect(findAnchors(md)).toEqual([
      { id: 'k0', start: 1, end: 13 },
      { id: 'k1', start: 18, end: 30 },
    ])
  })

  it('returns an empty array when there are no anchors', () => {
    expect(findAnchors('plain text, no anchors')).toEqual([])
  })
})

describe('findAnchorAt', () => {
  const md = '<lb n="k0"/>Hello <lb n="k1"/>world'

  it('returns the anchor id owning the cursor position', () => {
    expect(findAnchorAt(md, 15)).toBe('k0')
    expect(findAnchorAt(md, 32)).toBe('k1')
  })

  it('returns null when the cursor is before any anchor', () => {
    expect(findAnchorAt('no anchors here', 5)).toBe(null)
  })

  it('returns the anchor id exactly at its own start position', () => {
    expect(findAnchorAt(md, 0)).toBe('k0')
  })
})

describe('spanForLineIds', () => {
  const md = '<pb n="1"/>\n<lb n="k0"/>First line<lb n="k1"/>second line\n<lb n="k2"/>Unrelated line\n'

  it('spans from the first matching anchor to the end of the line containing the last', () => {
    const span = spanForLineIds(md, ['k0', 'k1'])
    expect(span).not.toBeNull()
    expect(md.slice(span!.start, span!.end)).toBe('<lb n="k0"/>First line<lb n="k1"/>second line')
  })

  it('returns null when none of the ids have an anchor in the markdown', () => {
    expect(spanForLineIds(md, ['zzz'])).toBeNull()
  })

  it('extends to end of string when the last anchor is on the final line', () => {
    const span = spanForLineIds(md, ['k2'])
    expect(md.slice(span!.start, span!.end)).toBe('<lb n="k2"/>Unrelated line')
  })

  it('preserves the line break between matched lines, ready for a multi-line block wrap', () => {
    const span = spanForLineIds(md, ['k0'])
    // Wrapping [start,end) directly with open/close tags on their own lines produces a
    // real multi-line block md2tei.ts's buildBody() understands natively.
    const wrapped = md.slice(0, span!.start) + `<quote>\n${md.slice(span!.start, span!.end)}\n</quote>` + md.slice(span!.end)
    expect(wrapped).toContain('<quote>\n<lb n="k0"/>First line<lb n="k1"/>second line\n</quote>')
  })

  it('expands past an existing wrapper so regrouping replaces it instead of nesting a duplicate', () => {
    // Regression: redrawing a manual region over lines already wrapped by a block tag
    // (from krakenMarkdown.ts's zone builder, or a previous manual group) must replace
    // that wrapper, not wrap a second tag around it — producing doubled <p><p>...</p></p>.
    const wrapped = '<pb n="1"/>\n<p>\n<lb n="k0"/>First line\n<lb n="k1"/>second line\n</p>\n<lb n="k2"/>Unrelated\n'
    const span = spanForLineIds(wrapped, ['k0', 'k1'])
    expect(span).not.toBeNull()
    expect(wrapped.slice(span!.start, span!.end)).toBe(
      '<p>\n<lb n="k0"/>First line\n<lb n="k1"/>second line\n</p>'
    )
  })

  it('does not expand past a wrapper of a different tag name', () => {
    const md2 = '<head>\n<lb n="k0"/>Title\n</quote>\n' // mismatched close tag — malformed on purpose
    const span = spanForLineIds(md2, ['k0'])
    expect(md2.slice(span!.start, span!.end)).toBe('<lb n="k0"/>Title')
  })

  it('does not expand when there is no wrapper at all', () => {
    const span = spanForLineIds(md, ['k0', 'k1'])
    expect(md.slice(span!.start, span!.end)).toBe('<lb n="k0"/>First line<lb n="k1"/>second line')
  })
})
