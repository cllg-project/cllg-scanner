import { ipcMain, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TEIParams, TEISaveParams } from '@shared/types'
import { runMd2Tei, scanRefs } from './md2tei'

export function registerTEIHandlers(): void {
  ipcMain.handle('tei:generate', async (event, params: TEIParams): Promise<string> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const log = (line: string): void => win?.webContents.send('tei:log', line)

    log(`[cllg.tei] input = ${params.markdownPath}`)

    const markdownText = await readFile(params.markdownPath, 'utf-8')

    const teiXml = runMd2Tei({
      markdownText,
      yamlConfigText: params.yamlContent,
      bibliography: params.bibliography,
      log,
    })

    log('[cllg.tei] done ✓')
    return teiXml
  })

  ipcMain.handle('tei:save', async (_, params: TEISaveParams): Promise<void> => {
    await writeFile(params.outputPath, params.xml, 'utf-8')
  })

  ipcMain.handle('md:scanRefs', async (_, projectDir: string) => {
    const text = await readFile(join(projectDir, 'ocr_output.md'), 'utf-8').catch(() => '')
    return scanRefs(text)
  })
}
