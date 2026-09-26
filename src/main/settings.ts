import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'

// Per-machine application settings (not per project): things that depend on the
// computer, like how many CPU threads OCR may use. Stored next to recent-projects.json.
export interface AppSettings {
  krakenThreads?: number   // undefined = automatic (see krakenOcr.ts)
}

const SETTINGS_FILE = join(app.getPath('userData'), 'settings.json')

let cache: AppSettings | null = null

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache
  try {
    cache = JSON.parse(await readFile(SETTINGS_FILE, 'utf-8')) as AppSettings
  } catch {
    cache = {}
  }
  return cache
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...(await loadSettings()), ...patch }
  for (const k of Object.keys(next) as (keyof AppSettings)[]) {
    if (next[k] === undefined) delete next[k]
  }
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf-8')
  cache = next
  return next
}
