import { ipcMain, app, dialog, BrowserWindow } from 'electron'
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
  process: (img: string) => Promise<{ text: string; obb: Obb; type: string }[]>
}

// Kraken's raw OBB is just the ~1-2px baseline strip (see kraken-js's own README:
// "the model predicts thin baselines ... obb.h reflects the baseline width, not the
// full text height"). KrakenPipeline expands this internally before cropping for
// recognition, using the inter-line spacing on the page — this reproduces that same
// expansion so persisted/displayed line geometry actually covers the visual line
// instead of a barely-visible sliver. Mirrors kraken-js's pipeline.js estimateLineHeight
// + extractLineCrop corner math.
function estimateLineHeight(lines: { obb: Obb }[]): number {
  if (lines.length < 2) return 20
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].obb.cy - lines[i - 1].obb.cy
    if (g > 2) gaps.push(g)
  }
  if (!gaps.length) return 20
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

function expandedLinePolygon(obb: Obb, lineHeight: number): [number, number][] {
  const { cx, cy, angle, w } = obb
  const upRatio = 0.85, downRatio = 0.35 // baseline-at-bottom convention (topline: false)
  const expandUp = lineHeight * upRatio
  const expandDown = lineHeight * downRatio
  const cosA = Math.cos(angle), sinA = Math.sin(angle)
  const vx = sinA, vy = -cosA // perpendicular "above baseline" direction
  const hw = w / 2
  return [
    [cx - hw * cosA + expandUp * vx, cy - hw * sinA + expandUp * vy],
    [cx + hw * cosA + expandUp * vx, cy + hw * sinA + expandUp * vy],
    [cx + hw * cosA - expandDown * vx, cy + hw * sinA - expandDown * vy],
    [cx - hw * cosA - expandDown * vx, cy - hw * sinA - expandDown * vy],
  ]
}

// Cache the pipeline so ONNX models are not reloaded on every call.
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
let cachedPipeline: { segPath: string; recPath: string; pipeline: KrakenPipelineT } | null = null

async function getPipeline(segModelPath: string, recModelPath: string): Promise<KrakenPipelineT> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KrakenPipeline } = require('kraken-js') as {
    KrakenPipeline: { create: (s: string, r: string) => Promise<KrakenPipelineT> }
  }
  if (!cachedPipeline || cachedPipeline.segPath !== segModelPath || cachedPipeline.recPath !== recModelPath) {
    cachedPipeline = {
      segPath: segModelPath,
      recPath: recModelPath,
      pipeline: await KrakenPipeline.create(segModelPath, recModelPath),
    }
  }
  return cachedPipeline.pipeline
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

  ipcMain.handle('kraken:stop', async () => {
    abortKraken = true
  })

  ipcMain.handle(
    'kraken:run',
    async (event, projectDir: string, pages: Page[], krakenConfig: KrakenConfig): Promise<void> => {
      abortKraken = false
      const win = BrowserWindow.fromWebContents(event.sender)
      const mdPath = join(projectDir, 'ocr_output.md')
      const cacheDir = join(projectDir, 'pages')
      mkdirSync(cacheDir, { recursive: true })

      const pipeline = await getPipeline(krakenConfig.segModelPath, krakenConfig.recModelPath)

      for (const page of pages) {
        if (abortKraken) break
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
            const lineHeight = estimateLineHeight(raw)
            const newGeometry: LineGeometry[] = raw.map((l, i) => ({
              id: `k${i}`,
              polygon: expandedLinePolygon(l.obb, lineHeight),
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
  )
}
