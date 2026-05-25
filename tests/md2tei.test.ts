import { describe, it, expect } from 'vitest'

function normalizeXml(xml: string): string {
  return xml.replace(/\s+/g, ' ').replace(/ <\//g, '</').trim()
}
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { runMd2Tei } from '../src/main/ipc/md2tei'

const FIXTURES = join(__dirname, 'md2tei')

const cases = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

describe.each(cases.map((name) => [name]))('md2tei fixture: %s', (name) => {
  it('produces expected XML', () => {
    const dir = join(FIXTURES, name)
    const markdownText = readFileSync(join(dir, 'input.md'), 'utf-8')
    const yamlConfigText = readFileSync(join(dir, 'config.yaml'), 'utf-8')
    const expected = readFileSync(join(dir, 'expected.xml'), 'utf-8')

    const result = runMd2Tei({ markdownText, yamlConfigText, log: () => {} })

    expect(normalizeXml(result)).toBe(normalizeXml(expected))
  })
})
