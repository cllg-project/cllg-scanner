import { describe, it, expect } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { convertLadasPages, convertLadasZones, parseLadasLabel, teiMappingFor, type LadasZoneIn } from '../src/main/ladasTei'

const z = (type: string, ...texts: string[]): LadasZoneIn => ({ type, lines: texts.map((text) => ({ text })) })
const oneLine = (xml: string): string => xml.replace(/\n\s*/g, '')

// Well-formed XML (the fragment wrapped in a <body>).
function wellFormed(xml: string): boolean {
  const errors: string[] = []
  try {
    new DOMParser({ onError: (_l: string, msg: string) => { errors.push(msg) } } as never).parseFromString(`<body>${xml}</body>`, 'text/xml')
  } catch {
    return false
  }
  return errors.length === 0
}

describe('parseLadasLabel', () => {
  it('splits levels, separators and suffixes', () => {
    expect(parseLadasLabel('MainZone-Head')).toEqual({ raw: 'MainZone-Head', level1: 'MainZone', level2: 'Head' })
    expect(parseLadasLabel('MainZone:PQuoted')).toMatchObject({ level1: 'MainZone', level2: 'PQuoted' })
    expect(parseLadasLabel('MainZone-Continued#latin')).toMatchObject({ level2: 'Continued', suffix: 'latin' })
    expect(parseLadasLabel('MarginTextZone')).toEqual({ raw: 'MarginTextZone', level1: 'MarginTextZone' })
  })

  it('reads the implicit -Ab of material zones and the model\'s own drop-capital label', () => {
    expect(parseLadasLabel('RunningTitleZone-Ab')).toMatchObject({ level1: 'RunningTitleZone' })
    expect(parseLadasLabel('RunningTitleZone-Ab')?.level2).toBeUndefined()
    expect(parseLadasLabel('DropCapitalZone')).toMatchObject({ level1: 'MainZone', level2: 'DropCapital' })
    expect(parseLadasLabel('DigitisationArtefactZone')?.level1).toBe('DigitizationArtefactZone')
  })

  it('returns null for labels that are not LADaS', () => {
    expect(parseLadasLabel('default')).toBeNull()
    expect(parseLadasLabel(undefined)).toBeNull()
  })
})

describe('teiMappingFor: the guidelines\' suggested TEI mapping', () => {
  const el = (type: string): string => {
    const m = teiMappingFor(type)
    if (m.kind !== 'block') return m.kind
    const attrs = Object.entries(m.attrs).map(([k, v]) => `[${k}=${v}]`).join('')
    return (m.inside ?? []).map((w) => w.element + '>').join('') + m.element + attrs
  }

  it('maps the zones the pipeline already converted the same way', () => {
    expect(el('MainZone-P')).toBe('p')
    expect(el('MainZone:P')).toBe('p')
    expect(el('MainZone-PQuoted')).toBe('quote')
    expect(el('MainZone-Head')).toBe('head')
    expect(el('MainZone-Continued')).toBe('continued')
    expect(el('MarginTextZone')).toBe('note')
    expect(el('MarginTextZone-P')).toBe('note')
    expect(el('DropCapitalZone')).toBe('dropcap')
    expect(el('CustomZone-Noise')).toBe('drop')
  })

  it('maps the rest of Level 2', () => {
    expect(el('MainZone-HeadStructured')).toBe('head[type=structured]')
    expect(el('MainZone-PLabelled')).toBe('p[rend=labelled]')
    expect(el('MainZone-PStructured')).toBe('p[type=structured]')
    expect(el('MainZone-PStyled')).toBe('p[rend=styled]')
    expect(el('MainZone-Item')).toBe('item')
    expect(el('MainZone-Lg')).toBe('lg')
    expect(el('MainZone-Dateline')).toBe('dateline')
    expect(el('MainZone-Address')).toBe('address')
    expect(el('MainZone-Signed')).toBe('signed')
    expect(el('MainZone-Ab')).toBe('ab')
    expect(el('MainZone-Maths')).toBe('figure[type=maths]')
    expect(el('MarginTextZone-ManuscriptAddendum')).toBe('note[type=handwritten]')
    expect(el('MarginTextZone-Lg')).toBe('note>lg')
    expect(el('MarginTextZone-Item')).toBe('note>list>item')
  })

  it('maps Level-1 zones: media, title page and material zones', () => {
    expect(el('GraphicZone')).toBe('figure')
    expect(el('GraphicZone-Head')).toBe('head')
    expect(el('GraphicZone-Decoration')).toBe('figure[type=decoration]')
    expect(el('FigureZone')).toBe('figure[type=code]')
    expect(el('TableZone')).toBe('figure[type=table]')
    expect(el('FormZone')).toBe('figure[type=form]')
    expect(el('FormZone-Field')).toBe('ab[type=field]')
    expect(el('MusicZone')).toBe('notatedMusic')
    expect(el('TitlePageZone')).toBe('div[type=titlePage]')
    expect(el('RunningTitleZone')).toBe('fw[type=runningTitle]')
    expect(el('NumberingZone')).toBe('fw[type=numbering]')
    expect(el('QuireMarksZone')).toBe('fw[type=quiremarks]')
    expect(el('DigitizationArtefactZone')).toBe('ab[type=digitisation-artefact]')
    expect(el('StampZone')).toBe('ab>stamp')
  })

  it('drops material zones on request, as the Kraken merge does', () => {
    for (const t of ['RunningTitleZone', 'NumberingZone', 'QuireMarksZone', 'StampZone', 'DigitizationArtefactZone']) {
      expect(teiMappingFor(t, { materialZones: 'drop' }).kind).toBe('drop')
    }
    expect(teiMappingFor('MainZone-P', { materialZones: 'drop' }).kind).toBe('block')
  })

  it('drops the types the project\'s zone policy drops', () => {
    expect(teiMappingFor('MainZone-Lg', { zonePolicy: { 'MainZone-Lg': 'drop' } }).kind).toBe('drop')
    expect(teiMappingFor('MainZone-Lg', { zonePolicy: { 'MainZone-Lg': 'keep' } }).kind).toBe('block')
  })
})

