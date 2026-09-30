#!/usr/bin/env node
// Checks model files against resources/models.json (size + SHA-256).
//
//   node scripts/model-manifest.mjs verify <dir>   exit 1 unless every model in <dir> matches
//   node scripts/model-manifest.mjs list           print the model file names, one per line
//
// Used by the release workflow before attaching the models to a release. No dependencies.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'resources', 'models.json'), 'utf-8'))

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
  })

const [cmd, dir] = process.argv.slice(2)
if (cmd === 'list') {
  for (const m of manifest.files) console.log(m.file)
} else if (cmd === 'verify' && dir) {
  let ok = true
  for (const m of manifest.files) {
    const path = join(dir, m.file)
    if (!existsSync(path)) { console.error(`✗ ${m.file}: missing`); ok = false; continue }
    const size = statSync(path).size
    const digest = await sha256(path)
    if (size !== m.size || digest !== m.sha256) {
      console.error(`✗ ${m.file}: size ${size} (expected ${m.size}), sha256 ${digest} (expected ${m.sha256})`)
      ok = false
    } else {
      console.log(`✓ ${m.file}`)
    }
  }
  process.exit(ok ? 0 : 1)
} else {
  console.error('usage: model-manifest.mjs verify <dir> | list')
  process.exit(2)
}
