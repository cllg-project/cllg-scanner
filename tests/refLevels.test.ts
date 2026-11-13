import { describe, it, expect } from 'vitest'
import { annotateRefLevels, classifyRefLevel, type FlatLevel } from '../src/shared/refLevels'
import { runMd2Tei } from '../src/main/ipc/md2tei'
import { hasMasking, isVisible } from '../src/shared/pageMask'

const lv = (depth: number, pattern: string, extra: Partial<FlatLevel> = {}): FlatLevel => ({ depth, name: `l${depth}`, pattern, ...extra })

describe('classifyRefLevel', () => {
  it('gives level 1 to anything when there is a single level', () => {
    expect(classifyRefLevel('whatever', [lv(1, 'Roman')])?.depth).toBe(1)
  })
  it('uses formats with several levels', () => {
    const levels = [lv(1, 'Roman'), lv(2, '\\d+')]
    expect(classifyRefLevel('IV', levels)?.depth).toBe(1)
    expect(classifyRefLevel('12', levels)?.depth).toBe(2)
    expect(classifyRefLevel('zz9', levels)).toBeNull()
  })
  it('breaks ties by sequence continuity', () => {
    const levels = [lv(1, 'Arabic'), lv(2, 'Arabic')]
    const ctx = new Map([[1, '1'], [2, '4']])
    expect(classifyRefLevel('5', levels, ctx)?.depth).toBe(2)
  })
})

describe('annotateRefLevels', () => {
  it('only touches unclassified refs', () => {
    const out = annotateRefLevels('<ref>3</ref> <ref level="2">4</ref> <ref>?</ref>', [lv(1, 'Arabic'), lv(2, 'Arabic')])
    expect(out).toContain('<ref level="1">3</ref>')
    expect(out).toContain('<ref level="2">4</ref>')
  })
})

describe('md2tei with unclassified refs', () => {
  it('opens a div for a bare ref when a single level is declared', () => {
    const xml = runMd2Tei({
      markdownText: '<lb n="k1"/><ref>1</ref> Hello world\n',
      yamlConfigText: 'structure:\n  name: section\n  format: Arabic\n',
      log: () => {},
    })
    expect(xml).toContain('<div type="section" n="1">')
  })
})

describe('pageMask', () => {
  it('hides everything outside the selection', () => {
    const page = { masks: [], selections: [{ x: 10, y: 10, width: 100, height: 100, fill: '#fff' }] }
    expect(hasMasking(page)).toBe(true)
    expect(isVisible(page, 50, 50)).toBe(true)
    expect(isVisible(page, 200, 50)).toBe(false)
  })
  it('keeps legacy masks hiding their rectangle', () => {
    const page = { masks: [{ x: 0, y: 0, width: 10, height: 10, fill: '#fff' }] }
    expect(isVisible(page, 5, 5)).toBe(false)
    expect(isVisible(page, 50, 50)).toBe(true)
  })
})
