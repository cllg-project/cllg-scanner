import { ipcMain, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import type { TEIParams } from '@shared/types'
import { runMd2Tei } from './md2tei'

export function registerTEIHandlers(): void {
  ipcMain.handle('tei:generate', async (event, params: TEIParams): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const log = (line: string): void => win?.webContents.send('tei:log', line)

    log(`[cllg.tei] input  = ${params.markdownPath}`)
    log(`[cllg.tei] output = ${params.outputPath}`)

    const markdownText = await readFile(params.markdownPath, 'utf-8')

    const teiXml = runMd2Tei({
      markdownText,
      yamlConfigText: params.yamlContent,
      log,
    })

    await writeFile(params.outputPath, teiXml, 'utf-8')
    log(`[cllg.tei] done ✓ → ${params.outputPath}`)
  })
}
