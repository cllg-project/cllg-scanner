import { ipcMain, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import type { Page } from '@shared/types'
import { buildSearchablePdf } from '../searchablePdf'

export function registerSearchablePdfExportHandlers(): void {
  ipcMain.handle(
    'project:exportSearchablePdf',
    async (_event, projectDir: string, pages: Page[], projectName: string): Promise<string | null> => {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Export searchable PDF',
        defaultPath: `${projectName}.pdf`,
        filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      })
      if (canceled || !filePath) return null

      const bytes = await buildSearchablePdf(projectDir, pages, projectName)
      await writeFile(filePath, bytes)
      return filePath
    }
  )
}
