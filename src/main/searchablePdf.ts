import { PDFDocument, PDFFont, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { readFile } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import type { Page } from '@shared/types'
import { approximateBaseline, textByAnchor } from './altoExport'
import { stripPseudoTags } from './pageExportFormats'
import { loadPageMarkdown } from './ipc/pageExport'

// The invisible OCR text layer needs a real glyph per character, not just a font that
// *parses* — a codepoint outside a font's cmap falls back to glyph 0 (.notdef), and when
// several different Unicode characters all collapse onto that same glyph id, pdf-lib's
// ToUnicode map can only keep one of them: selecting/copying the invisible text then comes
// out garbled (wrong characters, dupes) even though the PDF still "has" the text. A single
// Latin font hit exactly this for Greek. So Greek and Greek Extended (polytonic) each get
// their own font file with real coverage; Latin (+ everything else) uses the Latin file.
type ScriptBucket = 'latin' | 'greek' | 'greekExt'

const FONT_DIR = join(__dirname, '..', '..', 'node_modules', '@fontsource', 'noto-sans', 'files')
const FONT_FILES: Record<ScriptBucket, string> = {
  latin: join(FONT_DIR, 'noto-sans-latin-400-normal.woff2'),
  greek: join(FONT_DIR, 'noto-sans-greek-400-normal.woff2'),
  greekExt: join(FONT_DIR, 'noto-sans-greek-ext-400-normal.woff2'),
}

// Greek and Coptic (basic modern/monotonic Greek) vs. Greek Extended (precomposed
// polytonic letter+diacritic combinations) are genuinely different Unicode blocks covered
// by different font subset files — see FONT_FILES. Combining diacritical marks
// (U+0300–036F, for any decomposed input) have no script of their own: they inherit
// whatever bucket the letter they're attached to used, via splitByScript()'s `lastBucket`.
function scriptOf(codePoint: number): ScriptBucket {
  if (codePoint >= 0x1f00 && codePoint <= 0x1fff) return 'greekExt'
  if (codePoint >= 0x0370 && codePoint <= 0x03ff) return 'greek'
  return 'latin'
}

export interface ScriptRun {
  text: string
  bucket: ScriptBucket
}

/** Splits text into runs of consecutive characters sharing the same font bucket. */
export function splitByScript(text: string): ScriptRun[] {
  const runs: ScriptRun[] = []
  let lastBucket: ScriptBucket = 'latin'
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0
    const isCombiningMark = codePoint >= 0x0300 && codePoint <= 0x036f
    const bucket = isCombiningMark ? lastBucket : scriptOf(codePoint)
    lastBucket = bucket
    const last = runs[runs.length - 1]
    if (last && last.bucket === bucket) last.text += ch
    else runs.push({ text: ch, bucket })
  }
  return runs
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function bboxOf(polygon: [number, number][]): BBox {
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

// A line's box height is a reasonable stand-in for its cap height — good enough for an
// invisible layer, where the goal is "roughly the right size and place", not typography.
export function fontSizeForBbox(bbox: BBox): number {
  return Math.max(4, (bbox.maxY - bbox.minY) * 0.8)
}

// Converts an image-space baseline (2 points, y-down, from altoExport.ts's
// approximateBaseline or a verbatim ALTO baseline) into a PDF-space text origin + rotation.
// The page is built at 1 image pixel = 1 PDF point (see buildSearchablePdf), so this is a
// straight y-flip (PDF's origin is bottom-left) plus an angle from the baseline vector.
export function baselineTransform(
  baseline: [number, number][],
  pageHeight: number
): { x: number; y: number; rotationDegrees: number } {
  const start = baseline[0] ?? [0, 0]
  const end = baseline[1] ?? start
  const x = start[0]
  const y = pageHeight - start[1]
  const dx = end[0] - start[0]
  const dy = pageHeight - end[1] - y
  const rotationDegrees = (Math.atan2(dy, dx) * 180) / Math.PI
  return { x, y, rotationDegrees }
}

type FontsByScript = Record<ScriptBucket, PDFFont>

async function embedFonts(doc: PDFDocument): Promise<FontsByScript> {
  const [latin, greek, greekExt] = await Promise.all([
    readFile(FONT_FILES.latin).then((bytes) => doc.embedFont(bytes)),
    readFile(FONT_FILES.greek).then((bytes) => doc.embedFont(bytes)),
    readFile(FONT_FILES.greekExt).then((bytes) => doc.embedFont(bytes)),
  ])
  return { latin, greek, greekExt }
}

// Draws `text` as invisible text starting at (x, y), rotated by `rotationDegrees` about
// that point — splitting it into per-script runs (see splitByScript()) so every character
// gets a font that actually has a glyph for it, and advancing each subsequent run's origin
// along the (rotated) baseline direction by the previous run's rendered width, so the runs
// still read as one continuous line instead of stacking on top of each other.
function drawInvisibleText(
  pdfPage: import('pdf-lib').PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  rotationDegrees: number,
  fonts: FontsByScript
): void {
  const theta = (rotationDegrees * Math.PI) / 180
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  let curX = x
  let curY = y
  for (const run of splitByScript(text)) {
    const font = fonts[run.bucket]
    pdfPage.drawText(run.text, { x: curX, y: curY, size, font, opacity: 0, rotate: degrees(rotationDegrees) })
    const width = font.widthOfTextAtSize(run.text, size)
    curX += width * cosT
    curY += width * sinT
  }
}

/**
 * Builds a "searchable PDF": one page per input page, each the kept page image with an
 * invisible OCR text layer on top. When a page has per-line geometry (from ALTO import or
 * a Kraken segmentation pass), each line's text is placed at that line's own baseline —
 * i.e. genuinely localised over the matching image region, the same geometry
 * altoExport.ts's buildAltoXml() round-trips. Pages with no geometry at all (plain
 * img2md/LM-Studio OCR, no Kraken/ALTO pass) fall back to one invisible line per markdown
 * line, stacked from the top of the page — still fully searchable, just not line-localised.
 */
export async function buildSearchablePdf(projectDir: string, pages: Page[], title?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts = await embedFonts(doc)
  if (title) doc.setTitle(title)

  for (const page of pages) {
    const imagePath = join(projectDir, page.imagePath)
    const { data, info } = await sharp(imagePath).png().toBuffer({ resolveWithObject: true })
    const { width, height } = info
    const embeddedImage = await doc.embedPng(data)

    const pdfPage = doc.addPage([width, height])
    pdfPage.drawImage(embeddedImage, { x: 0, y: 0, width, height })

    const markdown = await loadPageMarkdown(projectDir, page)
    const geometry = page.lineGeometry ?? []

    if (geometry.length > 0) {
      const correctedById = textByAnchor(markdown)
      for (const line of geometry) {
        const text = correctedById.get(line.id) ?? line.text ?? ''
        if (!text.trim()) continue
        const bbox = bboxOf(line.polygon)
        const baseline = line.baseline ?? approximateBaseline(line.polygon)
        const { x, y, rotationDegrees } = baselineTransform(baseline, height)
        drawInvisibleText(pdfPage, text, x, y, fontSizeForBbox(bbox), rotationDegrees, fonts)
      }
    } else {
      const plain = stripPseudoTags(markdown).trim()
      if (plain) {
        let y = height - 24
        for (const lineText of plain.split('\n')) {
          if (lineText.trim() && y > 0) drawInvisibleText(pdfPage, lineText, 24, y, 10, 0, fonts)
          y -= 12
        }
      }
    }
  }

  return doc.save()
}
