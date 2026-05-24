import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

function getPythonDir(): string {
  if (is.dev) {
    // In dev, use system python (must have deps installed)
    return ''
  }
  const resourcesPath = process.resourcesPath
  const platform = process.platform
  const candidates = [
    join(resourcesPath, `python-${platform}`, 'bin', 'python3'),
    join(resourcesPath, `python-${platform}`, 'bin', 'python'),
    join(resourcesPath, 'python-runtime', 'bin', 'python3'),
    join(resourcesPath, 'python-runtime', 'python.exe'),  // Windows
    join(resourcesPath, 'python-runtime', 'bin', 'python3')
  ]
  return candidates.find(existsSync) ?? ''
}

export function getPythonBin(): string {
  const bin = getPythonDir()
  if (bin && existsSync(bin)) return bin
  // Fallback to system python
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function getPipelineScript(): string {
  if (is.dev) {
    return join(app.getAppPath(), 'python', 'cllg_export.py')
  }
  return join(process.resourcesPath, 'python', 'cllg_export.py')
}
