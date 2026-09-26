import { ipcMain, app, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join, isAbsolute } from 'path'
import { readFile, writeFile, appendFile, unlink } from 'fs/promises'
import { mkdirSync, existsSync } from 'fs'
import { availableParallelism } from 'os'
import type { Page, KrakenConfig, LineGeometry, OCRProgressEvent } from '@shared/types'
import { persistPageStatus, persistPageGeometry } from '../pageStatus'
import { krakenLinesToPageMarkdown } from '../krakenMarkdown'
import { loadSettings, updateSettings } from '../settings'
import sharp from 'sharp'

const BUILTIN_SEG = 'segmentation.js_mlmodel'
const BUILTIN_REC = 'ppocr_v6_tau090.js_mlmodel'

function modelsDir(): string {
  return is.dev
    ? join(app.getAppPath(), 'resources', 'models')
    : join(process.resourcesPath, 'models')
}

type Obb = { cx: number; cy: number; w: number; h: number; angle: number; corners: [number, number][] }
type KrakenPipelineT = {
  process: (img: string | Buffer) => Promise<{ text: string; obb: Obb; polygon: [number, number][]; type: string }[]>
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
let cachedPipeline: { segPath: string; recPath: string; threads: number; promise: Promise<KrakenPipelineT> } | null = null

// CPU limits for the ONNX sessions. kraken-js otherwise uses ONNX Runtime's defaults —
// one thread per physical core, busy-waiting between inferences — which kept every core
// at 100% for the whole run. Measured on a 35-line page (24 logical cores): 4 threads
// with spinning off take ~5.0 s with ~3 cores busy, vs ~4.4 s with ~20 by default.
// The default can be raised or lowered per machine in the OCR page (settings.json,
// `krakenThreads`), up to every logical core.
const MAX_THREADS = availableParallelism()
const DEFAULT_THREADS = Math.max(1, Math.min(4, Math.floor(MAX_THREADS / 2)))

async function krakenThreads(): Promise<number> {
  const n = (await loadSettings()).krakenThreads
  return Number.isInteger(n) && n! >= 1 ? Math.min(n!, MAX_THREADS) : DEFAULT_THREADS
}

async function getPipeline(segModelPath: string, recModelPath: string): Promise<KrakenPipelineT> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KrakenPipeline } = require('kraken-js') as {
    KrakenPipeline: {
      create: (s: string, r: string, opts?: { threads?: number; allowSpinning?: boolean }) => Promise<KrakenPipelineT>
    }
  }
  const threads = await krakenThreads()
  // A changed thread setting rebuilds the sessions on the next page/run; a run already
  // in progress keeps the pipeline it started with.
  if (
    !cachedPipeline ||
    cachedPipeline.segPath !== segModelPath ||
    cachedPipeline.recPath !== recModelPath ||
    cachedPipeline.threads !== threads
  ) {
    const entry: { segPath: string; recPath: string; threads: number; promise: Promise<KrakenPipelineT> } = {
      segPath: segModelPath,
      recPath: recModelPath,
      threads,
      promise: KrakenPipeline.create(segModelPath, recModelPath, { threads, allowSpinning: false }),
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
  ipcMain.handle('kraken:getThreads', async () => ({
    threads: await krakenThreads(),
    isDefault: (await loadSettings()).krakenThreads === undefined,
    defaultThreads: DEFAULT_THREADS,
    maxThreads: MAX_THREADS,
  }))

  // n = null resets to the automatic default.
  ipcMain.handle('kraken:setThreads', async (_event, n: number | null) => {
    if (n !== null && (!Number.isInteger(n) || n < 1)) throw new Error(`Invalid thread count: ${n}`)
    await updateSettings({ krakenThreads: n === null ? undefined : Math.min(n, MAX_THREADS) })
    return krakenThreads()
  })

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

  // Re-OCR a single line. Recognizing a bare line crop is exactly the pattern that
  // crashed the app (see the comment on cachedPipeline), so this stays on the proven
  // full-page path: a page-sized white image holding only the line's region, at its
  // original position and scale, run through pipeline.process(). The segmenter sees the
  // line as it looks on the page — and nothing else.
  ipcMain.handle(
    'kraken:ocr-line',
    async (
      _event,
      imagePath: string,
      polygon: [number, number][],
      segModelPath: string,
      recModelPath: string
    ): Promise<{ text: string; lineCount: number }> => {
      const meta = await sharp(imagePath).metadata()
      const W = meta.width ?? 0
      const H = meta.height ?? 0
      if (!W || !H) throw new Error('Cannot read page image size')
      const xs = polygon.map(([x]) => x)
      const ys = polygon.map(([, y]) => y)
      const pad = 4
      const left = Math.max(0, Math.floor(Math.min(...xs)) - pad)
      const top = Math.max(0, Math.floor(Math.min(...ys)) - pad)
      const right = Math.min(W, Math.ceil(Math.max(...xs)) + pad)
      const bottom = Math.min(H, Math.ceil(Math.max(...ys)) + pad)
      if (right - left < 2 || bottom - top < 2) throw new Error('Line region is empty')

      const region = await sharp(imagePath)
        .extract({ left, top, width: right - left, height: bottom - top })
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer()
      const isolated = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
        .composite([{ input: region, left, top }])
        .png()
        .toBuffer()

      const pipeline = await getPipeline(segModelPath, recModelPath)
      const found = (await pipeline.process(isolated)).filter((l) => l.text.trim())
      if (found.length === 0) return { text: '', lineCount: 0 }
      // A box drawn with some margin can catch the edge of a neighbouring line, which the
      // segmenter then also reports. Keep the line whose baseline sits where a line's
      // baseline belongs in its box — ~70% of the way down, as in Kraken's own line boxes
      // (0.85 line height above the baseline, 0.35 below) — and report how many were seen.
      const target = top + 0.7 * (bottom - top)
      const best = found.reduce((a, b) => (Math.abs(b.obb.cy - target) < Math.abs(a.obb.cy - target) ? b : a))
      return { text: best.text.trim(), lineCount: found.length }
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
