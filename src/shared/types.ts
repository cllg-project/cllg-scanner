export type PageStatus = 'pending' | 'masked' | 'ocr_done' | 'skipped' | 'error'

export interface Mask {
  x: number
  y: number
  width: number
  height: number
  fill: string  // '#ffffff' or '#000000'
}

export interface Page {
  n: number
  imagePath: string          // relative to projectDir
  maskedImagePath?: string   // relative to projectDir, set after apply-masks
  masks: Mask[]
  status: PageStatus
  markdown?: string
  errorMessage?: string
}

export interface LMConfig {
  endpoint: string   // e.g. 'http://localhost:1234'
  model: string
  contextLength: number
  temperature: number
  apiKey?: string
  promptTemplate?: string  // override default OCR prompt
}

export interface HierarchyLevel {
  name: string
  pattern: string
  format: string
  missingFirst: boolean
  allowGaps: boolean
  isMilestone: boolean
  color?: string          // hex color for highlighting, e.g. '#c0392b'
  children: HierarchyLevel[]
}

export interface ProjectMetadata {
  title: string
  author: string
  edition: string
  language: string
}

export interface Project {
  version: 1
  id: string
  name: string
  projectDir: string        // absolute path to project directory
  pdfPath?: string          // original PDF, may be absolute
  pages: Page[]
  metadata: ProjectMetadata
  hierarchy: HierarchyLevel[]
  bibliography: BibEntry[]
  lmConfig: LMConfig
  createdAt: string
  updatedAt: string
}

// IPC payloads
export interface OCRPageParams {
  projectDir: string
  page: Page
  lmConfig: LMConfig
  pageNum: number
}

export interface OCRProgressEvent {
  pageNum: number
  status: 'started' | 'done' | 'error' | 'skipped'
  tokens?: number
  elapsedMs?: number
  errorMessage?: string
  fromCache?: boolean
}

export interface BibPerson {
  persName: string
  viafId?: string
  worldcatId?: string
}

export interface BibScope {
  unit: string   // 'page' | 'volume' | etc.
  value: string
}

export interface BibEntry {
  id: string           // internal UUID for React keys
  n: string
  authors: BibPerson[]
  editors: BibPerson[]
  title: string
  titleLevel: string   // 'm' | 's' | 'a' | 'j' | ''
  publisher?: string
  pubPlace?: string
  date?: string
  dateReprint?: string
  scopes: BibScope[]
}

export interface TEIParams {
  projectDir: string
  markdownPath: string
  yamlConfigPath: string
  yamlContent: string
  bibliography: BibEntry[]
}

export interface TEISaveParams {
  xml: string
  outputPath: string
}

export interface LMTestResult {
  ok: boolean
  latencyMs: number
  models?: string[]
  error?: string
}