describe('convertLadasPages', () => {
  it('converts a page with anchored lines and escapes text', () => {
    const xml = convertLadasZones(
      [
        z('RunningTitleZone', 'HISTOIRE'),
        { type: 'MainZone-Head', lines: [{ id: 'k1', text: 'Chapitre I' }] },
        { type: 'MainZone-P', lines: [{ id: 'k2', text: 'A & B <c>' }, { id: 'k3', text: 'suite' }] },
        z('NumberingZone', '12'),
      ],
      12
    )
    expect(xml).toBe(
      '<pb n="12"/>\n' +
        '<fw type="runningTitle"><lb/>HISTOIRE</fw>\n' +
        '<head><lb n="k1"/>Chapitre I</head>\n' +
        '<p><lb n="k2"/>A &amp; B &lt;c&gt;<lb n="k3"/>suite</p>\n' +
        '<fw type="numbering"><lb/>12</fw>'
    )
    expect(wellFormed(xml)).toBe(true)
  })

  it('merges a Continued zone into the previous page\'s paragraph, page break and running title included', () => {
    const xml = convertLadasPages([
      { n: 1, zones: [z('MainZone-P', 'début du'), z('NumberingZone', '1')] },
      { n: 2, zones: [z('RunningTitleZone', 'TITRE'), z('MainZone-Continued', 'paragraphe.'), z('MainZone-P', 'Nouveau.')] },
    ])
    expect(oneLine(xml)).toBe(
      '<pb n="1"/>' +
        '<p><lb/>début du<pb n="2"/><fw type="runningTitle"><lb/>TITRE</fw><lb/>paragraphe.</p>' +
        '<fw type="numbering"><lb/>1</fw>' +
        '<p><lb/>Nouveau.</p>'
    )
  })

  it('keeps a Continued zone with nothing to continue as <ab rend="continued">, and a heading ends the text', () => {
    expect(oneLine(convertLadasZones([z('MainZone-Continued', 'orphelin')], 1))).toBe('<pb n="1"/><ab rend="continued"><lb/>orphelin</ab>')
    const xml = convertLadasPages([
      { n: 1, zones: [z('MainZone-P', 'texte'), z('MainZone-Head', 'Titre')] },
      { n: 2, zones: [z('MainZone-Continued', 'suite')] },
    ])
    expect(xml).toContain('<ab rend="continued"><lb/>suite</ab>')
  })

  it('groups consecutive items in one list, and verse lines in <l>', () => {
    const xml = convertLadasZones([z('MainZone-Item', '— un ;'), z('MainZone-Item', '— deux.'), z('MainZone-Lg', 'Arma virumque', 'cano')], 1)
    expect(oneLine(xml)).toBe(
      '<pb n="1"/>' +
        '<list><item><lb/>— un ;</item><item><lb/>— deux.</item></list>' +
        '<lg><l><lb/>Arma virumque</l><l><lb/>cano</l></lg>'
    )
  })

  it('nests a caption inside the figure around it', () => {
    const xml = convertLadasZones(
      [
        { type: 'GraphicZone-Head', rect: { x: 10, y: 90, width: 80, height: 10 }, lines: [{ text: 'Fig. 1' }] },
        { type: 'GraphicZone', rect: { x: 0, y: 0, width: 100, height: 110 }, lines: [] },
        z('MainZone-P', 'Texte'),
      ],
      1
    )
    expect(oneLine(xml)).toBe('<pb n="1"/><figure><head><lb/>Fig. 1</head></figure><p><lb/>Texte</p>')
  })

  it('glues a drop capital to the next line and drops noise', () => {
    const xml = convertLadasZones([z('DropCapitalZone', 'L'), z('CustomZone-Noise', '~~'), z('MainZone-P', 'orem ipsum')], 1)
    expect(oneLine(xml)).toBe('<pb n="1"/><p><lb/>Lorem ipsum</p>')
  })

  it('the well-formedness check catches broken XML', () => {
    expect(wellFormed('<p>a</b>')).toBe(false)
  })

  it('produces well-formed XML for every label of the vocabulary', () => {
    const types = [
      'MainZone-Head', 'MainZone-HeadStructured', 'MainZone-P', 'MainZone-PLabelled', 'MainZone-PStructured',
      'MainZone-PQuoted', 'MainZone-PStyled', 'MainZone-Item', 'MainZone-Lg', 'MainZone-Address', 'MainZone-Signed',
      'MainZone-Ab', 'MainZone-Continued', 'MainZone-Maths', 'MainZone-Dateline', 'MarginTextZone-P',
      'MarginTextZone-Item', 'MarginTextZone-Lg', 'MarginTextZone-ManuscriptAddendum', 'TitlePageZone-Ab',
      'GraphicZone', 'GraphicZone-Part', 'FigureZone', 'TableZone', 'FormZone-Field', 'MusicZone',
      'DigitizationArtefactZone', 'NumberingZone', 'RunningTitleZone', 'StampZone', 'QuireMarksZone', 'unknown',
    ]
    const xml = convertLadasZones(types.map((t) => z(t, `${t} & text`)), 1)
    expect(wellFormed(xml)).toBe(true)
  })
})
