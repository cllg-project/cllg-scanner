import { ipcMain, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { join } from 'path'
import { getPythonBin, getPipelineScript } from '../python'
import type { TEIParams } from '@shared/types'

function spawnPython(
  args: string[],
  log: (line: string) => void
): Promise<void> {
  const python = getPythonBin()
  const script = getPipelineScript()
  return new Promise<void>((resolve, reject) => {
    const child = spawn(python, [script, ...args], { cwd: join(script, '..') })
    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n'))
        if (line.trim()) log(`[stdout] ${line}`)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n'))
        if (line.trim()) log(`[stderr] ${line}`)
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else { const m = `process exited with code ${code}`; log(`[error] ${m}`); reject(new Error(m)) }
    })
    child.on('error', (err) => { log(`[error] spawn: ${err.message}`); reject(err) })
  })
}

export function registerTEIHandlers(): void {
  ipcMain.handle('tei:generate', async (event, params: TEIParams): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const log = (line: string): void => win?.webContents.send('tei:log', line)

    log(`[cllg.tei] writing config → ${params.yamlConfigPath}`)
    await writeFile(params.yamlConfigPath, params.yamlContent, 'utf-8')

    log(`[cllg.tei] input  = ${params.markdownPath}`)
    log(`[cllg.tei] output = ${params.outputPath}`)

    await spawnPython(
      ['md2tei', '--input', params.markdownPath, '--output', params.outputPath, '--config', params.yamlConfigPath],
      log
    )
    log(`[cllg.tei] done ✓ → ${params.outputPath}`)
  })
}
