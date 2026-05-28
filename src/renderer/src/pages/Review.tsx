import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  computeDiff, computeSuggestionRanges, acceptSuggestion,
  type DiffTokens, type SuggestionRange,
} from '../utils/krakenDiff'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Page, PageStatus, HierarchyLevel, KrakenConfig } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'
import { convertBetaKey, finalSigmaFix } from '../utils/betaCode'
import BetaCodeHelper from '../components/BetaCodeHelper'
import { renderMaskedPage } from '../utils/renderMaskedPage'

interface FlatLevel { depth: number; name: string; pattern: string; color?: string }

function flattenHierarchy(levels: HierarchyLevel[]): FlatLevel[] {
  const out: FlatLevel[] = []
  function walk(node: HierarchyLevel, depth: number): void {
    out.push({ depth, name: node.name, pattern: node.pattern, color: node.color })
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  for (const l of levels) walk(l, 1)
  return out
}

const LEVEL_COLORS_DEFAULT = [
  { fg: '#c0392b' },
  { fg: '#1565c0' },
  { fg: '#2e7d32' },
  { fg: '#e65100' },
  { fg: '#6a1b9a' },
]
const LEVEL_FG_DEFAULT = '#37474f'

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null
}

function levelColor(level: FlatLevel): { bg: string; fg: string } {
  const fg = level.color ?? LEVEL_COLORS_DEFAULT[level.depth - 1]?.fg ?? LEVEL_FG_DEFAULT
  const rgb = hexToRgb(fg)
  const bg = rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.10)` : '#eceff1'
  return { fg, bg }
}

const FORMAT_RE: Record<string, RegExp> = {
  Roman:     /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i,
  Arabic:    /^\d+$/,
  Greek:     /^[Ͱ-Ͽἀ-῿]+$/,
  Alpha:     /^[a-z]{1,2}$/,
  Stephanus: /^\d+[a-e]$/,
}

function matchLevel(token: string, levels: FlatLevel[]): FlatLevel | null {
  for (const l of levels) {
    const re = FORMAT_RE[l.pattern] ?? (() => { try { return new RegExp(`^${l.pattern}$`) } catch { return null } })()
    if (re?.test(token)) return l
  }
  return null
}

const UNCLASSIFIED_REF = /<ref(?:\s+level="(?:0|)")?>(.*?)<\/ref>/gs

function annotateContent(text: string, levels: FlatLevel[]): string {
  return text.replace(UNCLASSIFIED_REF, (match, inner) => {
    const token = inner.trim()
    const level = matchLevel(token, levels)
    return level ? `<ref level="${level.depth}">${inner}</ref>` : match
  })
}

type TagInfo =
  | { kind: 'ref';    start: number; end: number; inner: string; level: string }
  | { kind: 'note';   start: number; end: number; inner: string }
  | { kind: 'self';   start: number; end: number; tag: string }
  | { kind: 'hyphen'; start: number; end: number; word: string }

function detectCursorTag(text: string, pos: number): TagInfo | null {
  const paired = /<(ref|note)([^>]*)>(.*?)<\/(ref|note)>/gs
  let m: RegExpExecArray | null
  while ((m = paired.exec(text)) !== null) {
    if (pos >= m.index && pos <= m.index + m[0].length) {
      if (m[1] === 'ref') {
        const lm = m[2].match(/level="([^"]*)"/)
        return { kind: 'ref', start: m.index, end: m.index + m[0].length, inner: m[3], level: lm ? lm[1] : '' }
      }
      return { kind: 'note', start: m.index, end: m.index + m[0].length, inner: m[3] }
    }
  }
  const self = /<(tab|lb)[^>]*\/>/g
  while ((m = self.exec(text)) !== null) {
    if (pos >= m.index && pos <= m.index + m[0].length) {
      return { kind: 'self', start: m.index, end: m.index + m[0].length, tag: m[0] }
    }
  }
  const hyphenRe = /(\p{L}+)-[ \t]+/gmu
  while ((m = hyphenRe.exec(text)) !== null) {
    if (pos >= m.index && pos <= m.index + m[0].length) {
      return { kind: 'hyphen', start: m.index, end: m.index + m[0].length, word: m[1] }
    }
  }
  return null
}

function highlightMarkdown(text: string, levelMap: Map<number, FlatLevel>): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(&lt;ref\s+level="([1-9]\d*)"&gt;)(.*?)(&lt;\/ref&gt;)/g, (_, open, n, inner, close) => {
      const lv = levelMap.get(Number(n))
      const { fg, bg } = lv ? levelColor(lv) : { fg: LEVEL_FG_DEFAULT, bg: '#eceff1' }
      return `<mark style="background:${bg};color:${fg};font-weight:600">${open}${inner}${close}</mark>`
    })
    .replace(/(&lt;ref(?:\s+level="(?:0|)")?&gt;)(.*?)(&lt;\/ref&gt;)/g,
      '<mark class="tag-ref-u">$1$2$3</mark>')
    .replace(/(&lt;note&gt;)(.*?)(&lt;\/note&gt;)/g,
      '<mark class="tag-note">$1$2$3</mark>')
    .replace(/(&lt;(?:tab\/|pb[^&]*?)&gt;)/g,
      '<mark class="tag-misc">$1</mark>')
    .replace(/^(#{1,3} .+)$/gm, '<mark class="tag-head">$1</mark>')
    .replace(/(&lt;lb[^&]*?\/&gt;)/g, '<mark class="tag-lb">$1</mark>')
    .replace(/(\p{L}+-)(?=[\t ]|&lt;|$)/gmu,
      '<mark class="tag-lb">$1</mark>')
}

// Highlight markdown with integrated wavy-underline diff suggestions.
// Uses private-use Unicode chars as placeholders that survive HTML escaping.
const DIFF_OPEN = '', DIFF_SEP = '', DIFF_CLOSE = ''
const DIFF_TOKEN_RE = new RegExp(`${DIFF_OPEN}(\\d+)${DIFF_SEP}([\\s\\S]*?)${DIFF_CLOSE}`, 'g')

function highlightMarkdownWithDiff(
  text: string,
  levelMap: Map<number, FlatLevel>,
  ranges: SuggestionRange[]
): string {
  if (!ranges.length) return highlightMarkdown(text, levelMap)

  const starts = new Map<number, number>()
  const ends = new Set<number>()
  for (const r of ranges) { starts.set(r.origStart, r.tokenIdx); ends.add(r.origEnd) }

  let marked = '', inMark = false
  for (let pos = 0; pos < text.length; pos++) {
    if (ends.has(pos) && inMark) { marked += DIFF_CLOSE; inMark = false }
    if (starts.has(pos)) { marked += `${DIFF_OPEN}${starts.get(pos)!}${DIFF_SEP}`; inMark = true }
    marked += text[pos]
  }
  if (inMark) marked += DIFF_CLOSE

  let html = marked.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  html = html
    .replace(/(&lt;ref\s+level="([1-9]\d*)"&gt;)(.*?)(&lt;\/ref&gt;)/g, (_, open, n, inner, close) => {
      const lv = levelMap.get(Number(n))
      const { fg, bg } = lv ? levelColor(lv) : { fg: LEVEL_FG_DEFAULT, bg: '#eceff1' }
      return `<mark style="background:${bg};color:${fg};font-weight:600">${open}${inner}${close}</mark>`
    })
    .replace(/(&lt;ref(?:\s+level="(?:0|)")?&gt;)(.*?)(&lt;\/ref&gt;)/g,
      '<mark class="tag-ref-u">$1$2$3</mark>')
    .replace(/(&lt;note&gt;)(.*?)(&lt;\/note&gt;)/g,
      '<mark class="tag-note">$1$2$3</mark>')
    .replace(/(&lt;(?:tab\/|pb[^&]*?)&gt;)/g,
      '<mark class="tag-misc">$1</mark>')
    .replace(/^(#{1,3} .+)$/gm, '<mark class="tag-head">$1</mark>')
    .replace(/(&lt;lb[^&]*?\/&gt;)/g, '<mark class="tag-lb">$1</mark>')
    .replace(/(\p{L}+-)(?=[\t ]|&lt;|$)/gmu, '<mark class="tag-lb">$1</mark>')
  html = html.replace(DIFF_TOKEN_RE, (_, tokenIdx, inner) =>
    `<mark class="diff-suggestion" data-token="${tokenIdx}">${inner}</mark>`)
  return html
}

interface ScanInfo {
  total: number
  matched: number
  byLevel: { depth: number; name: string; tokens: string[] }[]
  unmatched: string[]
}

interface PageState {
  content: string
  dirty: boolean
  loaded: boolean
  original: string
  history: string[]
  historyIdx: number
}

function makePageState(content: string): PageState {
  return { content, dirty: false, loaded: true, original: content, history: [content], historyIdx: 0 }
}

const CURRENT_STEP = 5

export default function Review(): React.JSX.Element {
  const { t } = useTranslation()
  const STEP_LABELS = [t('steps.import'), t('steps.mask'), t('steps.ocr'), t('steps.config'), t('steps.review'), t('steps.tei')]
  const STATUS_OPTS: { value: PageStatus; label: string; dot: string }[] = [
    { value: 'ocr_done', label: t('review.statusDone'), dot: '#5a8c3f' },
    { value: 'pending',  label: t('review.statusPending'), dot: '' },
    { value: 'error',    label: t('review.statusNeedsAttention'), dot: '#b04a3a' },
    { value: 'skipped',  label: t('review.statusSkipped'), dot: '' },
  ]
  const { project, saveProject } = useProject()
  const navigate = useNavigate()

  const activePages: Page[] = (project?.pages ?? []).filter(
    (p) => p.status !== 'skipped'
  )

  const [currentIdx, setCurrentIdx] = useState(0)
  const [pages, setPages] = useState<Map<number, PageState>>(new Map())
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [cursorTag, setCursorTag] = useState<TagInfo | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null)
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('review:fontSize')
    return saved ? parseInt(saved, 10) : 13
  })
  const [betaMode, setBetaMode] = useState(false)
  const [betaHelpVisible, setBetaHelpVisible] = useState(() => localStorage.getItem('review:betaHelp') !== 'false')
  const betaPendingRef = useRef<Set<string>>(new Set())
  const sigmaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [imgZoom, setImgZoom] = useState(1.0)
  const [imgNaturalWidth, setImgNaturalWidth] = useState<number | null>(null)
  const [imgNaturalHeight, setImgNaturalHeight] = useState<number | null>(null)
  const imageContainerRef = useRef<HTMLDivElement>(null)

  const [compareMode, setCompareMode] = useState(false)
  const [krakenCompareText, setKrakenCompareText] = useState<string | null>(null)
  const [krakenLines, setKrakenLines] = useState<{ text: string; corners: [number, number][] }[]>([])
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const krakenCacheRef = useRef<Map<string, { text: string; lines: { text: string; corners: [number, number][] }[] }>>(new Map())
  const [activeSuggestion, setActiveSuggestion] = useState<SuggestionRange | null>(null)
  const [ignoredTokens, setIgnoredTokens] = useState<Set<number>>(new Set())

  // UI state
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [pageInput, setPageInput] = useState<string | null>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  // Re-OCR panel
  const [reOcrOpen, setReOcrOpen] = useState(false)
  const [reOcrEngine, setReOcrEngine] = useState<'lm' | 'kraken'>('kraken')
  const [reOcrRunning, setReOcrRunning] = useState(false)
  const [reOcrError, setReOcrError] = useState<string | null>(null)
  const [krakenPaths, setKrakenPaths] = useState<KrakenConfig>({
    segModelPath: '',
    recModelPath: '',
    builtinModels: true,
  })

  const levelList = flattenHierarchy(project?.hierarchy ?? [])
  const levelMap = new Map(levelList.map((l) => [l.depth, l]))

  const currentPage = activePages[currentIdx] ?? null

  const loadPage = useCallback(
    async (page: Page) => {
      if (!project) return
      if (pages.has(page.n)) return
      const content = await window.api.loadMarkdown(project.projectDir, page.n)
      // loadMarkdown returns '' when file is missing; fall back to page.markdown (used by tour demo)
      setPages((prev) => new Map(prev).set(page.n, makePageState(content || page.markdown || '')))
    },
    [project, pages]
  )

  useEffect(() => {
    if (!currentPage) return
    loadPage(currentPage)
    if (activePages[currentIdx - 1]) loadPage(activePages[currentIdx - 1])
    if (activePages[currentIdx + 1]) loadPage(activePages[currentIdx + 1])
  }, [currentIdx, currentPage]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!currentPage || !project) return
    setImageUrl(null)
    const imgPath = currentPage.maskedImagePath ?? currentPage.imagePath
    window.api.joinPaths(project.projectDir, imgPath)
      .then((abs) => window.api.loadImageAsDataUrl(abs))
      .then(setImageUrl)
      .catch(() => setImageUrl(null))
  }, [currentPage, project])

  const autoGrow = useCallback((): void => {
    const ta = textareaRef.current
    const sc = scrollContainerRef.current
    if (!ta || !sc) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(ta.scrollHeight, sc.clientHeight)}px`
  }, [])

  const currentState = currentPage ? pages.get(currentPage.n) : undefined
  const content = currentState?.content ?? ''

  const krakenDiffTokens = useMemo<DiffTokens>(() => {
    if (!krakenCompareText) return []
    return computeDiff(content, krakenCompareText)
  }, [content, krakenCompareText])

  const suggestionRanges = useMemo<SuggestionRange[]>(() => {
    if (!compareMode || !krakenDiffTokens.length) return []
    return computeSuggestionRanges(content, krakenDiffTokens).filter((r) => !ignoredTokens.has(r.tokenIdx))
  }, [compareMode, krakenDiffTokens, content, ignoredTokens])

  useEffect(() => { setActiveSuggestion(null); setIgnoredTokens(new Set()) }, [krakenDiffTokens])

  // Find which Kraken line the active suggestion's replacement text falls in
  const activeSuggestionLineIdx = useMemo<number | null>(() => {
    if (!activeSuggestion || !krakenCompareText || !krakenDiffTokens.length) return null
    let krakenPos = 0
    for (let i = 0; i < activeSuggestion.tokenIdx; i++) {
      const t = krakenDiffTokens[i]
      if (!t.removed) krakenPos += t.value.length
    }
    const lines = krakenCompareText.split('\n')
    let acc = 0
    for (let i = 0; i < lines.length; i++) {
      acc += lines[i].length + 1
      if (krakenPos < acc) return i
    }
    return lines.length - 1
  }, [activeSuggestion, krakenCompareText, krakenDiffTokens])

  useEffect(() => { autoGrow() }, [content, compareMode])

  const setContent = (value: string): void => {
    if (!currentPage) return
    setPages((prev) => {
      const next = new Map(prev)
      const s = next.get(currentPage.n) ?? makePageState('')
      const trimmed = s.history.slice(0, s.historyIdx + 1)
      trimmed.push(value)
      next.set(currentPage.n, {
        ...s,
        content: value,
        dirty: value !== s.original,
        history: trimmed,
        historyIdx: trimmed.length - 1
      })
      return next
    })
  }

  const undo = useCallback((): void => {
    if (!currentPage) return
    setPages((prev) => {
      const next = new Map(prev)
      const s = next.get(currentPage.n)
      if (!s || s.historyIdx <= 0) return prev
      const newIdx = s.historyIdx - 1
      const newContent = s.history[newIdx]
      next.set(currentPage.n, { ...s, content: newContent, historyIdx: newIdx, dirty: newContent !== s.original })
      return next
    })
  }, [currentPage])

  const redo = useCallback((): void => {
    if (!currentPage) return
    setPages((prev) => {
      const next = new Map(prev)
      const s = next.get(currentPage.n)
      if (!s || s.historyIdx >= s.history.length - 1) return prev
      const newIdx = s.historyIdx + 1
      const newContent = s.history[newIdx]
      next.set(currentPage.n, { ...s, content: newContent, historyIdx: newIdx, dirty: newContent !== s.original })
      return next
    })
  }, [currentPage])

  const restore = useCallback((): void => {
    if (!currentPage) return
    setPages((prev) => {
      const next = new Map(prev)
      const s = next.get(currentPage.n)
      if (!s) return prev
      const trimmed = s.history.slice(0, s.historyIdx + 1)
      trimmed.push(s.original)
      next.set(currentPage.n, {
        ...s,
        content: s.original,
        dirty: false,
        history: trimmed,
        historyIdx: trimmed.length - 1
      })
      return next
    })
  }, [currentPage])

  const resetCache = useCallback(async () => {
    if (!project || !currentPage) return
    await window.api.deletePageCache(project.projectDir, currentPage.n)
    setPages((prev) => {
      const next = new Map(prev)
      next.delete(currentPage.n)
      return next
    })
  }, [project, currentPage])

  const setPageStatus = useCallback(async (status: PageStatus) => {
    if (!project || !currentPage) return
    const updatedPages = project.pages.map((p) =>
      p.n === currentPage.n ? { ...p, status } : p
    )
    await saveProject({ ...project, pages: updatedPages })
  }, [project, currentPage, saveProject])

  const toggleExample = useCallback(async () => {
    if (!project || !currentPage) return
    const updatedPages = project.pages.map((p) =>
      p.n === currentPage.n ? { ...p, isExample: !p.isExample } : p
    )
    await saveProject({ ...project, pages: updatedPages })
  }, [project, currentPage, saveProject])

  const saveCurrent = useCallback(async () => {
    if (!project || !currentPage || !currentState?.dirty) return
    setSaving(true)
    try {
      await window.api.saveMarkdown(project.projectDir, currentPage.n, content)
      setPages((prev) => {
        const next = new Map(prev)
        next.set(currentPage.n, { ...currentState, dirty: false })
        return next
      })
      setSaveMsg('saved')
      setTimeout(() => setSaveMsg(''), 1800)
    } finally {
      setSaving(false)
    }
  }, [project, currentPage, currentState, content])

  const updateCursorTag = (): void => {
    const ta = textareaRef.current
    if (!ta) return
    setCursorTag(detectCursorTag(ta.value, ta.selectionStart))
  }

  const closePopover = (): void => setCursorTag(null)

  const snapRefToSegment = useCallback((): void => {
    if (!currentPage || !cursorTag || cursorTag.kind !== 'ref') return
    const refText = content.slice(cursorTag.start, cursorTag.end)
    const before = content.slice(0, cursorTag.start)
    const after = content.slice(cursorTag.end)
    const tabMatches = [...before.matchAll(/<tab\/>/g)]
    const lastTab = tabMatches[tabMatches.length - 1]
    const insertAt = lastTab
      ? lastTab.index! + '<tab/>'.length
      : (before.lastIndexOf('\n') + 1)
    const newBefore = content.slice(0, insertAt)
    const between = content.slice(insertAt, cursorTag.start)
    setContent(newBefore + refText + between + after)
    closePopover()
  }, [content, currentPage, cursorTag]) // eslint-disable-line react-hooks/exhaustive-deps

  const runScan = useCallback((): void => {
    const byLevel = new Map<number, { depth: number; name: string; tokens: string[] }>()
    const unmatched: string[] = []
    let total = 0
    const re = new RegExp(UNCLASSIFIED_REF.source, 'gs')
    for (const m of content.matchAll(re)) {
      const tok = m[1].trim()
      if (!tok) continue
      total++
      const level = matchLevel(tok, levelList)
      if (level) {
        if (!byLevel.has(level.depth)) byLevel.set(level.depth, { depth: level.depth, name: level.name, tokens: [] })
        const entry = byLevel.get(level.depth)!
        if (!entry.tokens.includes(tok)) entry.tokens.push(tok)
      } else {
        if (!unmatched.includes(tok)) unmatched.push(tok)
      }
    }
    setScanInfo({
      total,
      matched: total - unmatched.length,
      byLevel: Array.from(byLevel.values()).sort((a, b) => a.depth - b.depth),
      unmatched,
    })
  }, [content, levelList])

  const applyAnnotations = useCallback((): void => {
    setContent(annotateContent(content, levelList))
    setScanInfo(null)
  }, [content, levelList]) // eslint-disable-line react-hooks/exhaustive-deps

  const replaceAllHyphens = useCallback((): void => {
    setContent(content.replace(/(\p{L}+)-[ \t]+/gmu, '$1<lb break="no"/>'))
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps

  const hyphenCount = (content.match(/\p{L}+-[ \t]/gmu) ?? []).length

  const replaceTag = (start: number, end: number, replacement: string): void => {
    setContent(content.slice(0, start) + replacement + content.slice(end))
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const insertTag = (open: string, close: string): void => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.slice(start, end)
    const newContent = content.slice(0, start) + open + selected + close + content.slice(end)
    setContent(newContent)
    setTimeout(() => {
      ta.selectionStart = start + open.length
      ta.selectionEnd = start + open.length + selected.length
      ta.focus()
    }, 0)
  }

  useEffect(() => {
    if (!currentState?.dirty) return
    const t = setTimeout(() => saveCurrent(), 1500)
    return () => clearTimeout(t)
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdowns on outside click
  useEffect(() => {
    if (!statusMenuOpen && !moreMenuOpen) return
    const handler = (e: MouseEvent): void => {
      if (statusMenuOpen && statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false)
      }
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statusMenuOpen, moreMenuOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const inTextarea = document.activeElement === textareaRef.current

      if (e.key === 'Escape') {
        if (cursorTag) { closePopover(); return }
        if (statusMenuOpen) { setStatusMenuOpen(false); return }
        if (moreMenuOpen) { setMoreMenuOpen(false); return }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveCurrent()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        redo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setBetaMode((m) => !m)
        betaPendingRef.current.clear()
        return
      }

      if (!inTextarea) return

      if (e.key === 'Tab') {
        e.preventDefault()
        insertTag('<tab/>', '')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault()
        insertTag('<ref level="">', '</ref>')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault()
        insertTag('<note>', '</note>')
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveCurrent, undo, redo, cursorTag, statusMenuOpen, moreMenuOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const canUndo = (currentState?.historyIdx ?? 0) > 0
  const canRedo = (currentState?.historyIdx ?? 0) < (currentState?.history.length ?? 1) - 1

  const scheduleSigmaFix = useCallback(() => {
    if (sigmaTimerRef.current) clearTimeout(sigmaTimerRef.current)
    sigmaTimerRef.current = setTimeout(() => {
      if (!currentPage) return
      setPages((prev) => {
        const s = prev.get(currentPage.n)
        if (!s) return prev
        const fixed = finalSigmaFix(s.content)
        if (fixed === s.content) return prev
        const next = new Map(prev)
        const trimmed = s.history.slice(0, s.historyIdx + 1)
        trimmed.push(fixed)
        next.set(currentPage.n, { ...s, content: fixed, dirty: fixed !== s.original, history: trimmed, historyIdx: trimmed.length - 1 })
        return next
      })
    }, 1000)
  }, [currentPage])

  useEffect(() => {
    return () => { if (sigmaTimerRef.current) clearTimeout(sigmaTimerRef.current) }
  }, [betaMode, currentPage])

  useEffect(() => {
    setImgZoom(1.0); setImgNaturalWidth(null); setImgNaturalHeight(null)
    setCompareMode(false)
    setKrakenCompareText(null); setKrakenLines([]); setCompareError(null); setActiveSuggestion(null)
  }, [currentIdx])

  useEffect(() => {
    const el = imageContainerRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.15 : 0.15
      setImgZoom((prev) => Math.min(7.5,Math.max(0.2, parseFloat((prev + delta).toFixed(2)))))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  const handleBetaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!betaMode) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const result = convertBetaKey(e.key, betaPendingRef.current)
    if (result.isPending) { e.preventDefault(); return }
    if (result.char !== null) {
      e.preventDefault()
      const ta = textareaRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const raw = ta.value.slice(0, start) + result.char + ta.value.slice(end)
      setContent(raw)
      scheduleSigmaFix()
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const newPos = start + result.char!.length
          textareaRef.current.selectionStart = newPos
          textareaRef.current.selectionEnd = newPos
        }
      })
    }
  }, [betaMode, scheduleSigmaFix]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.api.getKrakenBuiltinPaths().then((paths) =>
      setKrakenPaths({ segModelPath: paths.segModelPath, recModelPath: paths.recModelPath, builtinModels: true })
    )
  }, [])

  const runReOcr = useCallback(async () => {
    if (!project || !currentPage) return
    setReOcrRunning(true)
    setReOcrError(null)
    try {
      let imgPath: string
      if (currentPage.masks.length > 0) {
        imgPath = await window.api.joinPaths(project.projectDir, await renderMaskedPage(project.projectDir, currentPage))
      } else {
        imgPath = await window.api.joinPaths(
          project.projectDir,
          currentPage.maskedImagePath ?? currentPage.imagePath
        )
      }
      let result: { text: string }
      if (reOcrEngine === 'kraken') {
        result = await window.api.rerunPageKraken(imgPath, krakenPaths)
      } else {
        result = await window.api.rerunPageLM(imgPath, project.lmConfig)
      }
      setContent(result.text)
      await window.api.saveMarkdown(project.projectDir, currentPage.n, result.text)
      const updatedPages = project.pages.map((p) =>
        p.n === currentPage.n ? { ...p, status: 'ocr_done' as const } : p
      )
      await saveProject({ ...project, pages: updatedPages })
      setReOcrOpen(false)
    } catch (err: unknown) {
      setReOcrError(String(err))
    } finally {
      setReOcrRunning(false)
    }
  }, [project, currentPage, reOcrEngine, krakenPaths, saveProject]) // eslint-disable-line react-hooks/exhaustive-deps

  const runKrakenCompare = useCallback(async () => {
    if (!project || !currentPage) return
    const cacheKey = `${currentPage.imagePath}|${JSON.stringify(currentPage.masks)}`
    const cached = krakenCacheRef.current.get(cacheKey)
    if (cached) {
      setKrakenLines(cached.lines)
      setKrakenCompareText(cached.text)
      return
    }
    setCompareLoading(true); setCompareError(null); setKrakenCompareText(null)
    try {
      let imgPath: string
      if (currentPage.masks.length > 0) {
        imgPath = await window.api.joinPaths(project.projectDir, await renderMaskedPage(project.projectDir, currentPage))
      } else {
        imgPath = await window.api.joinPaths(project.projectDir, currentPage.maskedImagePath ?? currentPage.imagePath)
      }
      const result = await window.api.rerunPageKraken(imgPath, krakenPaths)
      const text = result.text.normalize('NFKC')
      const lines = result.lines ?? []
      krakenCacheRef.current.set(cacheKey, { text, lines })
      setKrakenLines(lines)
      setKrakenCompareText(text)
    } catch (err: unknown) {
      setCompareError(String(err))
    } finally {
      setCompareLoading(false)
    }
  }, [project, currentPage, krakenPaths]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <div className="p-8">{t('common.noProjectOpen')}</div>
  if (activePages.length === 0) {
    return (
      <div className="flex h-full">
        <Sidebar collapsed />
        <main className="flex-1 flex items-center justify-center" style={{ background: 'var(--paper-2)' }}>
          <div className="text-center">
            <div className="font-serif text-[20px] mb-2">{t('review.noProcessedPages')}</div>
            <div className="text-[13px] mb-5" style={{ color: 'var(--mute)' }}>{t('review.noProcessedSubtitle')}</div>
            <button className="btn btn-primary" onClick={() => navigate('/ocr')}>{t('review.backToOcr')}</button>
          </div>
        </main>
      </div>
    )
  }

  const currentStatus = currentPage?.status ?? 'pending'
  const statusOpt = STATUS_OPTS.find((o) => o.value === currentStatus) ?? STATUS_OPTS[1]

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--paper-2)' }}>

        {/* ── Global header ── */}
        <div className="px-6 pt-5 pb-3 border-b shrink-0" style={{ borderColor: 'var(--line)' }}>
          {/* Step rail */}
          <div className="flex items-center gap-1.5 mb-3" style={{ fontSize: 10, color: 'var(--mute)' }}>
            <span className="text-[10px] tracking-[.18em] uppercase mr-1 font-mono" style={{ color: 'var(--mute-2)' }}>{t('common.step')}</span>
            {STEP_LABELS.map((label, i) => {
              const n = i + 1
              const isDone = n < CURRENT_STEP
              const isCurrent = n === CURRENT_STEP
              return (
                <React.Fragment key={n}>
                  <span
                    className="inline-flex items-center justify-center rounded-full text-[9px] font-semibold"
                    style={{
                      width: 14, height: 14, border: '1px solid',
                      background: isDone ? 'var(--moss-bg)' : isCurrent ? 'var(--oxblood)' : 'var(--paper-3)',
                      borderColor: isDone ? '#b8c8a0' : isCurrent ? 'var(--oxblood-2)' : 'var(--line-2)',
                      color: isDone ? 'var(--moss)' : isCurrent ? '#fbf3e3' : 'var(--mute)'
                    }}
                  >
                    {isDone
                      ? <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="m5 12 5 5 9-12" /></svg>
                      : n}
                  </span>
                </React.Fragment>
              )
            })}
            <span className="flex-1 h-px mx-1" style={{ background: 'var(--line-2)' }} />
            <span className="text-[11px]" style={{ color: 'var(--mute)' }}>
              {STEP_LABELS.map((l, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  <span style={i + 1 === CURRENT_STEP ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>{l}</span>
                </span>
              ))}
            </span>
          </div>
          {/* Title + Next */}
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <h2 className="font-serif text-[26px] leading-none">{t('review.title')}</h2>
              <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--mute)' }}>
                {t('review.subtitle')}{' '}
                <span className="font-mono" style={{ color: 'var(--ink)' }}>pages/page_NNNN.md</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="btn btn-primary" onClick={() => navigate('/export')}>
                {t('review.nextTeiExport')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Slim page bar ── */}
        <div
          className="px-6 py-2 border-b flex items-center gap-3 shrink-0"
          style={{ borderColor: 'var(--line)', background: 'var(--paper-2)' }}
        >
          {/* Page nav */}
          <div className="flex items-center gap-1">
            <button
              className="btn btn-quiet"
              style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }}
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx((i) => i - 1)}
              title={t('review.previousPage')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 6-6 6 6 6" /></svg>
            </button>
            {pageInput !== null ? (
              <input
                type="text"
                value={pageInput}
                autoFocus
                className="font-mono text-[12.5px] px-2 py-1 rounded text-center outline-none"
                style={{ width: 72, background: 'var(--paper-3)', border: '1px solid var(--oxblood)', fontVariantNumeric: 'tabular-nums' }}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => {
                  const n = parseInt(pageInput, 10)
                  const idx = activePages.findIndex((p) => p.n === n)
                  if (idx >= 0) setCurrentIdx(idx)
                  setPageInput(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const n = parseInt(pageInput, 10)
                    const idx = activePages.findIndex((p) => p.n === n)
                    if (idx >= 0) setCurrentIdx(idx)
                    setPageInput(null)
                  }
                  if (e.key === 'Escape') setPageInput(null)
                }}
              />
            ) : (
              <button
                className="font-mono text-[12.5px] px-2 py-1 rounded"
                style={{ background: 'var(--paper-3)', fontVariantNumeric: 'tabular-nums' }}
                onClick={() => setPageInput(String(currentPage?.n ?? 1))}
                title={t('review.jumpToPage')}
              >
                <span className="font-semibold">p. {currentPage?.n ?? '–'}</span>
                <span style={{ color: 'var(--mute)' }}> / {activePages.length}</span>
              </button>
            )}
            <button
              className="btn btn-quiet"
              style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }}
              disabled={currentIdx === activePages.length - 1}
              onClick={() => setCurrentIdx((i) => i + 1)}
              title={t('review.nextPage')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>

          <div className="w-px h-5" style={{ background: 'var(--line)' }} />

          {/* Status dropdown */}
          <div ref={statusMenuRef} className="relative">
            <button
              className="btn border text-[12px]"
              style={{
                borderColor: currentStatus === 'ocr_done' ? '#b8c8a0' : currentStatus === 'error' ? '#d9a0a0' : 'var(--line-2)',
                background: currentStatus === 'ocr_done' ? 'var(--moss-bg)' : currentStatus === 'error' ? '#f1d6cf' : 'var(--paper-3)',
                color: currentStatus === 'ocr_done' ? '#3b5a30' : currentStatus === 'error' ? '#7a2a23' : 'var(--mute)',
                gap: 6
              }}
              onClick={() => setStatusMenuOpen((v) => !v)}
            >
              {statusOpt.dot
                ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusOpt.dot }} />
                : <span className="w-1.5 h-1.5 rounded-full border" style={{ borderColor: 'var(--mute-2)' }} />}
              {statusOpt.label}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ opacity: 0.7 }}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {statusMenuOpen && (
              <div className="absolute" style={{ top: 'calc(100% + 6px)', left: 0, minWidth: 200, background: 'var(--paper-2)', border: '1px solid var(--line-2)', borderRadius: 7, boxShadow: '0 12px 30px -10px rgba(40,30,20,.25)', padding: 4, fontSize: 12, zIndex: 20 }}>
                <div className="px-2 py-1 text-[10px] tracking-[.12em] uppercase font-semibold" style={{ color: 'var(--mute)' }}>{t('review.pageStatus')}</div>
                {STATUS_OPTS.map((opt) => (
                  <button key={opt.value}
                    className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-[color:var(--paper-3)]"
                    style={{ background: currentStatus === opt.value ? 'var(--paper-3)' : undefined }}
                    onClick={() => { setPageStatus(opt.value); setStatusMenuOpen(false) }}
                  >
                    {opt.dot
                      ? <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: opt.dot }} />
                      : <span className="w-1.5 h-1.5 rounded-full border shrink-0" style={{ borderColor: 'var(--mute-2)' }} />}
                    {opt.label}
                    {currentStatus === opt.value && (
                      <svg className="ml-auto" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 5 5 9-12" /></svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Example toggle */}
          {currentPage && (
            <button
              className="btn border text-[12px]"
              style={currentPage.isExample
                ? { borderColor: '#d9c688', background: '#fbf2dc', color: '#8a6a18', gap: 5 }
                : { borderColor: 'var(--line-2)', background: 'transparent', color: 'var(--mute)', gap: 5 }}
              onClick={toggleExample}
              title={currentPage.isExample ? t('review.removeFromExamples') : t('review.markAsExample')}
            >
              <span style={{ color: currentPage.isExample ? '#c89328' : 'var(--mute-2)' }}>★</span>
              {t('review.exampleToggle')}
            </button>
          )}

          {/* Save status */}
          <div className="text-[11.5px] font-mono" style={{ color: 'var(--mute)' }}>
            {currentState?.dirty && <span style={{ color: 'var(--amber, #c89328)' }}>{t('common.unsaved')}</span>}
            {saveMsg && <span style={{ color: 'var(--moss, #5a8c3f)' }}>{t('common.saved')}</span>}
          </div>

          {/* Undo / Redo / Save — right side */}
          <div className="ml-auto flex items-center gap-1">
            <button className="btn btn-quiet" style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }} disabled={!canUndo} onClick={undo} title={t('review.undo')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
            </button>
            <button className="btn btn-quiet" style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }} disabled={!canRedo} onClick={redo} title={t('review.redo')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
            </button>
            <div className="w-px h-4 mx-1" style={{ background: 'var(--line-2)' }} />
            <button
              className="btn btn-ghost"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={saveCurrent}
              disabled={saving || !currentState?.dirty}
            >
              {saving ? t('review.saving') : t('review.save')}
              <span className="font-mono text-[10px] opacity-60 ml-0.5">⌘S</span>
            </button>
          </div>
        </div>

        {/* Scan results */}
        {scanInfo !== null && (
          <div
            className="px-6 py-2.5 border-b shrink-0 flex items-center gap-4 text-[11.5px] flex-wrap"
            style={{ borderColor: 'var(--line)', background: '#f0f9ff' }}
          >
            <span className="font-mono font-semibold shrink-0" style={{ color: '#0369a1' }}>
              {scanInfo.total !== 1 ? t('review.unclassifiedRefs', { count: scanInfo.total }) : t('review.unclassifiedRef', { count: scanInfo.total })}
            </span>
            {scanInfo.total === 0 ? (
              <span style={{ color: 'var(--mute)' }}>{t('review.noUnclassified')}</span>
            ) : (
              <>
                {scanInfo.byLevel.map((l) => (
                  <span key={l.depth} className="font-mono shrink-0" style={{ color: 'var(--ink)' }}>
                    <span className="font-semibold" style={{ color: 'var(--oxblood)' }}>L{l.depth} {l.name}:</span>{' '}
                    {l.tokens.slice(0, 6).join(', ')}{l.tokens.length > 6 ? ` +${l.tokens.length - 6}` : ''}
                  </span>
                ))}
                {scanInfo.unmatched.length > 0 && (
                  <span className="font-mono shrink-0" style={{ color: '#7b2d8b' }}>
                    <span className="font-semibold">{t('review.unmatched')}:</span>{' '}
                    {scanInfo.unmatched.slice(0, 5).join(', ')}{scanInfo.unmatched.length > 5 ? ` +${scanInfo.unmatched.length - 5}` : ''}
                  </span>
                )}
                <button
                  className="btn btn-quiet text-[11px] shrink-0"
                  style={{ background: '#0369a1', color: '#fff', borderColor: '#0369a1', padding: '3px 10px' }}
                  onClick={applyAnnotations}
                >
                  {t('review.annotateMatched', { count: scanInfo.matched })}
                </button>
              </>
            )}
            <button className="tool-btn ml-auto shrink-0" style={{ width: 20, height: 20 }} onClick={() => setScanInfo(null)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Re-OCR panel */}
        {reOcrOpen && (
          <div
            className="px-6 py-3 border-b shrink-0 flex items-center gap-4 flex-wrap text-[11.5px]"
            style={{ borderColor: 'var(--line)', background: '#f0f9ff' }}
          >
            <div className="flex items-center gap-1 shrink-0">
              {(['kraken', 'lm'] as const).map((eng) => (
                <button
                  key={eng}
                  className="btn btn-quiet text-[11px] shrink-0"
                  style={{ padding: '3px 10px', ...(reOcrEngine === eng ? { background: '#0369a1', color: '#fff', borderColor: '#0369a1' } : {}) }}
                  onClick={() => { setReOcrEngine(eng); setReOcrError(null) }}
                >
                  {eng === 'kraken' ? t('review.krakenEngine') : t('review.lmEngine')}
                </button>
              ))}
            </div>
            <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--mute)' }}>
              {reOcrEngine === 'kraken'
                ? t('review.krakenBuiltin')
                : t('review.lmEndpoint', { endpoint: project.lmConfig.endpoint, model: project.lmConfig.model || t('review.lmNoModel') })}
            </span>
            {reOcrError && <span className="shrink-0 text-[11px]" style={{ color: '#b04a3a' }}>{reOcrError}</span>}
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button
                className="btn btn-primary text-[11.5px]"
                style={{ padding: '5px 12px' }}
                onClick={runReOcr}
                disabled={reOcrRunning}
              >
                {reOcrRunning
                  ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.3-8.6" /></svg>{t('review.runningReOcr')}</>
                  : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>{t('review.runReOcr')}</>}
              </button>
              <button className="tool-btn" style={{ width: 20, height: 20 }} onClick={() => { setReOcrOpen(false); setReOcrError(null) }} disabled={reOcrRunning}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Editor split ── */}
        <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: '1fr 1fr' }}>

          {/* Left: image pane */}
          <div className="flex flex-col overflow-hidden border-r" style={{ borderColor: 'var(--line)' }}>
            <div className="px-3 py-1.5 border-b shrink-0 flex items-center gap-2" style={{ borderColor: 'var(--line)', background: 'var(--paper-2)' }}>
              <span className="font-mono text-[11px]" style={{ color: 'var(--mute)' }}>{t('review.source')}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button className="tool-btn" style={{ width: 22, height: 22, fontSize: 12 }}
                  onClick={() => setImgZoom((z) => Math.max(0.2, parseFloat((z - 0.15).toFixed(2))))}>−</button>
                <button
                  className="font-mono text-[11px] tabular-nums px-1 rounded"
                  style={{ minWidth: 38, textAlign: 'center', color: imgZoom !== 1 ? 'var(--oxblood)' : 'var(--mute)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                  onClick={() => setImgZoom(1.0)}
                  title={t('review.resetZoom')}
                >{Math.round(imgZoom * 100)}%</button>
                <button className="tool-btn" style={{ width: 22, height: 22, fontSize: 12 }}
                  onClick={() => setImgZoom((z) => Math.min(7.5,parseFloat((z + 0.15).toFixed(2))))}>+</button>
              </div>
            </div>
            <div
              ref={imageContainerRef}
              className="flex-1 overflow-auto flex items-start p-4"
              style={{ background: '#f5f2ec', justifyContent: 'safe center' }}
            >
              {imageUrl ? (
                <div style={{
                  position: 'relative',
                  display: 'inline-block',
                  flexShrink: 0,
                  width: imgNaturalWidth ? `${Math.round(imgNaturalWidth * imgZoom)}px` : undefined,
                  maxWidth: imgNaturalWidth ? 'none' : '100%',
                }}>
                  <img
                    src={imageUrl}
                    alt={`Page ${currentPage?.n}`}
                    className="shadow-md"
                    onLoad={(e) => {
                      const img = e.target as HTMLImageElement
                      const nw = img.naturalWidth
                      setImgNaturalWidth(nw)
                      setImgNaturalHeight(img.naturalHeight)
                      const container = imageContainerRef.current
                      if (container && nw > 0) {
                        const available = container.clientWidth - 32
                        setImgZoom(nw > available ? available / nw : 1.0)
                      }
                    }}
                    style={{
                      display: 'block',
                      border: '1px solid var(--line)',
                      width: '100%',
                    }}
                  />
                  {activeSuggestionLineIdx !== null &&
                    krakenLines[activeSuggestionLineIdx] &&
                    imgNaturalWidth && imgNaturalHeight && (() => {
                      const PAD_V = 14
                      const corners = krakenLines[activeSuggestionLineIdx].corners
                      const cy = corners.reduce((s, c) => s + c[1], 0) / corners.length
                      const padded = corners.map(([x, y]) => (
                        `${x},${y + (y < cy ? -PAD_V : PAD_V)}`
                      )).join(' ')
                      return (
                        <svg
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                          viewBox={`0 0 ${imgNaturalWidth} ${imgNaturalHeight}`}
                          preserveAspectRatio="none"
                        >
                          <polygon points={padded} fill="rgba(220,38,38,0.18)" stroke="none" />
                        </svg>
                      )
                    })()}
                </div>
              ) : (
                <div className="flex items-center justify-center w-full h-full text-[13px]" style={{ color: 'var(--mute)' }}>
                  {currentPage ? t('review.loadingPage') : t('review.noPageSelected')}
                </div>
              )}
            </div>
          </div>

          {/* Right: editor pane */}
          <div className="flex flex-col overflow-hidden" data-tour="review-editor">

            {/* Editor local toolbar */}
            <div className="border-b shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--paper-2)' }}>
              {/* Row 1: tag annotation pills + More menu */}
              <div className="px-3 py-2 flex items-center gap-1.5">
                {/* <ref> */}
                <button
                  className="inline-flex items-center gap-1.5 border rounded"
                  style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontWeight: 500, background: '#d8e2c6', borderColor: '#b8c8a0', color: '#3b5a30', lineHeight: 1 }}
                  data-tour="review-tag-ref"
                  onClick={() => insertTag('<ref level="">', '</ref>')}
                  title={t('review.tagRef')}
                >
                  &lt;ref&gt;
                  <span className="inline-flex items-center gap-0.5">
                    <span style={{ fontFamily: 'ui-monospace', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.12)', color: 'inherit' }}>⌘</span>
                    <span style={{ fontFamily: 'ui-monospace', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.12)', color: 'inherit' }}>R</span>
                  </span>
                </button>
                {/* <note> */}
                <button
                  className="inline-flex items-center gap-1.5 border rounded"
                  style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontWeight: 500, background: '#ece1f1', borderColor: '#c8b8d8', color: '#5a3b7a', lineHeight: 1 }}
                  onClick={() => insertTag('<note>', '</note>')}
                  title={t('review.tagNote')}
                >
                  &lt;note&gt;
                  <span className="inline-flex items-center gap-0.5">
                    <span style={{ fontFamily: 'ui-monospace', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.12)', color: 'inherit' }}>⌘</span>
                    <span style={{ fontFamily: 'ui-monospace', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.12)', color: 'inherit' }}>M</span>
                  </span>
                </button>
                {/* <tab/> */}
                <button
                  className="inline-flex items-center gap-1.5 border rounded"
                  style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontWeight: 500, background: '#e2ddc7', borderColor: '#d4ca9c', color: '#6b5a2b', lineHeight: 1 }}
                  onClick={() => insertTag('<tab/>', '')}
                  title={t('review.tagTab')}
                >
                  &lt;tab/&gt;
                  <span style={{ fontFamily: 'ui-monospace', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.12)', color: 'inherit' }}>Tab</span>
                </button>
                {/* <lb/> */}
                <button
                  className="inline-flex items-center border rounded"
                  style={{ padding: '4px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontWeight: 500, background: '#d6e7df', borderColor: '#adcfc1', color: '#2e5a4a', lineHeight: 1 }}
                  onClick={() => insertTag('<lb/>', '')}
                  title={t('review.tagLb')}
                >
                  &lt;lb/&gt;
                </button>

                {/* More menu — right-aligned */}
                <div ref={moreMenuRef} className="relative ml-auto">
                  <button
                    className="btn btn-quiet text-[11.5px]"
                    style={{ padding: '4px 8px' }}
                    onClick={() => setMoreMenuOpen((v) => !v)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                    {t('review.more')}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {moreMenuOpen && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 240, background: 'var(--paper-2)', border: '1px solid var(--line-2)', borderRadius: 7, boxShadow: '0 12px 30px -10px rgba(40,30,20,.25)', padding: 4, fontSize: 12, zIndex: 20 }}>
                      <div className="px-2 py-1 text-[10px] tracking-[.12em] uppercase font-semibold" style={{ color: 'var(--mute)' }}>{t('review.thisPage')}</div>
                      <button className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-[color:var(--paper-3)]"
                        onClick={() => { restore(); setMoreMenuOpen(false) }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--mute)' }}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v6h6" /></svg>
                        {t('review.restoreFromOcr')}
                      </button>
                      <button className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-[color:var(--paper-3)]"
                        onClick={() => { resetCache(); setMoreMenuOpen(false) }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--mute)' }}><rect x="4" y="6" width="16" height="14" rx="1" /><path d="M9 11h6M9 15h4" /></svg>
                        {t('review.resetCache')}
                      </button>
                      <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
                      <div className="px-2 py-1 text-[10px] tracking-[.12em] uppercase font-semibold" style={{ color: 'var(--mute)' }}>{t('review.rerunOcr')}</div>
                      <button className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-[color:var(--paper-3)]"
                        onClick={() => { setReOcrOpen((v) => !v); setReOcrError(null); setMoreMenuOpen(false) }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--mute)' }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                        {t('review.reOcrThisPage')}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: processing + view */}
              <div className="px-3 py-1.5 flex items-center gap-2 border-t" style={{ borderColor: 'var(--line)', background: '#f3ecdc' }}>
                {hyphenCount > 0 && (
                  <button
                    className="btn btn-quiet text-[11.5px]"
                    style={{ padding: '4px 8px', borderColor: '#15803d', color: '#15803d' }}
                    onClick={replaceAllHyphens}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 12h12" /><path d="M4 8v8M20 8v8" /></svg>
                    {t('review.fixHyphensCount', { count: hyphenCount })}
                  </button>
                )}
                <button
                  className="btn btn-quiet text-[11.5px]"
                  style={{ padding: '4px 8px' }}
                  onClick={runScan}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                  {t('review.scanRefs')}
                </button>

                <div className="w-px h-4" style={{ background: 'var(--line-2)' }} />

                {/* Font size */}
                <div className="flex items-center gap-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--mute)', marginRight: 2 }}>
                    <text x="2" y="16" style={{ fontSize: '14px', fontFamily: 'serif', fill: 'currentColor', stroke: 'none' }}>A</text>
                    <text x="13" y="19" style={{ fontSize: '9px', fontFamily: 'serif', fill: 'currentColor', stroke: 'none' }}>A</text>
                  </svg>
                  <button className="tool-btn" style={{ width: 22, height: 22, fontSize: 11 }}
                    onClick={() => setFontSize((s) => { const v = Math.max(10, s - 1); localStorage.setItem('review:fontSize', String(v)); return v })}>−</button>
                  <span className="font-mono text-[12px] tabular-nums text-center font-medium" style={{ width: 28, color: 'var(--ink)' }}>{fontSize}</span>
                  <button className="tool-btn" style={{ width: 22, height: 22, fontSize: 11 }}
                    onClick={() => setFontSize((s) => { const v = Math.min(32, s + 1); localStorage.setItem('review:fontSize', String(v)); return v })}>+</button>
                </div>

                <div className="w-px h-4" style={{ background: 'var(--line-2)' }} />

                {/* Betacode */}
                <div className="flex items-center gap-1">
                  <button
                    className="btn btn-quiet text-[11px]"
                    style={{ padding: '3px 7px', ...(betaMode ? { color: '#6a1b9a', borderColor: '#9c6ab0', background: '#f0eaf8' } : {}) }}
                    onClick={() => { setBetaMode((m) => !m); betaPendingRef.current.clear() }}
                    title={t('review.betacodeToggleTitle')}
                  >
                    <span style={{ fontFamily: 'serif', fontStyle: 'italic', fontSize: 14, lineHeight: 1, fontWeight: 600 }}>β</span>
                    {t('review.betacode')}
                    <span className="inline-flex gap-0.5 ml-0.5">
                      <KbdChip>⌘</KbdChip><KbdChip>K</KbdChip>
                    </span>
                  </button>
                  {betaMode && (
                    <button
                      className="btn btn-quiet text-[11px]"
                      style={{ width: 22, height: 22, padding: 0, justifyContent: 'center', fontWeight: 600, ...(betaHelpVisible ? { color: '#6a1b9a', borderColor: '#9c6ab0', background: '#f0eaf8' } : {}) }}
                      onClick={() => setBetaHelpVisible((v) => { const next = !v; localStorage.setItem('review:betaHelp', String(next)); return next })}
                      title={t('review.betacodeCheatsheet')}
                    >
                      ?
                    </button>
                  )}
                </div>

                <div className="w-px h-4 ml-auto" style={{ background: 'var(--line-2)' }} />

                {/* Compare with Kraken */}
                <button
                  data-tour="review-compare"
                  className="btn btn-quiet text-[11px]"
                  style={{ padding: '3px 8px', ...(compareMode ? { color: '#0369a1', borderColor: '#0369a1', background: '#e0f2fe' } : {}) }}
                  onClick={() => {
                    if (!compareMode) {
                      setCompareMode(true)
                      if (krakenCompareText === null && !compareLoading) runKrakenCompare()
                    } else {
                      setCompareMode(false)
                    }
                  }}
                >
                  {compareLoading
                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.3-8.6" /></svg>
                    : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" /></svg>}
                  {t('review.compare')}
                  {compareMode && suggestionRanges.length > 0 && (
                    <span style={{ marginLeft: 3, background: '#0369a1', color: '#fff', borderRadius: 8, padding: '0 5px', fontSize: 10, fontWeight: 600, lineHeight: '16px' }}>
                      {suggestionRanges.length}
                    </span>
                  )}
                </button>

              </div>
            </div>

            {/* Suggestion banner */}
            {compareMode && activeSuggestion && (
              <div className="shrink-0 border-b px-4 py-2 flex items-center gap-3 text-[12px] flex-wrap" style={{ borderColor: 'var(--line)', background: '#fff8f0' }}>
                <span className="font-mono shrink-0" style={{ color: 'var(--mute)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em' }}>{t('review.compareKraken')}</span>
                <del style={{ color: '#b91c1c', textDecoration: 'line-through', fontFamily: "'Noto Sans Mono', monospace" }}>{activeSuggestion.removedText || '(empty)'}</del>
                <span style={{ color: 'var(--mute)' }}>→</span>
                <ins style={{ color: '#15803d', textDecoration: 'none', fontFamily: "'Noto Sans Mono', monospace" }}>{activeSuggestion.addedText || t('review.suggestionDelete')}</ins>
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  <button
                    className="btn btn-quiet text-[11px]"
                    style={{ padding: '3px 10px', background: '#dcfce7', borderColor: '#15803d', color: '#15803d' }}
                    onClick={() => {
                      setContent(acceptSuggestion(content, krakenDiffTokens, activeSuggestion.tokenIdx))
                      setActiveSuggestion(null)
                    }}
                  >{t('review.suggestionAccept')}</button>
                  <button
                    className="btn btn-quiet text-[11px]"
                    style={{ padding: '3px 10px' }}
                    onClick={() => {
                      setIgnoredTokens((prev) => new Set(prev).add(activeSuggestion.tokenIdx))
                      setActiveSuggestion(null)
                    }}
                  >{t('review.suggestionDismiss')}</button>
                </div>
              </div>
            )}

            {/* Scrollable editor */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto"
              style={{ background: currentState?.loaded ? 'white' : 'var(--paper-2)' }}
            >
              <div className="relative">
                <div
                  ref={highlightRef}
                  aria-hidden="true"
                  className="absolute inset-0 px-4 pt-4 pb-10 overflow-hidden pointer-events-none leading-relaxed whitespace-pre-wrap break-words"
                  style={{ color: 'transparent', background: 'transparent', fontSize, fontFamily: "'Noto Sans Mono', monospace" }}
                  dangerouslySetInnerHTML={{ __html: compareMode && suggestionRanges.length
                    ? highlightMarkdownWithDiff(content, levelMap, suggestionRanges)
                    : highlightMarkdown(content, levelMap) }}
                />
                <textarea
                  ref={textareaRef}
                  className="relative w-full px-4 pt-4 pb-10 leading-relaxed resize-none outline-none caret-[var(--ink)]"
                  style={{ color: 'var(--ink)', background: 'transparent', overflow: 'hidden', display: 'block', fontSize, fontFamily: "'Noto Sans Mono', monospace" }}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value)
                    if (betaMode) scheduleSigmaFix()
                    updateCursorTag()
                  }}
                  onClick={(e) => {
                    updateCursorTag()
                    if (compareMode && suggestionRanges.length) {
                      const ta = e.currentTarget
                      const pos = ta.selectionStart
                      const hit = suggestionRanges.find((r) => pos >= r.origStart && pos <= r.origEnd)
                      setActiveSuggestion(hit ?? null)
                    }
                  }}
                  onKeyUp={updateCursorTag}
                  onKeyDown={handleBetaKeyDown}
                  spellCheck={false}
                  placeholder={currentState?.loaded ? '' : t('review.loadingPage')}
                />
              </div>
            </div>

            {betaMode && betaHelpVisible && (
              <div className="shrink-0 px-4 pb-2" style={{ background: 'white' }}>
                <BetaCodeHelper />
              </div>
            )}

            {/* ── Tag dock ── */}
            {cursorTag && (
              <div className="border-t shrink-0" style={{ borderColor: 'var(--line)', background: '#f3ecdc' }}>
                {/* Row 1: universal transforms */}
                <div className="px-3 py-1.5 flex items-center gap-2.5">
                  {(cursorTag.kind === 'ref' || cursorTag.kind === 'note') && (
                    <>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] uppercase tracking-[.12em] font-semibold shrink-0" style={{ color: 'var(--mute)' }}>{t('review.convert')}</span>
                        {cursorTag.kind === 'ref' && (
                          <button
                            onClick={() => { replaceTag(cursorTag.start, cursorTag.end, `<note>${cursorTag.inner}</note>`); closePopover() }}
                            style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 4, fontFamily: 'ui-monospace', fontSize: 10.5, background: '#ece1f1', border: '1px solid #c8b8d8', color: '#5a3b7a', cursor: 'pointer' }}
                          >&lt;note&gt;</button>
                        )}
                        {cursorTag.kind === 'note' && (
                          <button
                            onClick={() => { replaceTag(cursorTag.start, cursorTag.end, `<ref level="">${cursorTag.inner}</ref>`); closePopover() }}
                            style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 4, fontFamily: 'ui-monospace', fontSize: 10.5, background: '#d8e2c6', border: '1px solid #b8c8a0', color: '#3b5a30', cursor: 'pointer' }}
                          >&lt;ref&gt;</button>
                        )}
                      </div>
                      <div className="w-px h-3.5 shrink-0" style={{ background: 'var(--line-2)' }} />
                      <button
                        className="btn btn-quiet text-[11px]"
                        style={{ padding: '3px 7px' }}
                        onClick={() => { replaceTag(cursorTag.start, cursorTag.end, (cursorTag as { inner: string }).inner); closePopover() }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 9h16" /><path d="M4 15h16" /><path d="m9 4 3 3 3-3" /><path d="m9 20 3-3 3 3" /></svg>
                        {t('review.unwrap')}
                        <KbdChip>U</KbdChip>
                      </button>
                      <button
                        className="btn btn-quiet text-[11px]"
                        style={{ padding: '3px 7px', color: 'var(--oxblood)' }}
                        onClick={() => { replaceTag(cursorTag.start, cursorTag.end, ''); closePopover() }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                        {t('review.delete')}
                        <KbdChip>⌫</KbdChip>
                      </button>
                    </>
                  )}
                  {cursorTag.kind === 'self' && (
                    <button
                      className="btn btn-quiet text-[11px]"
                      style={{ padding: '3px 7px', color: 'var(--oxblood)' }}
                      onClick={() => { replaceTag(cursorTag.start, cursorTag.end, ''); closePopover() }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                      {t('review.delete')} <span className="font-mono" style={{ color: 'var(--oxblood)', opacity: 0.8 }}>{cursorTag.tag}</span>
                      <KbdChip>⌫</KbdChip>
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                    <span className="text-[10.5px]" style={{ color: 'var(--mute)' }}>
                      <KbdChip>esc</KbdChip>
                      {' '}{t('review.toDeselect')}
                    </span>
                    <button
                      className="btn btn-quiet"
                      style={{ width: 22, height: 22, padding: 0, justifyContent: 'center' }}
                      onClick={closePopover}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M6 18 18 6" /></svg>
                    </button>
                  </div>
                </div>

                {/* Row 2: tag-specific */}
                {cursorTag.kind === 'ref' && (
                  <div className="px-3 py-1.5 flex items-center gap-2.5 border-t" data-tour="review-level" style={{ borderColor: 'rgba(0,0,0,.06)', borderStyle: 'dashed' }}>
                    {levelList.length > 0 && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] uppercase tracking-[.12em] font-semibold" style={{ color: 'var(--mute)' }}>{t('review.levelLabel')}</span>
                        <div className="inline-flex gap-0.5">
                          {levelList.map((l) => {
                            const { fg, bg } = levelColor(l)
                            const active = String(l.depth) === cursorTag.level
                            return (
                              <button key={l.depth}
                                style={{ width: 22, height: 22, borderRadius: 4, fontFamily: 'ui-monospace', fontSize: 11, color: active ? fg : 'var(--mute)', background: active ? bg : 'transparent', border: `1px solid ${active ? fg + '60' : 'transparent'}`, fontWeight: active ? 600 : 400 }}
                                onClick={() => {
                                  const newTag = `<ref level="${l.depth}">${cursorTag.inner}</ref>`
                                  replaceTag(cursorTag.start, cursorTag.end, newTag)
                                  setCursorTag({ kind: 'ref', start: cursorTag.start, end: cursorTag.start + newTag.length, inner: cursorTag.inner, level: String(l.depth) })
                                }}
                                title={l.name}
                              >{l.depth}</button>
                            )
                          })}
                          <button
                            style={{ width: 22, height: 22, borderRadius: 4, fontFamily: 'ui-monospace', fontSize: 11, color: !cursorTag.level ? 'var(--oxblood)' : 'var(--mute)', background: !cursorTag.level ? '#f5e6fa' : 'transparent', border: '1px solid transparent' }}
                            onClick={() => {
                              const newTag = `<ref>${cursorTag.inner}</ref>`
                              replaceTag(cursorTag.start, cursorTag.end, newTag)
                              setCursorTag({ kind: 'ref', start: cursorTag.start, end: cursorTag.start + newTag.length, inner: cursorTag.inner, level: '' })
                            }}
                            title={t('review.noLevel')}
                          >–</button>
                        </div>
                      </div>
                    )}
                    <div className="w-px h-3.5 shrink-0" style={{ background: 'var(--line-2)' }} />
                    <button
                      className="btn btn-quiet text-[11px]"
                      style={{ padding: '3px 7px' }}
                      onClick={snapRefToSegment}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 6H6" /><path d="m10 2-4 4 4 4" /><path d="M4 14h16v6H4z" /></svg>
                      {t('review.snapToSegment')}
                      <KbdChip>⇧</KbdChip><KbdChip>←</KbdChip>
                    </button>
                  </div>
                )}
                {cursorTag.kind === 'hyphen' && (
                  <div className="px-3 py-1.5 flex items-center gap-2 border-t" style={{ borderColor: 'rgba(0,0,0,.06)', borderStyle: 'dashed' }}>
                    <button
                      className="btn btn-quiet text-[11px]"
                      style={{ padding: '3px 7px', color: '#15803d' }}
                      onClick={() => { replaceTag(cursorTag.start, cursorTag.end, `${cursorTag.word}<lb break="no"/>`); closePopover() }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="1.8"><path d="M4 12h16" /><path d="m15 5 7 7-7 7" /></svg>
                      Fix: &lt;lb break="no"/&gt;
                    </button>
                    <button
                      className="btn btn-quiet text-[11px]"
                      style={{ padding: '3px 7px' }}
                      onClick={() => { replaceTag(cursorTag.start, cursorTag.end, cursorTag.word); closePopover() }}
                    >
                      {t('review.joinOnly')}
                    </button>
                    <button
                      className="btn btn-quiet text-[11px]"
                      style={{ padding: '3px 7px', color: 'var(--oxblood)' }}
                      onClick={() => { replaceTag(cursorTag.start, cursorTag.end, ''); closePopover() }}
                    >
                      {t('review.delete')}
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>

        </div>
      </main>

      <style>{`
        mark.tag-ref-u{ background: #f5e6fa; color: #7b2d8b; font-weight: 600; }
        mark.tag-note { background: #ece1f1; color: #5a3b7a; font-weight: 600; }
        mark.tag-misc { background: #e2ddc7; color: #6b5a2b; }
        mark.tag-head { background: transparent; color: #4a6f8a; font-weight: 600; }
        mark.tag-lb   { background: #d6e7df; color: #2e5a4a; }
        mark.diff-suggestion { background: transparent; text-decoration: underline wavy #dc2626; text-decoration-thickness: 1.5px; cursor: pointer; border-radius: 0; }
        mark.diff-suggestion:hover { background: rgba(220,38,38,0.08); }
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}

function KbdChip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span style={{ fontFamily: 'ui-monospace', fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'var(--paper-3)', border: '1px solid var(--line-2)', color: 'var(--mute)', minWidth: 14, textAlign: 'center', display: 'inline-block' }}>
      {children}
    </span>
  )
}
