import { describe, it, expect } from 'vitest'
import { parseMetsFileOrder, applyMetsOrder } from '../src/main/metsImport'

function mets(divs: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mets xmlns="http://www.loc.gov/METS/" xmlns:xlink="http://www.w3.org/1999/xlink">
  <fileSec>
    <fileGrp USE="ALTO">
      <file ID="ALTO_1" MIMETYPE="text/xml"><FLocat LOCTYPE="URL" xlink:href="alto/9f3a.xml"/></file>
      <file ID="ALTO_2" MIMETYPE="text/xml"><FLocat LOCTYPE="URL" xlink:href="alto/1c02.xml"/></file>
      <file ID="ALTO_3" MIMETYPE="text/xml"><FLocat LOCTYPE="URL" xlink:href="alto/7e91.xml"/></file>
    </fileGrp>
  </fileSec>
  <structMap TYPE="physical">
    <div TYPE="physSequence">
      ${divs}
    </div>
  </structMap>
</mets>`
}

describe('parseMetsFileOrder', () => {
  it('orders ALTO file basenames by the physical structMap sequence, not the fileSec listing order', () => {
    const xml = mets(`
      <div TYPE="page" ID="P1"><fptr FILEID="ALTO_2"/></div>
      <div TYPE="page" ID="P2"><fptr FILEID="ALTO_3"/></div>
      <div TYPE="page" ID="P3"><fptr FILEID="ALTO_1"/></div>
    `)
    expect(parseMetsFileOrder(xml)).toEqual(['1c02.xml', '7e91.xml', '9f3a.xml'])
  })

  it('uses a numeric ORDER attribute as a tiebreak over document order when present', () => {
    const xml = mets(`
      <div TYPE="page" ORDER="3" ID="P3"><fptr FILEID="ALTO_1"/></div>
      <div TYPE="page" ORDER="1" ID="P1"><fptr FILEID="ALTO_2"/></div>
      <div TYPE="page" ORDER="2" ID="P2"><fptr FILEID="ALTO_3"/></div>
    `)
    expect(parseMetsFileOrder(xml)).toEqual(['1c02.xml', '7e91.xml', '9f3a.xml'])
  })

  it('returns [] for a METS with no structMap (falls back to filename sort upstream)', () => {
    expect(parseMetsFileOrder('<mets xmlns="http://www.loc.gov/METS/"><fileSec/></mets>')).toEqual([])
  })

  it('returns [] for unparsable XML rather than throwing', () => {
    expect(parseMetsFileOrder('not xml at all <<<')).toEqual([])
  })
})

describe('applyMetsOrder', () => {
  it('reorders filenames to match the METS sequence, case-insensitively', () => {
    const files = ['1c02.xml', '7e91.xml', '9f3a.xml']
    expect(applyMetsOrder(files, ['9F3A.xml', '1C02.xml', '7E91.xml'])).toEqual([
      '9f3a.xml',
      '1c02.xml',
      '7e91.xml',
    ])
  })

  it('is a no-op when there is no METS order to apply', () => {
    const files = ['b.xml', 'a.xml']
    expect(applyMetsOrder(files, [])).toEqual(files)
  })

  it('pushes files the METS does not mention to the end, keeping their relative order', () => {
    const files = ['a.xml', 'extra.xml', 'b.xml']
    expect(applyMetsOrder(files, ['b.xml', 'a.xml'])).toEqual(['b.xml', 'a.xml', 'extra.xml'])
  })
})
