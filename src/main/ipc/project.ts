import { ipcMain, dialog, app } from 'electron'
import { readFile, writeFile, readdir } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import type { Project } from '@shared/types'

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
        contextLength: 2048,
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
    const project: Project = JSON.parse(data)
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
        projects.push(JSON.parse(data))
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

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string, ext: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('project:loadFromDir', async (_event, projectDir: string) => {
    const data = await readFile(join(projectDir, 'project.cllg.json'), 'utf-8')
    return JSON.parse(data) as Project
  })
}
