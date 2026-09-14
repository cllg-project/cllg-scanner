import { describe, it, expect } from 'vitest'
import { parseAlto } from '../src/main/altoImport'

const ALTO_WITH_POLYGON = `<?xml version="1.0" encoding="UTF-8"?>
<alto>
  <Description>
    <sourceImageInformation>
      <fileName>page_0001.png</fileName>
    </sourceImageInformation>
  </Description>
  <Layout>
    <Page>
      <PrintSpace>
        <TextBlock ID="tb1" TYPE="main">
          <TextLine ID="l1">
            <Shape>
              <Polygon POINTS="10,20 110,20 110,40 10,40"/>
            </Shape>
            <String CONTENT="Hello" HPOS="10" VPOS="20" WIDTH="50" HEIGHT="20"/>
            <String CONTENT="world" HPOS="65" VPOS="20" WIDTH="45" HEIGHT="20"/>
          </TextLine>
        </TextBlock>
      </PrintSpace>
    </Page>
  </Layout>
</alto>`

const ALTO_RECT_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<alto>
  <Layout>
    <Page>
      <PrintSpace>
        <TextBlock ID="tb1" TYPE="main">
          <TextLine ID="l1" HPOS="5" VPOS="8" WIDTH="100" HEIGHT="15">
            <String CONTENT="Rect" HPOS="5" VPOS="8" WIDTH="100" HEIGHT="15"/>
          </TextLine>
        </TextBlock>
      </PrintSpace>
    </Page>
  </Layout>
</alto>`

const ALTO_WITH_BASELINE = `<?xml version="1.0" encoding="UTF-8"?>
<alto>
  <Layout>
    <Page>
      <PrintSpace>
        <TextBlock ID="tb1" TYPE="main">
          <TextLine ID="l1">
            <Shape>
              <Polygon POINTS="10,20 110,20 110,40 10,40"/>
            </Shape>
            <Baseline POINTS="10,38 60,36 110,38"/>
            <String CONTENT="Curvy" HPOS="10" VPOS="20" WIDTH="100" HEIGHT="20"/>
          </TextLine>
        </TextBlock>
      </PrintSpace>
    </Page>
  </Layout>
</alto>`

const ALTO_WITH_MARGIN = `<?xml version="1.0" encoding="UTF-8"?>
<alto>
  <Layout>
    <Page>
      <PrintSpace>
        <TextBlock ID="tb1" TYPE="main">
          <TextLine ID="l1" HPOS="0" VPOS="0" WIDTH="200" HEIGHT="20">
            <String CONTENT="Main" HPOS="0" VPOS="0" WIDTH="200" HEIGHT="20"/>
          </TextLine>
        </TextBlock>
        <TextBlock ID="tb2" TYPE="margin">
          <TextLine ID="l2" HPOS="220" VPOS="0" WIDTH="60" HEIGHT="20">
            <String CONTENT="Note" HPOS="220" VPOS="0" WIDTH="60" HEIGHT="20"/>
          </TextLine>
        </TextBlock>
      </PrintSpace>
    </Page>
  </Layout>
</alto>`

describe('parseAlto', () => {
  it('parses an explicit <Shape><Polygon> line and the source image filename', () => {
    const result = parseAlto(ALTO_WITH_POLYGON)
    expect(result.imageFileName).toBe('page_0001.png')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].polygon).toEqual([[10, 20], [110, 20], [110, 40], [10, 40]])
    expect(result.lines[0].regionType).toBe('main')
    expect(result.lines[0].text).toBe('Hello world')
    expect(result.lines[0].id).toBe('l1')
    expect(result.lines[0].blockId).toBe('tb1')
    expect(result.lines[0].source).toBe('alto')
  })

  it('captures a <Baseline POINTS=...> element when present', () => {
    const result = parseAlto(ALTO_WITH_BASELINE)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].baseline).toEqual([[10, 38], [60, 36], [110, 38]])
  })

  it('leaves baseline undefined when no <Baseline> is present', () => {
    const result = parseAlto(ALTO_WITH_POLYGON)
    expect(result.lines[0].baseline).toBeUndefined()
  })

  it('synthesizes a line id from blockId+index when TextLine has no ID', () => {
    const noId = ALTO_RECT_ONLY.replace('TextLine ID="l1"', 'TextLine')
    const result = parseAlto(noId)
    expect(result.lines[0].id).toBe('tb1-0')
  })

  it('derives a rectangular polygon from HPOS/VPOS/WIDTH/HEIGHT when no <Polygon> is present', () => {
    const result = parseAlto(ALTO_RECT_ONLY)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].polygon).toEqual([[5, 8], [105, 8], [105, 23], [5, 23]])
    expect(result.lines[0].text).toBe('Rect')
  })

  it('captures distinct region types across TextBlocks', () => {
    const result = parseAlto(ALTO_WITH_MARGIN)
    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((l) => l.regionType)).toEqual(['main', 'margin'])
  })

  it('returns no image filename when <sourceImageInformation> is absent', () => {
    const result = parseAlto(ALTO_RECT_ONLY)
    expect(result.imageFileName).toBeNull()
  })
})
