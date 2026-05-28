import { ipcMain, dialog } from 'electron'
import { createWriteStream } from 'fs'
import { basename } from 'path'

export function registerProjectExportHandlers(): void {
  ipcMain.handle('project:exportZip', async (_event, projectDir: string, projectName: string) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export project as zip',
      defaultPath: `${projectName}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    })
    if (canceled || !filePath) return null

    const { ZipArchive } = await import('archiver')

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(filePath)
      const archive = new ZipArchive({ zlib: { level: 6 } })

      output.on('close', resolve)
      archive.on('error', reject)
      archive.pipe(output)

      archive.directory(projectDir, basename(projectDir))
      archive.finalize()
    })

    return filePath
  })
}
