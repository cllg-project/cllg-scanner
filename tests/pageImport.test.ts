import { describe, it, expect, vi } from 'vitest'

// pdfjs-dist runs at module level and accesses worker URLs — mock it before import
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}))

import {
  parseRange,
  compressRange,
  togglePage,
  detectFormatFromBytes,
  formatFromExtension,
} from '@renderer/utils/pageImport'

describe('parseRange', () => {
  it('"1-5" → [1,2,3,4,5]', () => {
    expect(parseRange('1-5', 10)).toEqual([1, 2, 3, 4, 5])
  })
  it('"1,3,5" → [1,3,5]', () => {
    expect(parseRange('1,3,5', 10)).toEqual([1, 3, 5])
  })
  it('"1-3,5,7-9" → [1,2,3,5,7,8,9]', () => {
    expect(parseRange('1-3,5,7-9', 10)).toEqual([1, 2, 3, 5, 7, 8, 9])
  })
  it('empty string → []', () => {
    expect(parseRange('', 10)).toEqual([])
  })
  it('single page "3" → [3]', () => {
    expect(parseRange('3', 10)).toEqual([3])
  })
  it('clamps low end: "0-3" → [1,2,3]', () => {
    expect(parseRange('0-3', 10)).toEqual([1, 2, 3])
  })
  it('clamps high end: "8-12" with total=10 → [8,9,10]', () => {
    expect(parseRange('8-12', 10)).toEqual([8, 9, 10])
  })
  it('out-of-bounds single: "0" → []', () => {
    expect(parseRange('0', 10)).toEqual([])
  })
  it('out-of-bounds single: "11" with total=10 → []', () => {
    expect(parseRange('11', 10)).toEqual([])
  })
  it('reverse range "5-3" → [3,4,5] (sorted ascending)', () => {
    expect(parseRange('5-3', 10)).toEqual([3, 4, 5])
  })
  it('overlapping ranges are deduplicated: "1-3,2-4" → [1,2,3,4]', () => {
    expect(parseRange('1-3,2-4', 10)).toEqual([1, 2, 3, 4])
  })
  it('spaces around comma-parts are trimmed', () => {
    expect(parseRange('1, 3, 5', 10)).toEqual([1, 3, 5])
  })
  it('"1-1" → [1]', () => {
    expect(parseRange('1-1', 10)).toEqual([1])
  })
})

describe('compressRange', () => {
  it('[1,2,3] → "1-3"', () => {
    expect(compressRange([1, 2, 3])).toBe('1-3')
  })
  it('[1,3,5] → "1,3,5"', () => {
    expect(compressRange([1, 3, 5])).toBe('1,3,5')
  })
  it('[1,2,3,5,7,8] → "1-3,5,7-8"', () => {
    expect(compressRange([1, 2, 3, 5, 7, 8])).toBe('1-3,5,7-8')
  })
  it('[] → ""', () => {
    expect(compressRange([])).toBe('')
  })
  it('[1] → "1"', () => {
    expect(compressRange([1])).toBe('1')
  })
  it('unsorted input is sorted before compressing', () => {
    expect(compressRange([5, 1, 2, 3])).toBe('1-3,5')
  })
  it('round-trip: compressRange(parseRange("1-3,5,7-9", 10)) === "1-3,5,7-9"', () => {
    expect(compressRange(parseRange('1-3,5,7-9', 10))).toBe('1-3,5,7-9')
  })
  it('all consecutive: [1,2,3,4,5] → "1-5"', () => {
    expect(compressRange([1, 2, 3, 4, 5])).toBe('1-5')
  })
})

describe('togglePage', () => {
  it('toggles a page in (not present) → adds it', () => {
    expect(togglePage('1,3,5', 2, 10)).toBe('1-3,5')
  })
  it('toggles a page out (present) → removes it', () => {
    expect(togglePage('1,2,3', 2, 10)).toBe('1,3')
  })
  it('toggle on empty range → single page', () => {
    expect(togglePage('', 3, 10)).toBe('3')
  })
  it('toggle off last page → empty string', () => {
    expect(togglePage('5', 5, 10)).toBe('')
  })
  it('toggle in page that is adjacent → compresses correctly', () => {
    expect(togglePage('1,3', 2, 10)).toBe('1-3')
  })
})

describe('detectFormatFromBytes', () => {
  it('PDF magic bytes → "pdf"', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('pdf')
  })
  it('DjVu magic bytes → "djvu"', () => {
    const bytes = new Uint8Array([0x41, 0x54, 0x26, 0x54, 0x00])
    expect(detectFormatFromBytes(bytes)).toBe('djvu')
  })
  it('random bytes → "unknown"', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(detectFormatFromBytes(bytes)).toBe('unknown')
  })
  it('fewer than 4 bytes → "unknown"', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44])
    expect(detectFormatFromBytes(bytes)).toBe('unknown')
  })
  it('empty array → "unknown"', () => {
    expect(detectFormatFromBytes(new Uint8Array([]))).toBe('unknown')
  })
})

describe('formatFromExtension', () => {
  it('.pdf → "pdf"', () => {
    expect(formatFromExtension('document.pdf')).toBe('pdf')
  })
  it('.djvu → "djvu"', () => {
    expect(formatFromExtension('book.djvu')).toBe('djvu')
  })
  it('.djv → "djvu"', () => {
    expect(formatFromExtension('book.djv')).toBe('djvu')
  })
  it('uppercase .DJVU → "djvu" (case-insensitive)', () => {
    expect(formatFromExtension('BOOK.DJVU')).toBe('djvu')
  })
  it('unknown extension → "pdf" (default)', () => {
    expect(formatFromExtension('image.tiff')).toBe('pdf')
  })
  it('no extension → "pdf" (default)', () => {
    expect(formatFromExtension('document')).toBe('pdf')
  })
})
