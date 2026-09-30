import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import sharp from 'sharp'
import { needsPngConversion, convertToPng, imageDataUrl, MAX_PAGE_SIDE } from '../src/main/imageFormat'

const dir = mkdtempSync(join(tmpdir(), 'cllg-img-'))
const page = (): sharp.Sharp =>
  sharp({ create: { width: 120, height: 80, channels: 3, background: '#fff' } })

beforeAll(async () => {
  await page().tiff({ compression: 'lzw' }).toFile(join(dir, 'lzw.tif'))
  await page().tiff({ compression: 'jpeg' }).toFile(join(dir, 'jpeg.tiff'))
  await page().jpeg().toFile(join(dir, 'page.jpg'))
})

describe('needsPngConversion', () => {
  it('converts everything but PNG and JPEG', () => {
    for (const f of ['a.tif', 'a.TIFF', 'a.bmp', 'a.webp']) expect(needsPngConversion(f)).toBe(true)
    for (const f of ['a.png', 'a.jpg', 'a.JPEG']) expect(needsPngConversion(f)).toBe(false)
  })
})

describe('TIFF pages', () => {
  // g4.tif: a bilevel CCITT Group 4 scan (made with PIL — sharp can't write G4)
  it.each([
    join(dir, 'lzw.tif'),
    join(dir, 'jpeg.tiff'),
    join(__dirname, 'fixtures', 'g4.tif'),
  ])('%s converts to a PNG of the same size', async (src) => {
    const out = join(dir, `${basename(src)}.png`)
    await convertToPng(src, out)
    const meta = await sharp(readFileSync(out)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 120, 80])
  })

  it('loads a TIFF as a PNG data URL', async () => {
    const url = await imageDataUrl(join(dir, 'lzw.tif'))
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
    expect(meta.format).toBe('png')
  })

  it('passes a JPEG through with its own MIME type', async () => {
    const url = await imageDataUrl(join(dir, 'page.jpg'))
    expect(url).toBe(`data:image/jpeg;base64,${readFileSync(join(dir, 'page.jpg')).toString('base64')}`)
  })

  // 20000×16000 = 320 MP, over sharp's default 268 MP input limit — like the
  // 24448×26784 G4 pages ScanTailor writes.
  const huge = join(__dirname, 'fixtures', 'huge_g4.tif')

  it('converts a page over the pixel limit, capped and single-channel', async () => {
    const out = join(dir, 'huge.png')
    await convertToPng(huge, out)
    const meta = await sharp(readFileSync(out)).metadata()
    expect([meta.width, meta.height, meta.channels]).toEqual([MAX_PAGE_SIDE, 4800, 1])
  })

  it('makes a small JPEG thumbnail of it', async () => {
    const url = await imageDataUrl(huge, 1200)
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true)
    const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 960])
  })
})
