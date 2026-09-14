import { ipcMain, dialog } from 'electron'
import { createWriteStream } from 'fs'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { Page, PageExportFormat } from '@shared/types'
import { effectiveZones } from '../ladas'
import { buildAltoXml } from '../altoExport'
import { stripPseudoTags, zonesToPseudoTaggedText } from '../pageExportFormats'

const EXT: Record<PageExportFormat, string> = {
  plain: 'txt',
  'plain-ladas': 'txt',
  alto: 'xml',
  pretei: 'md',
}

async function loadPageMarkdown(projectDir: string, page: Page): Promise<string> {
  const cachePath = join(projectDir, 'pages', `page_${String(page.n).padStart(4, '0')}.md`)
  if (existsSync(cachePath)) return readFile(cachePath, 'utf-8')
  return page.markdown ?? ''
}

async function exportOneFormat(projectDir: string, page: Page, format: PageExportFormat): Promise<string> {
  switch (format) {
    case 'plain':
      return stripPseudoTags(await loadPageMarkdown(projectDir, page))
    case 'pretei':
      return loadPageMarkdown(projectDir, page)
    case 'plain-ladas': {
      const zones = effectiveZones(
        (page.lineGeometry ?? []).map((l) => ({ ...l, text: l.text ?? '' })),
        page.manualZones ?? []
      )
      return zonesToPseudoTaggedText(zones)
    }
    case 'alto':
      return buildAltoXml(page, await loadPageMarkdown(projectDir, page))
  }
}

export function registerPageExportHandlers(): void {
  ipcMain.handle(
    'page:exportFormat',
    async (_event, projectDir: string, page: Page, format: PageExportFormat): Promise<string> =>
      exportOneFormat(projectDir, page, format)
  )

  ipcMain.handle(
    'page:exportAllFormat',
    async (_event, projectDir: string, pages: Page[], format: PageExportFormat): Promise<string | null> => {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Export all pages',
        defaultPath: `pages-${format}.zip`,
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      })
      if (canceled || !filePath) return null

      const archiverModule = await import('archiver')

      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(filePath)
        const archive = archiverModule.create('zip', { zlib: { level: 6 } })

        output.on('close', resolve)
        archive.on('error', reject)
        archive.pipe(output)

        void (async () => {
          for (const page of pages) {
            const content = await exportOneFormat(projectDir, page, format)
            archive.append(content, { name: `page_${String(page.n).padStart(4, '0')}.${EXT[format]}` })
          }
          archive.finalize()
        })()
      })

      return filePath
    }
  )
}
