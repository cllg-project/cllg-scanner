/**
 * Regenerate expected.xml for every fixture under tests/md2tei/.
 * Run with:  npm run test:update
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { runMd2Tei } from '../src/main/ipc/md2tei'

const FIXTURES = join(__dirname, 'md2tei')

const cases = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

for (const name of cases) {
  const dir = join(FIXTURES, name)
  const markdownText = readFileSync(join(dir, 'input.md'), 'utf-8')
  const yamlConfigText = readFileSync(join(dir, 'config.yaml'), 'utf-8')
  const result = runMd2Tei({ markdownText, yamlConfigText, log: () => {} })
  writeFileSync(join(dir, 'expected.xml'), result)
  console.log(`✓  ${name}`)
}
