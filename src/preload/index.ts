import { contextBridge, ipcRenderer } from 'electron'
import type {
  Project,
  LMConfig,
  LMTestResult,
  OCRProgressEvent,
  TEIParams,
  TEISaveParams,
  KrakenConfig
} from '@shared/types'

const api = {
  // ── Project ──────────────────────────────────────────────────────────
  newProject: (pdfPath: string, projectDir: string): Promise<Project> =>
    ipcRenderer.invoke('project:new', pdfPath, projectDir),

  openProject: (): Promise<Project | null> =>
    ipcRenderer.invoke('project:open'),

  saveProject: (project: Project): Promise<void> =>
    ipcRenderer.invoke('project:save', project),

  getRecentProjects: (): Promise<Project[]> =>
    ipcRenderer.invoke('project:recent'),

  removeRecentProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke('project:removeRecent', projectId),

  // ── PDF / DjVu / images ──────────────────────────────────────────────
  selectPDF: (): Promise<string | null> =>
    ipcRenderer.invoke('pdf:select'),

  selectDocument: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDocument'),

  selectImageDir: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectImageDir'),

  selectImages: (): Promise<string[]> =>
    ipcRenderer.invoke('dialog:selectImages'),

  listImagesInDir: (dirPath: string): Promise<{ name: string; path: string }[]> =>
    ipcRenderer.invoke('dir:listImages', dirPath),

  copyImageToProject: (srcPath: string, projectDir: string, pageNum: number): Promise<string> =>
    ipcRenderer.invoke('page:copyImage', srcPath, projectDir, pageNum),

  selectProjectDir: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDir'),

  // ── Images ───────────────────────────────────────────────────────────
  savePageImage: (
    projectDir: string,
    pageNum: number,
    data: ArrayBuffer
  ): Promise<string> =>
    ipcRenderer.invoke('page:saveImage', projectDir, pageNum, data),

  saveMaskedImage: (
    projectDir: string,
    pageNum: number,
    data: ArrayBuffer
  ): Promise<string> =>
    ipcRenderer.invoke('page:saveMasked', projectDir, pageNum, data),

  loadImageAsDataUrl: (absolutePath: string): Promise<string> =>
    ipcRenderer.invoke('page:loadImage', absolutePath),

  joinPaths: (...parts: string[]): Promise<string> =>
    ipcRenderer.invoke('path:join', ...parts),

  // ── OCR ──────────────────────────────────────────────────────────────
  testLMStudio: (endpoint: string, apiKey?: string): Promise<LMTestResult> =>
    ipcRenderer.invoke('ocr:test', endpoint, apiKey),

  runOCR: (projectDir: string, pages: Project['pages'], lmConfig: LMConfig, allPages?: Project['pages']): Promise<void> =>
    ipcRenderer.invoke('ocr:run', projectDir, pages, lmConfig, allPages),

  stopOCR: (): Promise<void> =>
    ipcRenderer.invoke('ocr:stop'),

  rerunPageLM: (imagePath: string, lmConfig: LMConfig): Promise<{ text: string }> =>
    ipcRenderer.invoke('ocr:rerun-page', imagePath, lmConfig),

  getKrakenBuiltinPaths: (): Promise<{ segModelPath: string; recModelPath: string }> =>
    ipcRenderer.invoke('kraken:getBuiltinPaths'),

  rerunPageKraken: (
    imagePath: string,
    krakenConfig: KrakenConfig
  ): Promise<{ text: string; lines: { text: string; corners: [number, number][] }[] }> =>
    ipcRenderer.invoke('kraken:rerun-page', imagePath, krakenConfig.segModelPath, krakenConfig.recModelPath),

  // ── TEI ──────────────────────────────────────────────────────────────
  generateTEI: (params: TEIParams): Promise<string> =>
    ipcRenderer.invoke('tei:generate', params),

  saveTEI: (params: TEISaveParams): Promise<void> =>
    ipcRenderer.invoke('tei:save', params),

  scanRefs: (projectDir: string): Promise<{ format: string; sample: string[]; count: number }[]> =>
    ipcRenderer.invoke('md:scanRefs', projectDir),

  openInFinder: (path: string): void =>
    ipcRenderer.send('shell:openPath', path),

  selectSaveFile: (defaultName: string, ext: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, ext),

  loadPDFData: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdf:loadData', filePath),

  exportCOCO: (project: Project): Promise<void> =>
    ipcRenderer.invoke('export:coco', project),

  loadOCROutput: (projectDir: string): Promise<string> =>
    ipcRenderer.invoke('ocr:loadOutput', projectDir),

  reloadProject: (projectDir: string): Promise<Project> =>
    ipcRenderer.invoke('project:loadFromDir', projectDir),

  loadMarkdown: (projectDir: string, pageN: number): Promise<string> =>
    ipcRenderer.invoke('page:loadMarkdown', projectDir, pageN),

  saveMarkdown: (projectDir: string, pageN: number, content: string): Promise<void> =>
    ipcRenderer.invoke('page:saveMarkdown', projectDir, pageN, content),

  deletePageCache: (projectDir: string, pageN: number): Promise<void> =>
    ipcRenderer.invoke('page:deleteCache', projectDir, pageN),

  // ── Events (push from main → renderer) ───────────────────────────────
  onOCRProgress: (cb: (e: OCRProgressEvent) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, e: OCRProgressEvent): void => cb(e)
    ipcRenderer.on('ocr:progress', handler)
    return () => ipcRenderer.removeListener('ocr:progress', handler)
  },

  onTEILog: (cb: (line: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, line: string): void => cb(line)
    ipcRenderer.on('tei:log', handler)
    return () => ipcRenderer.removeListener('tei:log', handler)
  },

  onPDFProgress: (cb: (current: number, total: number) => void): (() => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      current: number,
      total: number
    ): void => cb(current, total)
    ipcRenderer.on('pdf:progress', handler)
    return () => ipcRenderer.removeListener('pdf:progress', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
