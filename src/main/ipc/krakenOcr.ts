import { ipcMain, app, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join, isAbsolute } from 'path'
import { readFile, writeFile, appendFile, unlink } from 'fs/promises'
import { mkdirSync, existsSync } from 'fs'
import { availableParallelism } from 'os'
import type {
  Page, KrakenConfig, LineGeometry, OCRProgressEvent, DocumentType, KrakenStep, KrakenStepResult, PageZone, ZoneAction,
} from '@shared/types'
import { persistPageStatus, persistPageGeometry, persistPageZones } from '../pageStatus'
import { krakenLinesToPageMarkdown, regionLinesToPageMarkdown } from '../krakenMarkdown'
import { assignLinesToRegions, regionsToZones, suppressOverlappingRegions, type DetectedRegion } from '../regionMerge'
import { applyLineStep, applyTextStep, applyZoneStep, reassignZoneLines, type ProcessedLine } from '../krakenSteps'
import { findAnchors } from '@shared/lbAnchors'
import { migratePageZones, writeAllZoneTags } from '@shared/zones'
import { rebuildCombinedMarkdown } from './pdf'
import { loadSettings, updateSettings } from '../settings'
import sharp from 'sharp'

const BUILTIN_SEG = 'segmentation.js_mlmodel'
const BUILTIN_REC = 'ppocr_v6_tau090.js_mlmodel'
// D-FINE layout (region) models, one per document type: CLLG's own model for Greek
// editions, the LADaS nano model for Latin documents.
const BUILTIN_REGION: Record<DocumentType, string> = {
  cllg: 'dfine_cllg.js_mlmodel',
  ladas: 'dfine_ladas.js_mlmodel',
}

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

// ONNX Runtime's memory-pattern optimisation replans a session's allocations as one
// large block after the first run of a given input shape. In Electron's main process
// that allocation aborts the whole app (SIGTRAP, nothing logged) on the *second*
// inference once the input is big enough — reproduced with the Kraken segmenter on
// 1800×1643 inputs (tall ScanTailor pages) and all-zero tensors, while 1800×1272
// (typical PDF pages) never triggers it. Turning it off costs nothing measurable.
const SESSION_OPTIONS = { enableMemPattern: false }

async function krakenThreads(): Promise<number> {
  const n = (await loadSettings()).krakenThreads
  return Number.isInteger(n) && n! >= 1 ? Math.min(n!, MAX_THREADS) : DEFAULT_THREADS
}

type RegionSegmenterT = {
  segment: (img: string | Buffer) => Promise<{ regions: DetectedRegion[] }>
}

// Same promise-caching scheme as cachedPipeline. The D-FINE model is a separate ONNX
// session from the pipeline's, run on the whole page image only (never on crops).
let cachedRegionSegmenter: { path: string; threads: number; promise: Promise<RegionSegmenterT> } | null = null

async function getRegionSegmenter(modelPath: string): Promise<RegionSegmenterT> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DFineSegmenter } = require('kraken-js') as {
    DFineSegmenter: {
      create: (p: string, opts?: { threads?: number; allowSpinning?: boolean; sessionOptions?: object }) => Promise<RegionSegmenterT>
    }
  }
  const threads = await krakenThreads()
  if (!cachedRegionSegmenter || cachedRegionSegmenter.path !== modelPath || cachedRegionSegmenter.threads !== threads) {
    const entry = {
      path: modelPath,
      threads,
      promise: DFineSegmenter.create(modelPath, { threads, allowSpinning: false, sessionOptions: SESSION_OPTIONS }),
    }
    entry.promise.catch(() => {
      if (cachedRegionSegmenter === entry) cachedRegionSegmenter = null
    })
    cachedRegionSegmenter = entry
  }
  return cachedRegionSegmenter.promise
}

