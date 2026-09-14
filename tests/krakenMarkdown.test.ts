import { describe, it, expect } from 'vitest'
import { krakenLinesToPageMarkdown } from '../src/main/krakenMarkdown'

describe('krakenLinesToPageMarkdown', () => {
  it('joins line texts with newlines under a <pb/> marker', () => {
    const md = krakenLinesToPageMarkdown(3, [{ text: 'Hello' }, { text: 'world' }])
    expect(md).toBe('<pb n="3"/>\nHello\nworld\n\n')
  })

  it('produces just the <pb/> marker for an empty line list', () => {
    const md = krakenLinesToPageMarkdown(1, [])
    expect(md).toBe('<pb n="1"/>\n\n\n')
  })
})
