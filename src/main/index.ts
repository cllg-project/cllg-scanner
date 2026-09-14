import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { appendFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { registerProjectHandlers } from './ipc/project'
import { registerPDFHandlers } from './ipc/pdf'
import { registerOCRHandlers } from './ipc/ocr'
import { registerTEIHandlers } from './ipc/tei'
import { registerKrakenHandlers } from './ipc/krakenOcr'
import { registerProjectExportHandlers } from './ipc/projectExport'
import { registerAltoHandlers } from './ipc/alto'

// Durable crash log — survives even if nobody is watching the terminal or DevTools
// at the moment something goes wrong. Lives outside the app bundle so it's easy to
// find and share after a crash.
const crashLogPath = join(app.getPath('userData'), 'crash.log')
function logCrash(label: string, details: unknown): void {
  const line = `[${new Date().toISOString()}] ${label}: ${
    details instanceof Error ? (details.stack ?? details.message) : JSON.stringify(details)
  }\n`
  console.error(line)
  try { appendFileSync(crashLogPath, line) } catch { /* best effort */ }
}

process.on('uncaughtException', (err) => logCrash('main uncaughtException', err))
process.on('unhandledRejection', (reason) => logCrash('main unhandledRejection', reason))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
    if (is.dev) win.webContents.openDevTools({ mode: 'detach' })
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    logCrash('render-process-gone', details)
  })

  win.webContents.on('unresponsive', () => {
    logCrash('renderer unresponsive', { note: 'window stopped responding (possible long synchronous main-thread work)' })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('child-process-gone', (_event, details) => {
  logCrash('child-process-gone', details)
})

app.whenReady().then(() => {
  console.log(`[cllg-desktop] crash log: ${crashLogPath}`)
  registerProjectHandlers()
  registerPDFHandlers()
  registerOCRHandlers()
  registerTEIHandlers()
  registerKrakenHandlers()
  registerProjectExportHandlers()
  registerAltoHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
