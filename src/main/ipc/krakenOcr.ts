import { ipcMain, app, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join, isAbsolute } from 'path'
import { readFile, writeFile, appendFile, unlink } from 'fs/promises'
import { mkdirSync, existsSync } from 'fs'
import type { Page, KrakenConfig, LineGeometry, OCRProgressEvent } from '@shared/types'
import { persistPageStatus, persistPageGeometry } from '../pageStatus'
import { krakenLinesToPageMarkdown } from '../krakenMarkdown'

const BUILTIN_SEG = 'segmentation.js_mlmodel'
const BUILTIN_REC = 'ppocr_v6_tau090.js_mlmodel'

function modelsDir(): string {
  return is.dev
    ? join(app.getAppPath(), 'resources', 'models')
    : join(process.resourcesPath, 'models')
}

type Obb = { cx: number; cy: number; w: number; h: number; angle: number; corners: [number, number][] }
type KrakenPipelineT = {
  process: (img: string) => Promise<{ text: string; obb: Obb; polygon: [number, number][]; type: string }[]>
}

// Cache the pipeline *promise*, not the resolved value — two concurrent callers
// (kraken:run and kraken:rerun-page, or a re-run right after kraken:stop) must see
// the same in-flight create() rather than each awaiting a stale null cache and
// building their own ONNX sessions, with the first set silently dropped while its
// runs may still be in flight.
//
// IMPORTANT: only ever create a Kraken segmenter/recognizer via KrakenPipeline.create()
// (which creates both together) and only ever recognize through pipeline.process()
// (full page: segment + recognize). Every alternative tried — a standalone
// KrakenRecognizer created on its own, cropping lines from stored geometry and
// recognizing them individually via a bare or reused recognizer, running the native
// module in an Electron utilityProcess, running it in a child_process forked with
// ELECTRON_RUN_AS_NODE — crashed the app (a native abort/segfault, not a catchable JS
// error) at least once during testing. pipeline.process() in the real Electron main
// process is the only pattern with solid, repeated proof of stability, so that's the
// only pattern used here, even though it means every Kraken recognition re-segments
// the page (no "skip segmentation, reuse existing geometry" shortcut). Geometry is
// still persisted (see persistPageGeometry below) for other uses — archival, future
// LADaS/zone tooling, exports — just not to skip segmentation on a later pass.
let cachedPipeline: { segPath: string; recPath: string; promise: Promise<KrakenPipelineT> } | null = null

async function getPipeline(segModelPath: string, recModelPath: string): Promise<KrakenPipelineT> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KrakenPipeline } = require('kraken-js') as {
    KrakenPipeline: { create: (s: string, r: string) => Promise<KrakenPipelineT> }
  }
  if (!cachedPipeline || cachedPipeline.segPath !== segModelPath || cachedPipeline.recPath !== recModelPath) {
    const entry: { segPath: string; recPath: string; promise: Promise<KrakenPipelineT> } = {
      segPath: segModelPath,
      recPath: recModelPath,
      promise: KrakenPipeline.create(segModelPath, recModelPath),
    }
    // A failed create() (bad model path, etc.) must not poison the cache for later
    // retries with the same paths.
    entry.promise.catch(() => {
      if (cachedPipeline === entry) cachedPipeline = null
    })
    cachedPipeline = entry
  }
  return cachedPipeline.promise
}

export function registerKrakenHandlers(): void {
  ipcMain.handle('kraken:getBuiltinPaths', () => ({
    segModelPath: join(modelsDir(), BUILTIN_SEG),
    recModelPath: join(modelsDir(), BUILTIN_REC),
  }))

  ipcMain.handle(
    'dialog:selectKrakenModel',
    async (_event, kind: 'segmentation' | 'recognition'): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        title: kind === 'segmentation' ? 'Select segmentation model' : 'Select recognition model',
        filters: [{ name: 'Kraken model', extensions: ['js_mlmodel'] }],
        properties: ['openFile'],
      })
      return result.canceled ? null : result.filePaths[0]
    }
  )

  ipcMain.handle(
    'kraken:rerun-page',
    async (
      _event,
      imagePath: string,
      segModelPath: string,
      recModelPath: string
    ): Promise<{ text: string; lines: { text: string; corners: [number, number][] }[] }> => {
      const pipeline = await getPipeline(segModelPath, recModelPath)
      const rawLines = await pipeline.process(imagePath)
      const lines = rawLines.map((l) => ({ text: l.text, corners: l.obb.corners }))
      const text = lines.map((l) => l.text).join('\n')
      return { text, lines }
    }
  )

  let abortKraken = false
  // The currently in-flight kraken:run loop, if any. kraken:stop awaits this so the
  // loop has actually exited before returning, and kraken:run awaits any previous
  // loop before starting a new one — otherwise a stop immediately followed by a
  // rerun could leave two loops appending to the same ocr_output.md concurrently.
  let runningLoop: Promise<void> | null = null

  ipcMain.handle('kraken:stop', async () => {
    abortKraken = true
    await runningLoop
  })

  ipcMain.handle(
    'kraken:run',
    async (event, projectDir: string, pages: Page[], krakenConfig: KrakenConfig): Promise<void> => {
      await runningLoop
      abortKraken = false
      const loop = runKrakenLoop(event, projectDir, pages, krakenConfig, () => abortKraken)
      runningLoop = loop.finally(() => {
        if (runningLoop === loop) runningLoop = null
      })
      return runningLoop
    }
  )
}

