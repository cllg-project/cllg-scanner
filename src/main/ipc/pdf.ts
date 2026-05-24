import { ipcMain, shell, dialog } from 'electron'
import { writeFile, readFile, readdir, copyFile } from 'fs/promises'
import { mkdirSync } from 'fs'
import { join, extname, basename } from 'path'
import type { Project } from '@shared/types'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'])

export function registerPDFHandlers(): void {
  // Save a page image (PNG ArrayBuffer from renderer canvas render)
  ipcMain.handle(
    'page:saveImage',
    async (_event, projectDir: string, pageNum: number, data: ArrayBuffer) => {
      const pagesDir = join(projectDir, 'pages')
      mkdirSync(pagesDir, { recursive: true })
      const fileName = `page_${String(pageNum).padStart(4, '0')}.png`
      const filePath = join(pagesDir, fileName)
      await writeFile(filePath, Buffer.from(data))
      return filePath
    }
  )

  // Save masked version of a page image
  ipcMain.handle(
    'page:saveMasked',
    async (_event, projectDir: string, pageNum: number, data: ArrayBuffer) => {
      const pagesDir = join(projectDir, 'pages')
      mkdirSync(pagesDir, { recursive: true })
      const fileName = `page_${String(pageNum).padStart(4, '0')}_masked.png`
      const filePath = join(pagesDir, fileName)
      await writeFile(filePath, Buffer.from(data))
      return filePath
    }
  )

  // Load an image file and return as base64 data URL
  ipcMain.handle('page:loadImage', async (_event, absolutePath: string) => {
    const data = await readFile(absolutePath)
    const ext = absolutePath.split('.').pop()?.toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,${data.toString('base64')}`
  })

  // Load a PDF file and return its raw bytes (for pdfjs in renderer).
  // Must be a fresh Uint8Array — Node Buffer's .buffer is a shared pool and corrupts over IPC.
  ipcMain.handle('pdf:loadData', async (_event, filePath: string) => {
    const buf = await readFile(filePath)
    return new Uint8Array(buf)
  })

  // Open dialog that accepts PDF and DjVu files
  ipcMain.handle('dialog:selectDocument', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select PDF or DjVu document',
      filters: [
        { name: 'Documents', extensions: ['pdf', 'djvu', 'djv'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'DjVu', extensions: ['djvu', 'djv'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Open dialog to select a folder of images
  ipcMain.handle('dialog:selectImageDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select image folder',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // List image files in a directory, naturally sorted by filename
  ipcMain.handle('dir:listImages', async (_event, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const images = entries
      .filter((e) => e.isFile() && IMAGE_EXTS.has(extname(e.name).toLowerCase()))
      .map((e) => ({ name: e.name, path: join(dirPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    return images
  })

  // Copy an external image into the project pages dir (for image-folder import)
  ipcMain.handle(
    'page:copyImage',
    async (_event, srcPath: string, projectDir: string, pageNum: number) => {
      const pagesDir = join(projectDir, 'pages')
      mkdirSync(pagesDir, { recursive: true })
      const ext = extname(srcPath).toLowerCase() || '.png'
      const fileName = `page_${String(pageNum).padStart(4, '0')}${ext}`
      const destPath = join(pagesDir, fileName)
      await copyFile(srcPath, destPath)
      return destPath
    }
  )

  // Read per-page markdown cache
  ipcMain.handle('page:loadMarkdown', async (_event, projectDir: string, pageN: number) => {
    const p = join(projectDir, 'pages', `page_${String(pageN).padStart(4, '0')}.md`)
    try { return await readFile(p, 'utf-8') } catch { return '' }
  })

  // Write per-page markdown cache and rebuild ocr_output.md
  ipcMain.handle('page:saveMarkdown', async (_event, projectDir: string, pageN: number, content: string) => {
    const cachePath = join(projectDir, 'pages', `page_${String(pageN).padStart(4, '0')}.md`)
    await writeFile(cachePath, content, 'utf-8')
    // Rebuild combined output from all cache files in page order
    const entries = await readdir(join(projectDir, 'pages'))
    const mdFiles = entries
      .filter((e) => /^page_\d+\.md$/.test(e))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const parts: string[] = []
    for (const f of mdFiles) {
      try { parts.push(await readFile(join(projectDir, 'pages', f), 'utf-8')) } catch { /* skip */ }
    }
    await writeFile(join(projectDir, 'ocr_output.md'), parts.join(''), 'utf-8')
  })

  ipcMain.handle('ocr:loadOutput', async (_event, projectDir: string) => {
    const p = join(projectDir, 'ocr_output.md')
    try { return await readFile(p, 'utf-8') } catch { return '' }
  })

  ipcMain.on('shell:openPath', (_event, path: string) => {
    shell.openPath(path)
  })

  ipcMain.handle('export:coco', async (_event, project: Project) => {
    const result = await dialog.showSaveDialog({
      title: 'Save COCO annotations',
      defaultPath: `${project.name}_annotations.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return

    const images: object[] = []
    const annotations: object[] = []
    let annId = 1

    for (const page of project.pages) {
      if (!page.masks || page.masks.length === 0) continue

      let width = 0, height = 0
      try {
        // Read width/height from PNG IHDR (bytes 16–23, big-endian)
        const imgPath = join(project.projectDir, page.imagePath)
        const buf = await readFile(imgPath)
        width = buf.readUInt32BE(16)
        height = buf.readUInt32BE(20)
      } catch { /* leave 0,0 if unreadable */ }

      images.push({ id: page.n, file_name: basename(page.imagePath), width, height })

      for (const mask of page.masks) {
        annotations.push({
          id: annId++,
          image_id: page.n,
          category_id: 1,
          bbox: [mask.x, mask.y, mask.width, mask.height],
          area: mask.width * mask.height,
          segmentation: [],
          iscrowd: 0
        })
      }
    }

    const coco = {
      info: { description: project.name, version: '1.0', date_created: new Date().toISOString() },
      licenses: [],
      images,
      annotations,
      categories: [{ id: 1, name: 'ApparatusCriticus', supercategory: '' }]
    }

    await writeFile(result.filePath, JSON.stringify(coco, null, 2))
  })
}