async function getPipeline(segModelPath: string, recModelPath: string): Promise<KrakenPipelineT> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KrakenPipeline } = require('kraken-js') as {
    KrakenPipeline: {
      create: (
        s: string,
        r: string,
        opts?: {
          threads?: number
          allowSpinning?: boolean
          segmenter?: { sessionOptions?: object }
          recognizer?: { sessionOptions?: object }
        }
      ) => Promise<KrakenPipelineT>
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
      promise: KrakenPipeline.create(segModelPath, recModelPath, {
        threads,
        allowSpinning: false,
        segmenter: { sessionOptions: SESSION_OPTIONS },
        recognizer: { sessionOptions: SESSION_OPTIONS },
      }),
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

const regionClassCache = new Map<string, string[]>()

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

  // The region types a D-FINE model detects, from its metadata.json (class_mapping.regions).
  // Only that entry of the .js_mlmodel zip is read: no ONNX session is created.
  ipcMain.handle('kraken:regionClasses', async (_event, modelPath: string): Promise<string[]> => {
    const cached = regionClassCache.get(modelPath)
    if (cached) return cached
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require('adm-zip') as new (p: string) => { getEntry: (n: string) => unknown; readAsText: (e: unknown) => string }
    const zip = new AdmZip(modelPath)
    const entry = zip.getEntry('metadata.json')
    if (!entry) throw new Error(`${modelPath}: missing metadata.json`)
    const meta = JSON.parse(zip.readAsText(entry)) as { class_mapping?: { regions?: Record<string, number> } }
    const classes = Object.entries(meta.class_mapping?.regions ?? {})
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name)
    regionClassCache.set(modelPath, classes)
    return classes
  })

  ipcMain.handle('kraken:getBuiltinPaths', () => ({
    segModelPath: join(modelsDir(), BUILTIN_SEG),
    recModelPath: join(modelsDir(), BUILTIN_REC),
    regionModelPaths: {
      cllg: join(modelsDir(), BUILTIN_REGION.cllg),
      ladas: join(modelsDir(), BUILTIN_REGION.ladas),
    },
  }))

  ipcMain.handle(
    'dialog:selectKrakenModel',
    async (_event, kind: 'segmentation' | 'recognition' | 'region'): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        title: {
          segmentation: 'Select segmentation model',
          recognition: 'Select recognition model',
          region: 'Select region (layout) model',
        }[kind],
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

  // Run only some Kraken steps (zone / line / text) on already-OCRed pages, or rebuild
  // them from scratch ('all'), whatever their status. Resolves with one result per page
  // processed.
  ipcMain.handle(
    'kraken:run-steps',
    async (
      event,
      projectDir: string,
      pages: Page[],
      krakenConfig: KrakenConfig,
      steps: KrakenStep[] | 'all'
    ): Promise<KrakenStepResult[]> => {
      await runningLoop
      abortKraken = false
      const results: KrakenStepResult[] = []
      const loop = runKrakenStepsLoop(event, projectDir, pages, krakenConfig, steps, results, () => abortKraken)
      runningLoop = loop.finally(() => {
        if (runningLoop === loop) runningLoop = null
      })
      await runningLoop
      return results
    }
  )
}

// A page's layout regions, without the duplicates D-FINE reports for one zone.
async function detectRegions(segmenter: RegionSegmenterT, imgPath: string): Promise<DetectedRegion[]> {
  const { regions } = await segmenter.segment(imgPath)
  return suppressOverlappingRegions(regions)
}

const cachePathFor = (projectDir: string, n: number): string =>
  join(projectDir, 'pages', `page_${String(n).padStart(4, '0')}.md`)

function pageImagePath(projectDir: string, page: Page): string {
  const resolve = (p: string): string => (isAbsolute(p) ? p : join(projectDir, p))
  return page.maskedImagePath ? resolve(page.maskedImagePath) : resolve(page.imagePath)
}

/**
 * OCR one page from scratch — segmentation, recognition and, with a region model,
 * layout zones — and return its markdown. Persists the page's geometry (replacing
 * earlier Kraken geometry, never ALTO) and zones; hand-drawn zones are kept, their
 * lines recomputed and their tags written into the new markdown.
 */
async function ocrPageFull(
  projectDir: string,
  page: Page,
  imgPath: string,
  pipeline: KrakenPipelineT,
  regionSegmenter: RegionSegmenterT | null,
  documentType: DocumentType,
  policy?: Record<string, ZoneAction>
): Promise<string> {
  const raw = await pipeline.process(imgPath)
  let lines = raw.map((l, i) => ({ text: l.text, id: `k${i}`, regionType: l.type, polygon: l.polygon, blockId: undefined as string | undefined }))
  let detected: PageZone[] = []
  if (regionSegmenter) {
    const regions = await detectRegions(regionSegmenter, imgPath)
    lines = assignLinesToRegions(lines, regions)
    detected = regionsToZones(regions, lines, policy)
  }
  // `polygon` is the same expanded above/below-baseline quadrilateral kraken-js
  // actually cropped for recognition (see pipeline.js), so persisted geometry can't
  // drift from what was recognized.
  const newGeometry: LineGeometry[] = lines.map((l) => ({
    id: l.id,
    polygon: l.polygon,
    regionType: l.regionType,
    ...(l.blockId ? { blockId: l.blockId } : {}),
    source: 'kraken',
    text: l.text,
  }))
  await persistPageGeometry(projectDir, page.n, newGeometry, { replace: true })

  let pageMarkdown = regionSegmenter
    ? regionLinesToPageMarkdown(page.n, lines, documentType, policy)
    : krakenLinesToPageMarkdown(page.n, lines)

  const manual = (migratePageZones(page).zones ?? []).filter((z) => z.source === 'manual')
  const zones = [...detected, ...reassignZoneLines(manual, newGeometry)]
  if (manual.length) pageMarkdown = writeAllZoneTags(pageMarkdown, zones).markdown
  if (zones.length || page.zones?.length || page.manualZones?.length) await persistPageZones(projectDir, page.n, zones)
  return pageMarkdown
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
  const regionSegmenter = krakenConfig.regionModelPath ? await getRegionSegmenter(krakenConfig.regionModelPath) : null
  const documentType: DocumentType = krakenConfig.documentType ?? 'cllg'

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

    const imgPath = pageImagePath(projectDir, page)

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
      const pageMarkdown = await ocrPageFull(projectDir, page, imgPath, pipeline, regionSegmenter, documentType, krakenConfig.zonePolicy)
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

async function runKrakenStepsLoop(
  event: IpcMainInvokeEvent,
  projectDir: string,
  pages: Page[],
  krakenConfig: KrakenConfig,
  steps: KrakenStep[] | 'all',
  results: KrakenStepResult[],
  isAborted: () => boolean
): Promise<void> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const send = (e: OCRProgressEvent): void => { win?.webContents.send('ocr:progress', e) }
  mkdirSync(join(projectDir, 'pages'), { recursive: true })

  const wants = (s: KrakenStep): boolean => steps === 'all' || steps.includes(s)
  if (steps !== 'all' && wants('zone') && !krakenConfig.regionModelPath) {
    throw new Error('The zone step needs a region (layout) model')
  }
  const needsPipeline = wants('line') || wants('text')
  const pipeline = needsPipeline ? await getPipeline(krakenConfig.segModelPath, krakenConfig.recModelPath) : null
  const regionSegmenter =
    wants('zone') && krakenConfig.regionModelPath ? await getRegionSegmenter(krakenConfig.regionModelPath) : null
  const documentType: DocumentType = krakenConfig.documentType ?? 'cllg'

  try {
    for (const page of pages) {
      if (isAborted()) break
      if (page.status === 'skipped') {
        send({ pageNum: page.n, status: 'skipped' })
        continue
      }
      const imgPath = pageImagePath(projectDir, page)
      if (!existsSync(imgPath)) {
        send({ pageNum: page.n, status: 'error', errorMessage: `Image not found: ${imgPath}` })
        continue
      }
      send({ pageNum: page.n, status: 'started' })
      const t0 = Date.now()
      const cachePath = cachePathFor(projectDir, page.n)
      const result: KrakenStepResult = { pageNum: page.n, zones: 0, newLines: 0, orphanLines: 0, textLines: 0, unwrappedZones: [] }
      try {
        let summary: string
        if (steps === 'all' || !existsSync(cachePath)) {
          // Nothing to keep: the page is (re)built from scratch, as a first run does.
          const full = pipeline ?? (await getPipeline(krakenConfig.segModelPath, krakenConfig.recModelPath))
          const regions = regionSegmenter ?? (krakenConfig.regionModelPath ? await getRegionSegmenter(krakenConfig.regionModelPath) : null)
          const pageMarkdown = await ocrPageFull(projectDir, page, imgPath, full, regions, documentType, krakenConfig.zonePolicy)
          await writeFile(cachePath, pageMarkdown, 'utf-8')
          const origPath = join(projectDir, 'pages', `page_${String(page.n).padStart(4, '0')}.orig.md`)
          if (!existsSync(origPath)) await writeFile(origPath, pageMarkdown, 'utf-8')
          summary = 'rebuilt from scratch'
        } else {
          let md = await readFile(cachePath, 'utf-8')
          let geometry = page.lineGeometry ?? []
          let zones = migratePageZones(page).zones ?? []
          const parts: string[] = []

          let processed: ProcessedLine[] = []
          if (pipeline) {
            processed = (await pipeline.process(imgPath)).map((l) => ({ text: l.text, polygon: l.polygon, type: l.type }))
          }
          if (wants('line')) {
            if (!geometry.length && !findAnchors(md).length) {
              throw new Error('This page has no line anchors to keep its text on: run all steps instead')
            }
            const r = applyLineStep(md, geometry, processed, zones)
            md = r.markdown
            geometry = r.geometry
            zones = r.zones
            result.newLines = r.newLines
            result.orphanLines = r.orphanLines
            result.unwrappedZones = r.unwrapped
            parts.push(`${geometry.length} lines (${r.newLines} new, ${r.orphanLines} orphaned)`)
          }
          if (wants('zone') && regionSegmenter) {
            const regions = await detectRegions(regionSegmenter, imgPath)
            const r = applyZoneStep(md, geometry, regions, zones, krakenConfig.zonePolicy)
            md = r.markdown
            geometry = r.geometry
            zones = r.zones
            result.unwrappedZones = r.unwrapped
            parts.push(`${regions.length} zones` + (r.unwrapped.length ? ` (${r.unwrapped.length} not wrapped)` : ''))
          }
          if (wants('text')) {
            const r = applyTextStep(md, geometry, processed)
            md = r.markdown
            result.textLines = r.textLines
            parts.push(`${r.textLines} lines re-read` + (r.unmatched ? `, ${r.unmatched} unmatched` : ''))
          }

          await writeFile(cachePath, md, 'utf-8')
          if (wants('line') || wants('zone')) await persistPageGeometry(projectDir, page.n, geometry, { replace: true })
          await persistPageZones(projectDir, page.n, zones)
          result.zones = zones.length
          summary = parts.join(' · ')
        }
        const elapsedMs = Date.now() - t0
        await persistPageStatus(projectDir, page.n, 'ocr_done', { elapsedMs })
        results.push(result)
        send({ pageNum: page.n, status: 'done', elapsedMs, logMessage: summary })
      } catch (err: unknown) {
        send({ pageNum: page.n, status: 'error', elapsedMs: Date.now() - t0, errorMessage: String(err) })
      }
    }
  } finally {
    await rebuildCombinedMarkdown(projectDir).catch(() => { /* no pages dir yet */ })
  }
}
