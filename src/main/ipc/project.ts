import { ipcMain, dialog, app } from 'electron'
import { readFile, writeFile, readdir } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname, isAbsolute, basename, sep } from 'path'
import { randomUUID } from 'crypto'
import type { Project } from '@shared/types'

// Detect absolute paths from either OS regardless of which OS is running now.
// isAbsolute() only recognises the *current* OS's absolute-path syntax.
function isAnyAbsolute(p: string): boolean {
  return isAbsolute(p) || /^[A-Za-z]:[/\\]/.test(p)
}

/**
 * Normalise page paths to be relative to projectDir.
 * Handles existing projects where paths were stored as absolute, and
 * cross-OS moves where an absolute path from another OS doesn't exist here.
 */
function repairProjectPaths(project: Project): Project {
  const dir = project.projectDir
  // Ensure the prefix check is safe regardless of whether dir ends with a separator
  const prefix = dir.endsWith(sep) || dir.endsWith('/') ? dir : dir + sep
  const repair = (p: string | undefined): string | undefined => {
    if (!p || !isAnyAbsolute(p)) return p
    // Absolute path within this machine's projectDir → make relative
    if (p.startsWith(prefix) || p === dir) {
      return p.slice(prefix.length).replace(/\\/g, '/')
    }
    // Cross-OS or different location — preserve the pages/<filename> structure
    // by scanning for a 'pages/' segment rather than blindly using basename.
    const pagesMatch = p.match(/[/\\]pages[/\\](.+)$/)
    if (pagesMatch) return `pages/${pagesMatch[1].replace(/\\/g, '/')}`
    return `pages/${basename(p.replace(/\\/g, '/'))}`
  }
  return {
    ...project,
    pages: project.pages.map((page) => ({
      ...page,
      imagePath: repair(page.imagePath) ?? page.imagePath,
      maskedImagePath: repair(page.maskedImagePath),
    })),
  }
}

const RECENT_FILE = join(app.getPath('userData'), 'recent-projects.json')

async function loadRecent(): Promise<string[]> {
  try {
    const data = await readFile(RECENT_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

async function saveRecent(paths: string[]): Promise<void> {
  await writeFile(RECENT_FILE, JSON.stringify(paths.slice(0, 20)), 'utf-8')
}

async function addToRecent(projectFile: string): Promise<void> {
  const current = await loadRecent()
  const updated = [projectFile, ...current.filter((p) => p !== projectFile)]
  await saveRecent(updated)
}

export function registerProjectHandlers(): void {
  ipcMain.handle('project:new', async (_event, pdfPath: string, projectDir: string) => {
    mkdirSync(join(projectDir, 'pages'), { recursive: true })
    const project: Project = {
      version: 1,
      id: randomUUID(),
      name: projectDir.split('/').pop() ?? 'Untitled',
      projectDir,
      pdfPath,
      pages: [],
      metadata: { title: '', author: '', edition: '', language: '' },
      hierarchy: [],
      lmConfig: {
        endpoint: 'http://localhost:1234',
        model: '',
        contextLength: 4096,
        temperature: 0
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    const savePath = join(projectDir, 'project.cllg.json')
    await writeFile(savePath, JSON.stringify(project, null, 2), 'utf-8')
    await addToRecent(savePath)
    return project
  })

  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open CLLG Project',
      filters: [{ name: 'CLLG Project', extensions: ['cllg.json', 'json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const data = await readFile(filePath, 'utf-8')
    const raw: Project = JSON.parse(data)
    // Update projectDir to the actual file location so that moved projects work
    const project: Project = repairProjectPaths({ ...raw, projectDir: dirname(filePath) })
    await addToRecent(filePath)
    return project
  })

  ipcMain.handle('project:save', async (_event, project: Project) => {
    const updated = { ...project, updatedAt: new Date().toISOString() }
    const savePath = join(project.projectDir, 'project.cllg.json')
    await writeFile(savePath, JSON.stringify(updated, null, 2), 'utf-8')
    await addToRecent(savePath)
  })

  ipcMain.handle('project:removeRecent', async (_event, projectId: string) => {
    const paths = await loadRecent()
    const remaining: string[] = []
    for (const p of paths) {
      if (!existsSync(p)) continue
      try {
        const data = await readFile(p, 'utf-8')
        const proj: Project = JSON.parse(data)
        if (proj.id !== projectId) remaining.push(p)
      } catch {
        // skip corrupt
      }
    }
    await saveRecent(remaining)
  })

  ipcMain.handle('project:recent', async () => {
    const paths = await loadRecent()
    const projects: Project[] = []
    for (const p of paths) {
      if (!existsSync(p)) continue
      try {
        const data = await readFile(p, 'utf-8')
        projects.push(repairProjectPaths(JSON.parse(data)))
      } catch {
        // skip corrupt files
      }
    }
    return projects
  })

  ipcMain.handle('pdf:select', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:selectDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Project Folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:selectImages', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Image Files',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string, ext: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('project:loadFromDir', async (_event, projectDir: string) => {
    const data = await readFile(join(projectDir, 'project.cllg.json'), 'utf-8')
    const raw = JSON.parse(data) as Project
    return repairProjectPaths({ ...raw, projectDir })
  })
}
