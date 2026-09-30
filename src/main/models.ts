import { app, net, ipcMain, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs'
import { rename, unlink } from 'fs/promises'
import { basename, join } from 'path'
import manifest from '../../resources/models.json'
import type { ModelDownloadEvent, ModelStatus } from '@shared/types'

// The built-in Kraken models are not in this repository nor in the app package: they
// live in their own repository (Git LFS, `modelsRepo`), are published as that
// repository's release assets and attached to each app release, and are downloaded on
// first run into the user-data folder. resources/models.json lists them with their size
// and SHA-256; a download is kept only if it matches.

interface ModelEntry {
  file: string
  size: number
  sha256: string
  description: string
}

export const MODELS: ModelEntry[] = manifest.files

/** Where downloaded models live (per user, kept across app updates). */
export function modelsDownloadDir(): string {
  return join(app.getPath('userData'), 'models')
}

// In development, models placed in resources/models/ are used as they are.
function devModelsDir(): string | null {
  return is.dev ? join(app.getAppPath(), 'resources', 'models') : null
}

/** Path of a built-in model: an existing copy if there is one, else its download target. */
export function builtinModelPath(file: string): string {
  const downloaded = join(modelsDownloadDir(), file)
  if (existsSync(downloaded)) return downloaded
  const dev = devModelsDir()
  if (dev && existsSync(join(dev, file))) return join(dev, file)
  return downloaded
}

const BUILTIN_FILES = new Set(MODELS.map((m) => m.file))

/**
 * A model path as stored in a project. Projects keep absolute paths, and a built-in
 * model's path changes when it moves (it used to be bundled in the app's resources):
 * a missing built-in model is looked up by file name where built-in models are now.
 */
export function resolveModelPath(p: string): string {
  if (!p || existsSync(p)) return p
  const file = basename(p)
  return BUILTIN_FILES.has(file) ? builtinModelPath(file) : p
}

/** Throws a readable error when a model file isn't there (e.g. not downloaded yet). */
export function assertModelPresent(p: string): void {
  if (existsSync(p)) return
  const file = basename(p)
  throw new Error(
    BUILTIN_FILES.has(file)
      ? `The built-in model ${file} has not been downloaded yet. Restart the app to download it.`
      : `Model not found: ${p}`
  )
}

export function modelStatus(): ModelStatus[] {
  return MODELS.map((m) => {
    const path = builtinModelPath(m.file)
    const present = existsSync(path) && statSync(path).size === m.size
    return { file: m.file, description: m.description, size: m.size, present }
  })
}

// Where the app looks, in order: its own version's release, then the models
// repository's release pinned in the manifest (development builds, or an app release
// published without them).
function downloadUrls(file: string): string[] {
  return [
    `https://github.com/${manifest.repo}/releases/download/v${app.getVersion()}/${file}`,
    `https://github.com/${manifest.modelsRepo}/releases/download/${manifest.modelsTag}/${file}`,
  ]
}

async function downloadOne(
  m: ModelEntry,
  onProgress: (received: number) => void,
  signal: AbortSignal
): Promise<void> {
  const dir = modelsDownloadDir()
  mkdirSync(dir, { recursive: true })
  const target = join(dir, m.file)
  const part = `${target}.part`
  let lastError = ''
  for (const url of downloadUrls(m.file)) {
    let res: Response
    try {
      res = await net.fetch(url, { signal })
    } catch (err) {
      if (signal.aborted) throw err
      lastError = String(err)
      continue
    }
    if (!res.ok || !res.body) {
      lastError = `HTTP ${res.status} for ${url}`
      continue
    }
    const hash = createHash('sha256')
    const out = createWriteStream(part)
    let received = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        received += value.length
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        onProgress(received)
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    } catch (err) {
      out.destroy()
      await unlink(part).catch(() => {})
      throw err
    }
    const digest = hash.digest('hex')
    if (received !== m.size || digest !== m.sha256) {
      await unlink(part).catch(() => {})
      lastError = `${m.file}: downloaded file does not match (size ${received}, sha256 ${digest.slice(0, 12)}…)`
      continue
    }
    await rename(part, target)
    return
  }
  throw new Error(`Could not download ${m.file}: ${lastError}`)
}

let running: { promise: Promise<void>; controller: AbortController } | null = null

/** Downloads every missing model, one after the other, reporting progress to `send`. */
function downloadMissing(send: (e: ModelDownloadEvent) => void): Promise<void> {
  if (running) return running.promise
  const controller = new AbortController()
  const promise = (async () => {
    for (const m of MODELS) {
      const status = modelStatus().find((s) => s.file === m.file)
      if (status?.present) continue
      send({ file: m.file, status: 'started', received: 0, total: m.size })
      let lastSent = 0
      try {
        await downloadOne(
          m,
          (received) => {
            // At most ~10 progress events a second.
            const now = Date.now()
            if (now - lastSent < 100) return
            lastSent = now
            send({ file: m.file, status: 'progress', received, total: m.size })
          },
          controller.signal
        )
        send({ file: m.file, status: 'done', received: m.size, total: m.size })
      } catch (err) {
        send({ file: m.file, status: 'error', received: 0, total: m.size, error: controller.signal.aborted ? 'cancelled' : String(err) })
        throw err
      }
    }
  })().finally(() => {
    running = null
  })
  running = { promise, controller }
  return promise
}

export function registerModelHandlers(): void {
  ipcMain.handle('models:status', () => modelStatus())

  ipcMain.handle('models:download', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await downloadMissing((e) => win?.webContents.send('models:progress', e))
    return modelStatus()
  })

  ipcMain.handle('models:cancel', () => {
    running?.controller.abort()
  })
}
