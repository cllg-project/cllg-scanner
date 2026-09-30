import sharp from 'sharp'
import { readFile } from 'fs/promises'
import { extname } from 'path'

// Page images are shown in Chromium (<img>/canvas), sent to LM Studio as data URLs and
// read as PNG elsewhere (mask export reads the IHDR). Chromium can't decode TIFF at
// all, so anything but PNG/JPEG is converted to PNG with sharp — TIFF (LZW, JPEG,
// CCITT G4, 16-bit, CMYK), BMP, WebP. A multi-page TIFF gives its first page.
const WEB_SAFE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

// Converted pages are capped to this longest side. Binarized scanner/ScanTailor output
// can be enormous (e.g. 24448×26784 G4 TIFFs, ~655 MP): past sharp's default input
// limit, past what a Chromium canvas can hold, and far more than OCR needs.
export const MAX_PAGE_SIDE = 6000

function open(path: string): sharp.Sharp {
  return sharp(path, { failOn: 'none', limitInputPixels: false })
}

export function needsPngConversion(path: string): boolean {
  return !(extname(path).toLowerCase() in WEB_SAFE)
}

async function toPng(src: string): Promise<sharp.Sharp> {
  const { space } = await open(src).metadata()
  const img = open(src).resize({ width: MAX_PAGE_SIDE, height: MAX_PAGE_SIDE, fit: 'inside', withoutEnlargement: true })
  // keep bi-level scans single-channel instead of expanding them to RGB
  return (space === 'b-w' ? img.toColourspace('b-w') : img).png()
}

export async function convertToPng(src: string, dest: string): Promise<void> {
  await (await toPng(src)).toFile(dest)
}

/**
 * The image as a `data:` URL Chromium and LM Studio can decode. With `maxSide`, a
 * JPEG preview no larger than that (thumbnails) — much cheaper than a full page.
 */
export async function imageDataUrl(path: string, maxSide?: number): Promise<string> {
  if (maxSide) {
    const jpg = await open(path)
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer()
    return `data:image/jpeg;base64,${jpg.toString('base64')}`
  }
  if (needsPngConversion(path)) {
    const png = await (await toPng(path)).toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  }
  const data = await readFile(path)
  return `data:${WEB_SAFE[extname(path).toLowerCase()]};base64,${data.toString('base64')}`
}