async function runKrakenLoop(
  event: IpcMainInvokeEvent,
  projectDir: string,
  pages: Page[],
  krakenConfig: KrakenConfig,
  isAborted: () => boolean
): Promise<void> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const mdPath = join(projectDir, 'ocr_output.md')
  const cacheDir = join(projectDir, 'pages')
  mkdirSync(cacheDir, { recursive: true })

  const pipeline = await getPipeline(krakenConfig.segModelPath, krakenConfig.recModelPath)

  for (const page of pages) {
    if (isAborted()) break
    if (page.status === 'skipped') {
      win?.webContents.send('ocr:progress', { pageNum: page.n, status: 'skipped' } satisfies OCRProgressEvent)
      continue
    }

    const cachePath = join(cacheDir, `page_${String(page.n).padStart(4, '0')}.md`)
    if (existsSync(cachePath)) {
      if (page.status === 'ocr_done') {
        const cached = await readFile(cachePath, 'utf-8')
        await appendFile(mdPath, cached, 'utf-8')
        win?.webContents.send('ocr:progress', { pageNum: page.n, status: 'done', fromCache: true } satisfies OCRProgressEvent)
        continue
      } else {
        try { await unlink(cachePath) } catch { /* ignore */ }
      }
    }

    const resolve = (p: string): string => (isAbsolute(p) ? p : join(projectDir, p))
    const imgPath = page.maskedImagePath ? resolve(page.maskedImagePath) : resolve(page.imagePath)

    if (!existsSync(imgPath)) {
      win?.webContents.send('ocr:progress', {
        pageNum: page.n,
        status: 'error',
        errorMessage: `Image not found: ${imgPath}`,
      } satisfies OCRProgressEvent)
      continue
    }

    win?.webContents.send('ocr:progress', { pageNum: page.n, status: 'started' } satisfies OCRProgressEvent)
    const t0 = Date.now()
    try {
      const raw = await pipeline.process(imgPath)
      const lines = raw.map((l, i) => ({ text: l.text, id: `k${i}`, regionType: l.type }))
      if (!page.lineGeometry?.length) {
        // `polygon` is the same expanded above/below-baseline quadrilateral
        // kraken-js actually cropped for recognition (see pipeline.js), so
        // persisted geometry can't drift from what was recognized.
        const newGeometry: LineGeometry[] = raw.map((l, i) => ({
          id: `k${i}`,
          polygon: l.polygon,
          regionType: l.type,
          source: 'kraken',
          text: l.text,
        }))
        await persistPageGeometry(projectDir, page.n, newGeometry)
      }

      const pageMarkdown = krakenLinesToPageMarkdown(page.n, lines)
      await writeFile(cachePath, pageMarkdown, 'utf-8')
      await appendFile(mdPath, pageMarkdown, 'utf-8')

      // Archive the first successful machine transcription, write-once — a later
      // re-OCR or hand-correction of the editable cache above never touches this,
      // so it stays available for training-corpus exports (Sequence 6).
      const origPath = join(cacheDir, `page_${String(page.n).padStart(4, '0')}.orig.md`)
      if (!existsSync(origPath)) await writeFile(origPath, pageMarkdown, 'utf-8')
      const elapsedMs = Date.now() - t0
      await persistPageStatus(projectDir, page.n, 'ocr_done', { elapsedMs })
      win?.webContents.send('ocr:progress', { pageNum: page.n, status: 'done', elapsedMs } satisfies OCRProgressEvent)
    } catch (err: unknown) {
      await persistPageStatus(projectDir, page.n, 'error')
      win?.webContents.send('ocr:progress', {
        pageNum: page.n,
        status: 'error',
        elapsedMs: Date.now() - t0,
        errorMessage: String(err),
      } satisfies OCRProgressEvent)
    }
  }
}
