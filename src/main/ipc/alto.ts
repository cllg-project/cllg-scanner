import { ipcMain, dialog } from 'electron'
import { readFile, readdir } from 'fs/promises'
import { join, extname, basename } from 'path'
import type { AltoScanResult, AltoLine } from '@shared/types'
import { parseAlto } from '../altoImport'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'])

export function registerAltoHandlers(): void {
  ipcMain.handle('dialog:selectAltoDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select ALTO XML folder',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('alto:scanDir', async (_event, dirPath: string): Promise<AltoScanResult[]> => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const xmlFiles = entries
      .filter((e) => e.isFile() && extname(e.name).toLowerCase() === '.xml')
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

    const imageFiles = entries
      .filter((e) => e.isFile() && IMAGE_EXTS.has(extname(e.name).toLowerCase()))
      .map((e) => e.name)

    const results: AltoScanResult[] = []

    for (const xmlName of xmlFiles) {
      const altoPath = join(dirPath, xmlName)
      let imagePath: string | null = null
      let lineCount = 0
      let regionTypes: string[] = []
      try {
        const xmlText = await readFile(altoPath, 'utf-8')
        const parsed = parseAlto(xmlText)
        lineCount = parsed.lines.length
        regionTypes = [...new Set(parsed.lines.map((l) => l.regionType).filter((t): t is string => !!t))]

        // 1) explicit <sourceImageInformation><fileName>, resolved relative to dirPath
        if (parsed.imageFileName) {
          const candidate = join(dirPath, basename(parsed.imageFileName))
          if (imageFiles.includes(basename(candidate))) imagePath = candidate
        }
        // 2) fallback: same basename as the ALTO file, any known image extension
        if (!imagePath) {
          const stem = xmlName.replace(/\.xml$/i, '')
          const match = imageFiles.find((f) => f.replace(extname(f), '') === stem)
          if (match) imagePath = join(dirPath, match)
        }
      } catch {
        // unreadable/unparsable ALTO file — still list it with no geometry
      }

      results.push({ altoPath, imagePath, lineCount, regionTypes })
    }

    return results
  })

  // Full parsed line geometry for a single ALTO file, used at import-confirm time
  // (kept separate from alto:scanDir, which only returns lightweight preview counts).
  ipcMain.handle('alto:parseFile', async (_event, altoPath: string): Promise<AltoLine[]> => {
    const xmlText = await readFile(altoPath, 'utf-8')
    return parseAlto(xmlText).lines
  })
}
