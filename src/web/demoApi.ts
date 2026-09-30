/**
 * Browser implementation of `window.api` for the web demo (GitHub Pages).
 *
 * The renderer only talks to the main process through `window.api`, so the web demo
 * is the unmodified renderer with this module in place of the preload bridge. It works
 * on the tour's demo project, in memory:
 *   - page markdown, masks and zones are kept in memory (nothing is written anywhere);
 *   - TEI generation and the per-page exports run for real (md2tei & co. are pure TS),
 *     and "saving" a file downloads it;
 *   - Kraken OCR "runs" replay the precomputed output of the demo pages;
 *   - everything that needs the file system, the Kraken models or LM Studio emits a
 *     "desktop only" notice (shown by DemoChrome) and does nothing.
 */
import type { ElectronAPI } from '../preload'
import type {
  Project,
  Page,
  OCRProgressEvent,
  ModelStatus,
  ModelDownloadEvent,
  DocumentType,
} from '@shared/types'
import { runMd2Tei, scanRefs } from '../main/ipc/md2tei'
import { effectiveZones } from '../main/ladas'
import { buildAltoXml } from '../main/altoExport'
import { stripPseudoTags, zonesToPseudoTaggedText } from '../main/pageExportFormats'
import { buildTourDemoProject } from '../renderer/src/data/tourDemoProject'
import modelManifest from '../../resources/models.json'

// ── Notices shown by DemoChrome ──────────────────────────────────────────────

export const DEMO_NOTICE_EVENT = 'cllg-demo:notice'
export type DemoNotice = 'desktopOnly' | 'ocrReplay' | 'downloaded'

function notice(kind: DemoNotice, detail?: string): void {
  window.dispatchEvent(new CustomEvent(DEMO_NOTICE_EVENT, { detail: { kind, detail } }))
}

class DesktopOnlyError extends Error {
  constructor() {
    super('Available in the desktop app only — this web demo cannot run OCR.')
  }
}

function desktopOnly(): void {
  notice('desktopOnly')
}

// ── In-memory project state ─────────────────────────────────────────────────

let demoProject: Promise<Project> | null = null
let current: Project | null = null
/** Page markdown edited in Review, by page number (else the demo's own markdown). */
const markdown = new Map<number, string>()

async function project(): Promise<Project> {
  if (current) return current
  demoProject ??= buildTourDemoProject()
  return demoProject
}

function withTrailingNewline(content: string): string {
  return content.length === 0 || content.endsWith('\n') ? content : content + '\n'
}

function pageMarkdown(page: Page): string {
  return markdown.get(page.n) ?? page.markdown ?? ''
}

/** Equivalent of ocr_output.md: every page's markdown, in page order. */
async function combinedMarkdown(): Promise<string> {
  const pages = [...(await project()).pages].sort((a, b) => a.n - b.n)
  return pages.map((p) => withTrailingNewline(pageMarkdown(p))).join('')
}

function exportPage(page: Page, format: Parameters<ElectronAPI['exportPageFormat']>[2]): string {
  const md = pageMarkdown(page)
  switch (format) {
    case 'plain':
      return stripPseudoTags(md)
    case 'pretei':
      return md
    case 'plain-ladas':
      return zonesToPseudoTaggedText(
        effectiveZones((page.lineGeometry ?? []).map((l) => ({ ...l, text: l.text ?? '' })), page.zones ?? [])
      )
    case 'alto':
      return buildAltoXml(page, md)
  }
}

// ── Events (main → renderer in the desktop app) ─────────────────────────────

function emitter<A extends unknown[]>(): {
  on: (cb: (...args: A) => void) => () => void
  emit: (...args: A) => void
} {
  const listeners = new Set<(...args: A) => void>()
  return {
    on: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    emit: (...args) => listeners.forEach((cb) => cb(...args)),
  }
}

