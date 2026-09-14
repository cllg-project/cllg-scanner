import { ipcMain, dialog } from 'electron'
import { readFile, readdir, writeFile, appendFile } from 'fs/promises'
import { mkdirSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import type { AltoScanResult, AltoLine } from '@shared/types'
import { parseAlto } from '../altoImport'
import { isLadasCompatible } from '../ladas'
import { krakenLinesToPageMarkdown } from '../krakenMarkdown'

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
      let ladasCompatible = false
      try {
        const xmlText = await readFile(altoPath, 'utf-8')
        const parsed = parseAlto(xmlText)
        lineCount = parsed.lines.length
        regionTypes = [...new Set(parsed.lines.map((l) => l.regionType).filter((t): t is string => !!t))]
        ladasCompatible = isLadasCompatible(parsed.lines)

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

      results.push({ altoPath, imagePath, lineCount, regionTypes, ladasCompatible })
    }

    return results
  })

  // Full parsed line geometry for a single ALTO file, used at import-confirm time
  // (kept separate from alto:scanDir, which only returns lightweight preview counts).
  ipcMain.handle('alto:parseFile', async (_event, altoPath: string): Promise<AltoLine[]> => {
    const xmlText = await readFile(altoPath, 'utf-8')
    return parseAlto(xmlText).lines
  })

  // Write the ALTO file's own ground-truth CONTENT as the page's initial
  // transcription, at import time — reuses the exact same zone-aware/anchored
  // markdown builder Kraken uses, since AltoLine already carries id/blockId/
  // regionType/text in the same shape. Lines with no CONTENT (rare — a purely
  // geometric ALTO export) fall back to an empty string for that line rather than
  // failing the whole page.
  ipcMain.handle(
    'alto:importPageText',
    async (_event, projectDir: string, pageN: number, lines: AltoLine[], sourceAltoPath?: string): Promise<void> => {
      const cacheDir = join(projectDir, 'pages')
      mkdirSync(cacheDir, { recursive: true })
      const cachePath = join(cacheDir, `page_${String(pageN).padStart(4, '0')}.md`)
      const pageMarkdown = krakenLinesToPageMarkdown(
        pageN,
        lines.map((l) => ({ text: l.text ?? '', id: l.id, blockId: l.blockId, regionType: l.regionType }))
      )
      await writeFile(cachePath, pageMarkdown, 'utf-8')
      await appendFile(join(projectDir, 'ocr_output.md'), pageMarkdown, 'utf-8')

      // Archive a verbatim copy of the source ALTO file, write-once — 100% fidelity
      // (baseline included) independent of any later correction (Sequence 6).
      if (sourceAltoPath) {
        const archivePath = join(cacheDir, `page_${String(pageN).padStart(4, '0')}.alto.xml`)
        if (!existsSync(archivePath)) {
          const xmlText = await readFile(sourceAltoPath, 'utf-8')
          await writeFile(archivePath, xmlText, 'utf-8')
        }
      }
    }
  )
}
