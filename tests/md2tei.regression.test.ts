import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'
import { runMd2Tei } from '../src/main/ipc/md2tei'

const FIXTURES = join(__dirname, 'md2tei')
const fixture = (name: string): { md: string; yaml: string } => ({
  md: readFileSync(join(FIXTURES, name, 'input.md'), 'utf-8'),
  yaml: readFileSync(join(FIXTURES, name, 'config.yaml'), 'utf-8'),
})
const run = (md: string, yaml: string, bibliography?: Parameters<typeof runMd2Tei>[0]['bibliography']): string =>
  runMd2Tei({ markdownText: md, yamlConfigText: yaml, bibliography, log: () => {} })
const runFixture = (name: string): string => { const f = fixture(name); return run(f.md, f.yaml) }

const select = xpath.useNamespaces({ t: 'http://www.tei-c.org/ns/1.0' })
// The declared citeStructure paths are namespace-free (TEI-style); strip the default
// namespace by evaluating on a copy parsed without it, as lxml-style consumers do.
const parse = (xml: string): Document =>
  new DOMParser().parseFromString(xml.replace(' xmlns="http://www.tei-c.org/ns/1.0"', ''), 'text/xml') as unknown as Document
const nodes = (expr: string, ctx: Node): Node[] => xpath.select(expr, ctx) as Node[]
const text = (n: Node): string => n.textContent ?? ''

describe('citeStructure XPaths match the generated document', () => {
  it.each(['01-simple', '02-missing-first', '05-milestone'])('%s', (name) => {
    const doc = parse(runFixture(name))
    const walk = (cs: Node, ctxs: Node[]): void => {
      const match = (cs as Element).getAttribute('match')!
      const unit = (cs as Element).getAttribute('unit')!
      const hits = ctxs.flatMap((c) => nodes(match, c))
      const expected = nodes(`//*[(local-name()='div' and @type='${unit}') or (local-name()='milestone' and @unit='${unit}')]`, doc)
      expect(hits.length, `${unit}: ${match}`).toBe(expected.length)
      expect(hits.length).toBeGreaterThan(0)
      for (const child of nodes('./citeStructure', cs)) walk(child, hits)
    }
    const roots = nodes('/TEI/teiHeader/encodingDesc/refsDecl[not(@type)]/citeStructure', doc)
    expect(roots).toHaveLength(1)
    walk(roots[0], [doc])
  })

  it('physical //pb still matches', () => {
    expect(nodes('//pb', parse(runFixture('01-simple'))).length).toBeGreaterThan(0)
  })
})

describe('no whitespace is injected into text content', () => {
  const doc = parse(runFixture('07-quote'))
  it('title and paragraph-like elements have exact text', () => {
    expect(text(nodes('//titleStmt/title', doc)[0])).toBe('Simple Test')
    for (const el of nodes('//p | //head | //quote | //label', doc)) expect(text(el)).toBe(text(el).trim())
  })
  it('lb inside quote stays inline', () => {
    const xml = run('<pb n="1"/>\n<quote>\n<lb n="a"/>uno\n<lb n="b"/>duo\n</quote>\n', '')
    const q = nodes('//quote', parse(xml))[0]
    expect(text(q)).not.toMatch(/\n\s*$/)
    expect(xml).not.toMatch(/\n[ ]+<lb n="b"/)
  })
})

describe('nested inline markup', () => {
  const xml = runFixture('16-nested-inline')
  const doc = parse(xml)
  it('is not escaped', () => {
    expect(xml).not.toContain('&lt;')
    expect(nodes('//cit/bibl', doc).length).toBe(2)
    expect(nodes('//note[@place="margin"]/bibl', doc)).toHaveLength(1)
  })
  it('keeps <cit><quote/><bibl/></cit> in one piece', () => {
    expect(nodes('//cit[quote and bibl]', doc)).toHaveLength(1)
  })
})

describe('YAML metadata', () => {
  it('feeds the header, escaped', () => {
    const doc = parse(runFixture('18-metadata'))
    expect(text(nodes('//titleStmt/title', doc)[0])).toBe('Tom & Jerry <1>')
    expect(text(nodes('//titleStmt/author', doc)[0])).toBe('A. Author')
    expect(text(nodes('//sourceDesc/p', doc)[0])).toBe('Teubner 1900')
  })
  it('falls back to defaults', () => {
    const doc = parse(run('<pb n="1"/>\nx\n', ''))
    expect(text(nodes('//titleStmt/title', doc)[0])).toBe('OCR Document')
    expect(nodes('//titleStmt/author', doc)).toHaveLength(0)
    expect(text(nodes('//sourceDesc/p', doc)[0])).toBe('Born-digital OCR')
  })
})

describe('<continued> after a quote', () => {
  it('merges into the quote', () => {
    const doc = parse(runFixture('15-quote-continued'))
    expect(nodes('//quote', doc)).toHaveLength(1)
    expect(nodes('//quote/pb[@n="2"]', doc)).toHaveLength(1)
    expect(text(nodes('//quote', doc)[0])).toContain('transeunt paginam.')
    expect(nodes('//body//p[contains(., "transeunt")]', doc)).toHaveLength(0)
  })
})

describe('hyphenation in head and quote', () => {
  const doc = parse(runFixture('17-hyphenation-head-quote'))
  it.each(['head', 'quote'])('joins inside <%s>', (tag) => {
    expect(nodes(`//${tag}/lb[@break="no"]`, doc)).toHaveLength(1)
    expect(text(nodes(`//${tag}`, doc)[0])).not.toMatch(/-/)
  })
})
