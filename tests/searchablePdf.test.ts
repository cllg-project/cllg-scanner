import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
// @ts-expect-error -- no bundled types for the legacy Node build's text-extraction entry
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bboxOf, fontSizeForBbox, baselineTransform, splitByScript, buildSearchablePdf } from '../src/main/searchablePdf'
import type { Page } from '../src/shared/types'

describe('bboxOf', () => {
  it('finds the axis-aligned bounding box of a polygon', () => {
    const polygon: [number, number][] = [[10, 5], [90, 5], [90, 25], [10, 25]]
    expect(bboxOf(polygon)).toEqual({ minX: 10, minY: 5, maxX: 90, maxY: 25 })
  })
})

describe('fontSizeForBbox', () => {
  it('scales with box height', () => {
    expect(fontSizeForBbox({ minX: 0, maxX: 0, minY: 0, maxY: 20 })).toBeCloseTo(16)
  })

  it('floors at 4pt for degenerate/zero-height boxes', () => {
    expect(fontSizeForBbox({ minX: 0, maxX: 0, minY: 10, maxY: 10 })).toBe(4)
  })
})

describe('baselineTransform', () => {
  it('flips image-space y into PDF-space y (origin bottom-left)', () => {
    const { x, y } = baselineTransform([[10, 15], [90, 15]], 100)
    expect(x).toBe(10)
    expect(y).toBe(85)
  })

  it('reports zero rotation for a horizontal baseline', () => {
    const { rotationDegrees } = baselineTransform([[10, 15], [90, 15]], 100)
    expect(rotationDegrees).toBeCloseTo(0)
  })

  it('reports a positive rotation for a baseline sloping upward left-to-right (image space)', () => {
    // In image space (y-down), the end point is *above* the start — after the y-flip
    // into PDF space (y-up), that's a counter-clockwise (positive) rotation.
    const { rotationDegrees } = baselineTransform([[0, 20], [20, 0]], 100)
    expect(rotationDegrees).toBeCloseTo(45)
  })
})

describe('splitByScript', () => {
  it('routes basic Greek and polytonic (Greek Extended) letters to their own bucket, everything else to latin', () => {
    // κ/ό/σ/μ/ε are Greek-and-Coptic; ῥ/ῆ are Greek Extended (precomposed polytonic) —
    // distinct Unicode blocks covered by distinct font files (see FONT_FILES), because a
    // single font's cmap doesn't actually span all of them (that's the bug this fixes).
    expect(splitByScript('κόσμε')).toEqual([{ text: 'κόσμε', bucket: 'greek' }])
    expect(splitByScript('ῥῆμα')).toEqual([
      { text: 'ῥῆ', bucket: 'greekExt' },
      { text: 'μα', bucket: 'greek' },
    ])
    expect(splitByScript('hello κόσμε world')).toEqual([
      { text: 'hello ', bucket: 'latin' },
      { text: 'κόσμε', bucket: 'greek' },
      { text: ' world', bucket: 'latin' },
    ])
  })

  it('gives a combining diacritical mark the same bucket as the letter it follows', () => {
    // U+03B1 alpha (greek) + U+0301 combining acute — decomposed input, not precomposed.
    expect(splitByScript('ά')).toEqual([{ text: 'ά', bucket: 'greek' }])
  })
})

describe('buildSearchablePdf', () => {
  async function build(page: Page, markdown: string): Promise<Uint8Array> {
    const projectDir = mkdtempSync(join(tmpdir(), 'cllg-pdf-'))
    await mkdir(join(projectDir, 'pages'), { recursive: true })
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } })
      .png()
      .toFile(join(projectDir, 'pages', 'page_0001.png'))
    await writeFile(join(projectDir, 'pages', 'page_0001.md'), markdown, 'utf-8')
    return buildSearchablePdf(projectDir, [page], 'Test Project')
  }

  async function extractText(bytes: Uint8Array): Promise<string> {
    const doc = await getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise
    const content = await (await doc.getPage(1)).getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return content.items.map((i: any) => i.str).join('')
  }

  it('emits one PDF page per input page, sized to the kept image, with an invisible searchable text layer', async () => {
    const page: Page = {
      n: 1,
      imagePath: 'pages/page_0001.png',
      masks: [],
      status: 'ocr_done',
      lineGeometry: [
        { id: 'k0', polygon: [[10, 10], [190, 10], [190, 30], [10, 30]], text: 'stale archived text', source: 'kraken' },
      ],
    }
    const bytes = await build(page, '<p>\n<lb n="k0"/>χαῖρε κόσμε\n</p>\n')
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')

    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const [pdfPage] = doc.getPages()
    expect(pdfPage.getWidth()).toBe(200)
    expect(pdfPage.getHeight()).toBe(100)
  })

  it('round-trips mixed Greek (including polytonic) and Latin text losslessly through the invisible layer', async () => {
    const page: Page = {
      n: 1,
      imagePath: 'pages/page_0001.png',
      masks: [],
      status: 'ocr_done',
      lineGeometry: [
        { id: 'k0', polygon: [[10, 10], [190, 10], [190, 30], [10, 30]], text: 'stale', source: 'kraken' },
      ],
    }
    const original = 'χαῖρε ῥῆμα κόσμε world'
    const bytes = await build(page, `<p>\n<lb n="k0"/>${original}\n</p>\n`)
    expect(await extractText(bytes)).toBe(original)
  })

  it('round-trips Greek text in the no-geometry fallback path too', async () => {
    const page: Page = { n: 1, imagePath: 'pages/page_0001.png', masks: [], status: 'ocr_done' }
    const bytes = await build(page, 'ῥῆμα κόσμε\n')
    expect(await extractText(bytes)).toBe('ῥῆμα κόσμε')
  })
})