const ocrProgress = emitter<[OCRProgressEvent]>()
const teiLog = emitter<[string]>()
const pdfProgress = emitter<[number, number]>()
const modelDownload = emitter<[ModelDownloadEvent]>()

// ── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function download(fileName: string, content: string): void {
  const type = /\.(xml|tei)$/i.test(fileName) ? 'application/xml' : 'text/plain'
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  notice('downloaded', fileName)
}

async function toDataUrl(data: ArrayBuffer): Promise<string> {
  const blob = new Blob([data], { type: 'image/png' })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const BUILTIN_PATHS = {
  segModelPath: 'segmentation.js_mlmodel',
  recModelPath: 'ppocr_v6_tau090.js_mlmodel',
  regionModelPaths: {
    cllg: 'dfine_cllg.js_mlmodel',
    ladas: 'dfine_ladas.js_mlmodel',
  } as Record<DocumentType, string>,
}

// Region classes of the built-in D-FINE models (their metadata.json class_mapping).
const REGION_CLASSES: Record<string, string[]> = {
  'dfine_cllg.js_mlmodel': [
    'MainZone-P', 'NumberingZone', 'RunningTitleZone', 'MainZone-Continued', 'MainZone-Head',
    'MarginTextZone', 'DropCapitalZone', 'GraphicZone', 'CustomZone-Noise',
  ],
  'dfine_ladas.js_mlmodel': [
    'MusicZone', 'StampZone', 'MainZone-Continued', 'MainZone-Lg', 'MainZone-Signature',
    'MarginTextZone-Notes', 'MainZone-Other', 'RunningTitleZone', 'DigitizationArtefactZone',
    'MainZone-Date', 'MainZone-P', 'NumberingZone', 'QuireMarksZone', 'MainZone-Sp',
    'TableZone-Head', 'GraphicZone', 'StampZone-Sticker', 'MainZone-Entry', 'FormZone',
    'MarginTextZone-ManuscriptAddendum', 'TitlePageZone', 'GraphicZone-Decoration',
    'GraphicZone-FigDesc', 'MainZone-Head', 'GraphicZone-Head', 'TitlePageZone-Index',
    'MainZone-ListItem', 'MarginTextZone-ContinuedNotes', 'TableZone', 'MainZone-Maths',
    'AdvertisementZone', 'GraphicZone-Part', 'DropCapitalZone', 'GraphicZone-TextualContent',
    'FigureZone-FigDesc', 'FigureZone', 'FigureZone-Head',
  ],
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

// ── The API ─────────────────────────────────────────────────────────────────

export const demoApi: ElectronAPI = {
  // Project
  newProject: async () => { desktopOnly(); throw new DesktopOnlyError() },
  openProject: async () => project(),
  saveProject: async (p) => { current = p },
  getRecentProjects: async () => [await project()],
  removeRecentProject: async () => {},

  // Import: no file system in the browser
  selectPDF: async () => { desktopOnly(); return null },
  selectDocument: async () => { desktopOnly(); return null },
  selectImageDir: async () => { desktopOnly(); return null },
  selectImages: async () => { desktopOnly(); return [] },
  listImagesInDir: async () => [],
  copyImageToProject: async () => { throw new DesktopOnlyError() },
  selectProjectDir: async () => { desktopOnly(); return null },

  // Images: a "saved" image is its own data URI, which the path helpers pass through.
  savePageImage: async (_dir, _n, data) => toDataUrl(data),
  saveMaskedImage: async (_dir, _n, data) => toDataUrl(data),
  loadImageAsDataUrl: async (path) => path,
  joinPaths: async (...parts) => {
    const last = parts[parts.length - 1]
    if (last.startsWith('data:') || /^(blob:|https?:)/.test(last)) return last
    return parts.filter(Boolean).join('/')
  },

  // OCR
  testLMStudio: async () => ({ ok: false, latencyMs: 0, error: 'LM Studio is only reachable from the desktop app' }),
  runOCR: async () => { desktopOnly() },
  stopOCR: async () => {},
  rerunPageLM: async () => { desktopOnly(); throw new DesktopOnlyError() },
  getKrakenBuiltinPaths: async () => BUILTIN_PATHS,
  rerunPageKraken: async () => { desktopOnly(); throw new DesktopOnlyError() },
  ocrLineKraken: async () => { desktopOnly(); throw new DesktopOnlyError() },
  selectKrakenModel: async () => { desktopOnly(); return null },

  // Replays the demo's precomputed output, page by page, as the real run reports it.
  runKraken: async (_dir, pages) => {
    notice('ocrReplay')
    for (const p of pages) {
      if (p.status === 'skipped') {
        ocrProgress.emit({ pageNum: p.n, status: 'skipped' })
        continue
      }
      ocrProgress.emit({ pageNum: p.n, status: 'started' })
      const elapsedMs = 900 + Math.round(Math.random() * 600)
      await sleep(elapsedMs)
      ocrProgress.emit({
        pageNum: p.n,
        status: 'done',
        elapsedMs,
        logMessage: `${p.lineGeometry?.length ?? 0} lines (demo: precomputed output)`,
      })
    }
  },

  getModelStatus: async (): Promise<ModelStatus[]> =>
    modelManifest.files.map((f) => ({ file: f.file, description: f.description, size: f.size, present: true })),
  downloadModels: async () => demoApi.getModelStatus(),
  cancelModelDownload: async () => {},
  onModelDownload: modelDownload.on,

  getRegionClasses: async (modelPath) => REGION_CLASSES[basename(modelPath)] ?? [],
  runKrakenSteps: async () => { desktopOnly(); return [] },
  stopKraken: async () => {},
  getKrakenThreads: async () => {
    const max = navigator.hardwareConcurrency || 4
    return { threads: max, isDefault: true, defaultThreads: max, maxThreads: max }
  },
  setKrakenThreads: async (n) => n ?? (navigator.hardwareConcurrency || 4),

  // ALTO import
  selectAltoDir: async () => { desktopOnly(); return null },
  scanAltoDir: async () => [],
  parseAltoFile: async () => [],
  importAltoPageText: async () => { throw new DesktopOnlyError() },

  // TEI: md2tei runs in the browser, on the in-memory markdown.
  generateTEI: async (params) => {
    teiLog.emit('[cllg.tei] input = ocr_output.md (in memory)')
    const xml = runMd2Tei({
      markdownText: await combinedMarkdown(),
      yamlConfigText: params.yamlContent,
      bibliography: params.bibliography,
      log: teiLog.emit,
    })
    teiLog.emit('[cllg.tei] done ✓')
    return xml
  },
  saveTEI: async ({ xml, outputPath }) => download(basename(outputPath), xml),
  scanRefs: async () => scanRefs(await combinedMarkdown()),
  openInFinder: () => {},
  selectSaveFile: async (defaultName) => defaultName,
  loadPDFData: async () => { throw new DesktopOnlyError() },

  exportCOCO: async () => { desktopOnly() },
  exportProjectZip: async () => { desktopOnly(); return null },
  exportPageFormat: async (_dir, page, format) => exportPage(page, format),
  exportAllPagesFormat: async () => { desktopOnly(); return null },
  exportSearchablePdf: async () => { desktopOnly(); return null },

  loadOCROutput: async () => combinedMarkdown(),
  reloadProject: async () => project(),
  loadMarkdown: async (_dir, n) => {
    if (markdown.has(n)) return markdown.get(n)!
    return (await project()).pages.find((p) => p.n === n)?.markdown ?? ''
  },
  saveMarkdown: async (_dir, n, content) => { markdown.set(n, withTrailingNewline(content)) },
  deletePageCache: async (_dir, n) => { markdown.set(n, '') },

  // Events
  onOCRProgress: ocrProgress.on,
  onTEILog: teiLog.on,
  onPDFProgress: pdfProgress.on,
}
