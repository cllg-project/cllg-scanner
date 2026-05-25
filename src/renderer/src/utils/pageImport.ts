import * as pdfjs from 'pdfjs-dist'
import type { Project } from '@shared/types'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DjVuDocument: any = null
export async function getDjVuDocument(): Promise<unknown> {
  if (!DjVuDocument) {
    const mod = await import('djvujs-dist/library/src/DjVuDocument.js')
    DjVuDocument = mod.default
  }
  return DjVuDocument
}

export function detectFormatFromBytes(bytes: Uint8Array): 'pdf' | 'djvu' | 'unknown' {
  if (bytes.length < 4) return 'unknown'
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf'
  if (bytes[0] === 0x41 && bytes[1] === 0x54 && bytes[2] === 0x26 && bytes[3] === 0x54) return 'djvu'
  return 'unknown'
}

export function formatFromExtension(filePath: string): 'pdf' | 'djvu' {
  const ext = filePath.toLowerCase().split('.').pop()
  return ext === 'djvu' || ext === 'djv' ? 'djvu' : 'pdf'
}

export async function tryLoadDocument(
  mode: 'pdf' | 'djvu',
  bytes: Uint8Array
): Promise<{ doc: pdfjs.PDFDocumentProxy | unknown; totalPages: number }> {
  if (mode === 'pdf') {
    const doc = await pdfjs.getDocument({ data: bytes }).promise
    return { doc, totalPages: (doc as pdfjs.PDFDocumentProxy).numPages }
  } else {
    const DjVuDoc = await getDjVuDocument()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new (DjVuDoc as any)(bytes.buffer)
    return { doc, totalPages: (doc as { getPagesQuantity(): number }).getPagesQuantity() }
  }
}

const THUMB_H = 600

export async function pdfThumbnail(pdf: pdfjs.PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: THUMB_H / base.height })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.88)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function djvuThumbnail(doc: any, pageNum: number): Promise<string> {
  const page = await doc.getPage(pageNum)
  const imageData: ImageData = page.getImageData()
  const scale = THUMB_H / imageData.height
  const src = document.createElement('canvas')
  src.width = imageData.width
  src.height = imageData.height
  src.getContext('2d')!.putImageData(imageData, 0, 0)
  const thumb = document.createElement('canvas')
  thumb.width = Math.round(imageData.width * scale)
  thumb.height = THUMB_H
  thumb.getContext('2d')!.drawImage(src, 0, 0, thumb.width, thumb.height)
  return thumb.toDataURL('image/jpeg', 0.88)
}

export async function imageThumbnail(filePath: string): Promise<string> {
  const dataUrl = await window.api.loadImageAsDataUrl(filePath)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = THUMB_H / img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = THUMB_H
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.src = dataUrl
  })
}

// ── Range helpers ────────────────────────────────────────────────────────────

/** Parse "1-5,7,9" → [1,2,3,4,5,7,9], clamped to [1, total]. */
export function parseRange(text: string, total: number): number[] {
  const pages = new Set<number>()
  for (const part of text.split(',')) {
    const t = part.trim()
    if (!t) continue
    const dash = t.indexOf('-', 1)
    if (dash > 0) {
      const a = parseInt(t.slice(0, dash), 10)
      const b = parseInt(t.slice(dash + 1), 10)
      if (!isNaN(a) && !isNaN(b)) {
        const lo = Math.max(1, Math.min(total, Math.min(a, b)))
        const hi = Math.max(1, Math.min(total, Math.max(a, b)))
        for (let i = lo; i <= hi; i++) pages.add(i)
      }
    } else {
      const n = parseInt(t, 10)
      if (!isNaN(n) && n >= 1 && n <= total) pages.add(n)
    }
  }
  return Array.from(pages).sort((a, b) => a - b)
}

/** Compress [1,2,3,5,7,8] → "1-3,5,7-8" */
export function compressRange(pages: number[]): string {
  if (!pages.length) return ''
  const s = [...pages].sort((a, b) => a - b)
  const parts: string[] = []
  let start = s[0], prev = s[0]
  for (let i = 1; i <= s.length; i++) {
    if (s[i] === prev + 1) { prev = s[i]; continue }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    if (s[i] !== undefined) { start = s[i]; prev = s[i] }
  }
  return parts.join(',')
}

/** Toggle a single page in/out of a range string. */
export function togglePage(rangeText: string, n: number, total: number): string {
  const pages = parseRange(rangeText, total)
  const idx = pages.indexOf(n)
  if (idx === -1) pages.push(n)
  else pages.splice(idx, 1)
  return compressRange(pages)
}

/**
 * Render PDF pages and append them to the project.
 * pageNums: 1-based PDF page indices to render.
 * startN: project page number for the first new page (default: project.pages.length + 1).
 */
export async function renderPDFPages(
  pdf: pdfjs.PDFDocumentProxy,
  project: Project,
  pageNums: number[],
  onProgress: (cur: number, total: number) => void,
  startN?: number
): Promise<Project> {
  const pages = [...project.pages]
  const base = startN ?? project.pages.length + 1
  for (let idx = 0; idx < pageNums.length; idx++) {
    onProgress(idx + 1, pageNums.length)
    const i = pageNums[idx]
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 200 / 72 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    const blob: Blob = await new Promise((res) => canvas.toBlob(res as BlobCallback, 'image/png'))
    const n = base + idx
    const savedPath = await window.api.savePageImage(project.projectDir, n, await blob.arrayBuffer())
    pages.push({ n, imagePath: savedPath, masks: [], status: 'pending' })
  }
  return { ...project, pages }
}

/**
 * Render DjVu pages and append them to the project.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderDjVuPages(
  doc: any,
  project: Project,
  pageNums: number[],
  onProgress: (cur: number, total: number) => void,
  startN?: number
): Promise<Project> {
  const pages = [...project.pages]
  const base = startN ?? project.pages.length + 1
  for (let idx = 0; idx < pageNums.length; idx++) {
    onProgress(idx + 1, pageNums.length)
    const i = pageNums[idx]
    const page = await doc.getPage(i)
    const imageData: ImageData = page.getImageData()
    const canvas = document.createElement('canvas')
    canvas.width = imageData.width
    canvas.height = imageData.height
    canvas.getContext('2d')!.putImageData(imageData, 0, 0)
    const blob: Blob = await new Promise((res) => canvas.toBlob(res as BlobCallback, 'image/png'))
    const n = base + idx
    const savedPath = await window.api.savePageImage(project.projectDir, n, await blob.arrayBuffer())
    pages.push({ n, imagePath: savedPath, masks: [], status: 'pending' })
  }
  return { ...project, pages }
}

/**
 * Copy image files into the project and append them as pages.
 * imagePaths: absolute paths to the source images (in order).
 */
export async function importImagePages(
  imagePaths: string[],
  project: Project,
  onProgress: (cur: number, total: number) => void,
  startN?: number
): Promise<Project> {
  const pages = [...project.pages]
  const base = startN ?? project.pages.length + 1
  for (let idx = 0; idx < imagePaths.length; idx++) {
    onProgress(idx + 1, imagePaths.length)
    const n = base + idx
    const savedPath = await window.api.copyImageToProject(imagePaths[idx], project.projectDir, n)
    pages.push({ n, imagePath: savedPath, masks: [], status: 'pending' })
  }
  return { ...project, pages }
}
