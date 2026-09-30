export type PageStatus = 'pending' | 'masked' | 'ocr_done' | 'skipped' | 'error'

export interface Mask {
  x: number
  y: number
  width: number
  height: number
  fill: string  // '#ffffff' or '#000000'
}

export type GeometrySource = 'alto' | 'kraken'

export interface LineGeometry {
  id: string                       // ALTO TextLine/@ID if present, else `${blockId}-${idx}` / `k${idx}`
  polygon: [number, number][]      // pixel coords in the page image's space
  baseline?: [number, number][]    // verbatim ALTO <Baseline POINTS=.../>, only ever set for source:'alto'
  regionType?: string              // ALTO TextBlock/@TYPE, or Kraken's per-line `type` (whatever the loaded model's class_mapping defines)
  blockId?: string                 // ALTO TextBlock/@ID; for Kraken, the detected region (`r<index>`) when a region model ran
  text?: string                    // ALTO ground truth, or Kraken's first-pass recognized text — immutable once set
  source: GeometrySource
}

// Back-compat alias — AltoLine is now a LineGeometry restricted to ALTO's shape.
export type AltoLine = LineGeometry

// A user-drawn image-space grouping of lines used to manually recover paragraph/quote/
// heading/continuation structure on pages with no LADaS zone typing at all (plain-Kraken
// output). `lineIds` is captured once at draw time (LineGeometry ids whose polygon
// centroid fell inside `rect`), not live-recomputed.
export interface ManualZoneGroup {
  id: string
  role: 'p' | 'quote' | 'head' | 'continuation'
  rect: { x: number; y: number; width: number; height: number }   // page-image pixel space
  lineIds: string[]
}

// A layout zone on a page image: detected by the D-FINE region model (`dfine`, id
// `r<index>`) or drawn by hand in Review (`manual`, id `mz-…`). `type` is the full LADaS
// zone type ("MainZone-P", "MarginTextZone", "RunningTitleZone", …) — decides the block
// tag the zone's lines are wrapped in (see src/shared/zones.ts). `lineIds` is the set of
// LineGeometry ids the zone holds; the markdown links back to the zone through
// `<p zone="id">` wrappers and the lines' `<lb n="id"/>` anchors.
export type ZoneSource = 'dfine' | 'manual'

export interface PageZone {
  id: string
  type: string
  rect: { x: number; y: number; width: number; height: number }   // page-image pixel space
  lineIds: string[]
  source: ZoneSource
  score?: number
}

export interface Page {
  n: number
  imagePath: string          // relative to projectDir
  maskedImagePath?: string   // relative to projectDir, set after apply-masks
  masks: Mask[]
  status: PageStatus
  markdown?: string
  errorMessage?: string
  isExample?: boolean        // marks this page as a few-shot OCR example (max 3)
  tokens?: number            // output tokens from last successful OCR run
  elapsedMs?: number         // wall-clock time of last successful OCR run
  lineGeometry?: LineGeometry[]  // per-line geometry, from ALTO import or Kraken's own first segmentation pass
  zones?: PageZone[]
  manualZones?: ManualZoneGroup[]   // legacy (pre-`zones` projects); migrated to `zones` on load
}

export interface LMConfig {
  endpoint: string   // e.g. 'http://localhost:1234'
  model: string
  contextLength: number
  temperature: number
  apiKey?: string
  promptTemplate?: string  // override default OCR prompt
  inMemoryLearning?: boolean  // enable few-shot examples; defaults true when examples exist
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
  krakenConfig?: KrakenConfig   // persisted custom/builtin Kraken model paths; undefined = use builtin defaults
  ocrEngine?: 'lm' | 'kraken'   // which engine the OCR step (Step 3) uses; default 'lm' when absent
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
  status: 'started' | 'done' | 'error' | 'skipped' | 'model-reload'
  tokens?: number
  elapsedMs?: number
  errorMessage?: string
  fromCache?: boolean
  logMessage?: string  // used by model-reload status for UI log lines
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

// Which kind of document a project holds; decides how Kraken lines are merged with
// the zones a region model detects (see src/main/regionMerge.ts).
//   cllg  — Greek scholarly edition (CLLG): margin section markers go inline as <ref>
//   ladas — Latin document typed with the LADaS zone vocabulary: margins stay <note>s
export type DocumentType = 'cllg' | 'ladas'

// What to do with the zones of one region type the layout model detects:
//   annotate — keep the text and the zone: tagged in the text (`<p zone="r3">`) and
//              editable in Review
//   keep     — keep the text only: plain lines, no tag, no zone
//   drop     — leave the text out of the transcription (its line geometry is kept)
export type ZoneAction = 'annotate' | 'keep' | 'drop'

export interface KrakenConfig {
  segModelPath: string
  recModelPath: string
  builtinModels: boolean
  regionModelPath?: string      // D-FINE layout model; empty/undefined = no region detection
  documentType?: DocumentType   // default 'cllg'
  // Per region type (as the model names it); a type left out gets defaultZoneAction()
  // (src/shared/zones.ts). Chosen in the Document step, right after import.
  zonePolicy?: Record<string, ZoneAction>
}

// The separable Kraken steps: zone (D-FINE layout regions), line (segmentation), text
// (recognition). 'all' rebuilds the page from scratch, as a first OCR run does.
export type KrakenStep = 'zone' | 'line' | 'text'

export interface KrakenStepResult {
  pageNum: number
  zones: number
  newLines: number
  orphanLines: number
  textLines: number
  unwrappedZones: string[]   // zones whose block tag could not be written (interleaved lines)
}

export type PageExportFormat = 'plain' | 'plain-ladas' | 'alto' | 'pretei'

export interface AltoScanResult {
  altoPath: string     // absolute path to the ALTO XML file
  imagePath: string | null   // absolute path to the paired image, if found
  lineCount: number
  regionTypes: string[]
  ladasCompatible: boolean   // true if any regionType matches the LADaS MainZone:* convention
}

// Built-in Kraken models, downloaded on first run (see src/main/models.ts).
export interface ModelStatus {
  file: string
  description: string
  size: number        // bytes
  present: boolean
}

export interface ModelDownloadEvent {
  file: string
  status: 'started' | 'progress' | 'done' | 'error'
  received: number
  total: number
  error?: string
}
