import { ipcMain, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TEIParams } from '@shared/types'
import { runMd2Tei, scanRefs } from './md2tei'

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

  ipcMain.handle('md:scanRefs', async (_, projectDir: string) => {
    const text = await readFile(join(projectDir, 'ocr_output.md'), 'utf-8').catch(() => '')
    return scanRefs(text)
  })
}
