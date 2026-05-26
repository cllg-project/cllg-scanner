import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Page, HierarchyLevel, KrakenConfig } from '@shared/types'
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

// Default palette for levels 1–5 (index 0 = L1). Beyond 5 uses LEVEL_COLOR_DEFAULT.
const LEVEL_COLORS_DEFAULT = [
  { fg: '#c0392b' }, // L1 — red
  { fg: '#1565c0' }, // L2 — blue
  { fg: '#2e7d32' }, // L3 — green
  { fg: '#e65100' }, // L4 — orange
  { fg: '#6a1b9a' }, // L5 — purple
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

// Matches <ref>xxx</ref>, <ref level="">xxx</ref>, <ref level="0">xxx</ref>
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
  | { kind: 'self';   start: number; end: number; tag: string }   // <tab/>, <lb/>, etc.
  | { kind: 'hyphen'; start: number; end: number; word: string }  // word-

function detectCursorTag(text: string, pos: number): TagInfo | null {
  // Paired tags: <ref ...>...</ref>  |  <note>...</note>
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
  // Self-closing tags: <tab/>, <lb/>, <lb break="no"/>
  const self = /<(tab|lb)[^>]*\/>/g
  while ((m = self.exec(text)) !== null) {
    if (pos >= m.index && pos <= m.index + m[0].length) {
      return { kind: 'self', start: m.index, end: m.index + m[0].length, tag: m[0] }
    }
  }
  // Hyphenated word: word- (followed by whitespace, will become <lb break="no"/>)
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
    // <ref level="N"> — use per-level color via inline style
    .replace(/(&lt;ref\s+level="([1-9]\d*)"&gt;)(.*?)(&lt;\/ref&gt;)/g, (_, open, n, inner, close) => {
      const lv = levelMap.get(Number(n))
      const { fg, bg } = lv ? levelColor(lv) : { fg: LEVEL_FG_DEFAULT, bg: '#eceff1' }
      return `<mark style="background:${bg};color:${fg};font-weight:600">${open}${inner}${close}</mark>`
    })
    // plain <ref>, <ref level="">, <ref level="0"> → unclassified (violet)
    .replace(/(&lt;ref(?:\s+level="(?:0|)")?&gt;)(.*?)(&lt;\/ref&gt;)/g,
      '<mark class="tag-ref-u">$1$2$3</mark>')
    // note tags
    .replace(/(&lt;note&gt;)(.*?)(&lt;\/note&gt;)/g,
      '<mark class="tag-note">$1$2$3</mark>')
    // self-closing / standalone tags
    .replace(/(&lt;(?:tab\/|pb[^&]*?)&gt;)/g,
      '<mark class="tag-misc">$1</mark>')
    // heading lines
    .replace(/^(#{1,3} .+)$/gm, '<mark class="tag-head">$1</mark>')
    // explicit <lb/> tags
    .replace(/(&lt;lb[^&]*?\/&gt;)/g, '<mark class="tag-lb">$1</mark>')
    // trailing hyphen on a word → will become <lb break="no"/> in TEI
    .replace(/(\p{L}+-)(?=[\t ]|&lt;|$)/gmu,
      '<mark class="tag-lb">$1</mark>')
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

export default function Review(): React.JSX.Element {
  const { project } = useProject()
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
  const betaPendingRef = useRef<Set<string>>(new Set())
  const sigmaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Load markdown for a page if not yet cached
  const loadPage = useCallback(
    async (page: Page) => {
      if (!project) return
      if (pages.has(page.n)) return
      const content = await window.api.loadMarkdown(project.projectDir, page.n)
      setPages((prev) => new Map(prev).set(page.n, makePageState(content)))
    },
    [project, pages]
  )

  // Preload current + adjacent pages
  useEffect(() => {
    if (!currentPage) return
    loadPage(currentPage)
    if (activePages[currentIdx - 1]) loadPage(activePages[currentIdx - 1])
    if (activePages[currentIdx + 1]) loadPage(activePages[currentIdx + 1])
  }, [currentIdx, currentPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load image for current page
  useEffect(() => {
    if (!currentPage || !project) return
    setImageUrl(null)
    const imgPath = currentPage.maskedImagePath ?? currentPage.imagePath
    window.api.joinPaths(project.projectDir, imgPath)
      .then((abs) => window.api.loadImageAsDataUrl(abs))
      .then(setImageUrl)
      .catch(() => setImageUrl(null))
  }, [currentPage, project])

  // Grow the textarea to fit its content so the outer container does the scrolling.
  // This eliminates scrollbar-width mismatches between the textarea and the highlight layer.
  const autoGrow = useCallback((): void => {
    const ta = textareaRef.current
    const sc = scrollContainerRef.current
    if (!ta || !sc) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(ta.scrollHeight, sc.clientHeight)}px`
  }, [])

  const currentState = currentPage ? pages.get(currentPage.n) : undefined
  const content = currentState?.content ?? ''

  useEffect(() => { autoGrow() }, [content])

  // Push a new value onto the current page's undo stack
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

  // Replace the tag at [start, end) with arbitrary text, then refocus
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

  // Autosave 1.5s after the user stops typing
  useEffect(() => {
    if (!currentState?.dirty) return
    const t = setTimeout(() => saveCurrent(), 1500)
    return () => clearTimeout(t)
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const inTextarea = document.activeElement === textareaRef.current

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
  }, [saveCurrent, undo, redo]) // eslint-disable-line react-hooks/exhaustive-deps

  const canUndo = (currentState?.historyIdx ?? 0) > 0
  const canRedo = (currentState?.historyIdx ?? 0) < (currentState?.history.length ?? 1) - 1

  // Schedule a final-sigma pass 1 second after the user stops typing in beta mode.
  // Uses the functional setPages form so it reads the latest content, not a stale closure.
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

  // Clear any pending sigma timer when beta mode is toggled or the page changes.
  useEffect(() => {
    return () => { if (sigmaTimerRef.current) clearTimeout(sigmaTimerRef.current) }
  }, [betaMode, currentPage])

  const handleBetaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!betaMode) return
    // Let through Ctrl/Meta combos (so Ctrl+S, Ctrl+K etc. still work)
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const result = convertBetaKey(e.key, betaPendingRef.current)
    if (result.isPending) {
      e.preventDefault()
      return
    }
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

  // Fetch bundled Kraken model paths from main process once
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
      // Re-render masks if any are defined, otherwise use the stored masked or plain image
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
      setReOcrOpen(false)
    } catch (err: unknown) {
      setReOcrError(String(err))
    } finally {
      setReOcrRunning(false)
    }
  }, [project, currentPage, reOcrEngine, krakenPaths]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <div className="p-8">No project open.</div>
  if (activePages.length === 0) {
    return (
      <div className="flex h-full">
        <Sidebar collapsed />
        <main className="flex-1 flex items-center justify-center" style={{ background: 'var(--paper-2)' }}>
          <div className="text-center">
            <div className="font-serif text-[20px] mb-2">No processed pages yet</div>
            <div className="text-[13px] mb-5" style={{ color: 'var(--mute)' }}>Run OCR first to populate the review.</div>
            <button className="btn btn-primary" onClick={() => navigate('/config')}>← Back to Structure</button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--paper-2)' }}>
        {/* Header */}
        <div className="px-8 pt-6 pb-4 border-b flex items-end justify-between shrink-0" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="font-mono text-[10px] tracking-[.18em] uppercase" style={{ color: 'var(--mute)' }}>
              Step 05 of 06
            </div>
            <h2 className="font-serif text-[28px] leading-tight mt-1">Review</h2>
            <div className="text-[12.5px] mt-1" style={{ color: 'var(--mute)' }}>
              Review and correct OCR output page by page. Changes are saved to{' '}
              <span className="font-mono" style={{ color: 'var(--ink)' }}>pages/page_NNNN.md</span>.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" onClick={() => navigate('/export')}>
              Next: TEI Export
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div
          className="px-8 h-10 flex items-center gap-3 border-b shrink-0"
          style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}
        >
          {/* Page navigation */}
          <button
            className="tool-btn"
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx((i) => i - 1)}
            title="Previous page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <div className="font-mono text-[12px] tabular-nums" style={{ color: 'var(--ink)' }}>
            p.{currentPage?.n ?? '–'}{' '}
            <span style={{ color: 'var(--mute)' }}>/ {activePages.length} pages</span>
          </div>

          <button
            className="tool-btn"
            disabled={currentIdx === activePages.length - 1}
            onClick={() => setCurrentIdx((i) => i + 1)}
            title="Next page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>

          <div className="w-px h-5 mx-1" style={{ background: 'var(--line-2)' }} />

          {/* Tag insertion */}
          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px] font-mono"
            onClick={() => insertTag('<ref level="">', '</ref>')}
            title="Wrap selection in <ref level=&quot;&quot;> (Ctrl+R)"
          >
            &lt;ref&gt;
          </button>
          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px] font-mono"
            onClick={() => insertTag('<note>', '</note>')}
            title="Wrap selection in <note> (Ctrl+M)"
          >
            &lt;note&gt;
          </button>
          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px] font-mono"
            onClick={() => insertTag('<tab/>', '')}
            title="Insert <tab/> (Tab key)"
          >
            &lt;tab/&gt;
          </button>
          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px] font-mono"
            onClick={() => insertTag('<lb/>', '')}
            title="Insert <lb/> line-break element"
          >
            &lt;lb/&gt;
          </button>
          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px] gap-1"
            onClick={replaceAllHyphens}
            disabled={hyphenCount === 0}
            title="Replace all word- patterns with <lb break='no'/>"
            style={hyphenCount > 0 ? { borderColor: '#15803d', color: '#15803d' } : {}}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12h16M12 4l8 8-8 8" />
            </svg>
            Fix hyphens{hyphenCount > 0 ? ` (${hyphenCount})` : ''}
          </button>

          <div className="w-px h-5 mx-1" style={{ background: 'var(--line-2)' }} />

          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px] gap-1"
            onClick={runScan}
            title="Scan page for [token] reference patterns and annotate"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            Scan refs
          </button>

          <div className="w-px h-5 mx-1" style={{ background: 'var(--line-2)' }} />

          {/* Undo / Redo / Restore */}
          <button
            className="tool-btn"
            disabled={!canUndo}
            onClick={undo}
            title="Undo (Ctrl+Z)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 2.83-6.36" />
            </svg>
          </button>
          <button
            className="tool-btn"
            disabled={!canRedo}
            onClick={redo}
            title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6" /><path d="M21 13A9 9 0 1 1 18.17 6.64" />
            </svg>
          </button>
          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px]"
            onClick={restore}
            title="Restore original OCR output for this page"
          >
            Restore
          </button>
          <button
            className="btn btn-quiet !py-0.5 !px-2 !text-[11px]"
            onClick={resetCache}
            title="Delete the cached transcription for this page and reset its status to pending"
          >
            Reset cache
          </button>
          <button
            className={`btn btn-quiet !py-0.5 !px-2 !text-[11px] gap-1 ${reOcrOpen ? 'border-[#0369a1] text-[#0369a1]' : ''}`}
            onClick={() => { setReOcrOpen((v) => !v); setReOcrError(null) }}
            title="Re-run OCR on this page (LM Studio or Kraken)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            Re-OCR
          </button>

          <div className="ml-auto flex items-center gap-3">
            {/* Font size controls */}
            <div className="flex items-center gap-0.5">
              <button
                className="tool-btn !w-5 !h-5 !text-[11px]"
                onClick={() => setFontSize((s) => { const v = Math.max(10, s - 1); localStorage.setItem('review:fontSize', String(v)); return v })}
                title="Decrease font size"
              >−</button>
              <span className="text-[10.5px] font-mono tabular-nums w-7 text-center" style={{ color: 'var(--mute)' }}>{fontSize}px</span>
              <button
                className="tool-btn !w-5 !h-5 !text-[11px]"
                onClick={() => setFontSize((s) => { const v = Math.min(32, s + 1); localStorage.setItem('review:fontSize', String(v)); return v })}
                title="Increase font size"
              >+</button>
            </div>
            <div className="w-px h-4" style={{ background: 'var(--line-2)' }} />
            {betaMode && (
              <span
                className="px-2 py-0.5 rounded text-[11.5px] font-mono font-semibold"
                style={{ background: '#f0eaf8', border: '1px solid #9c6ab0', color: '#6a1b9a' }}
                title="Beta Code mode active — Ctrl/Cmd+K to toggle"
              >
                β
              </span>
            )}
            <button
              className={`tool-btn text-[12px] font-mono ${betaMode ? 'active' : ''}`}
              onClick={() => { setBetaMode((m) => !m); betaPendingRef.current.clear() }}
              title={`${betaMode ? 'Disable' : 'Enable'} beta code keyboard (Ctrl+K)`}
              style={betaMode ? { color: '#6a1b9a', borderColor: '#9c6ab0' } : {}}
            >
              β
            </button>
            {currentState?.dirty && (
              <span className="text-[11.5px] font-mono" style={{ color: 'var(--amber, #c89328)' }}>
                unsaved
              </span>
            )}
            {saveMsg && (
              <span className="text-[11.5px] font-mono" style={{ color: 'var(--moss, #5a8c3f)' }}>
                {saveMsg}
              </span>
            )}
            <button
              className="btn btn-ghost !py-1 !px-3 !text-[11.5px]"
              onClick={saveCurrent}
              disabled={saving || !currentState?.dirty}
            >
              {saving ? 'Saving…' : 'Save'}
              <span className="text-[10px] opacity-60 ml-1">⌘S</span>
            </button>
          </div>
        </div>

        {/* Tag context bar — shown when cursor is inside any editable tag */}
        {cursorTag !== null && (
          <div
            className="px-8 h-9 flex items-center gap-2 border-b shrink-0 text-[11.5px] overflow-x-auto"
            style={{ borderColor: 'var(--line)', background: cursorTag.kind === 'hyphen' ? '#f0fdf4' : '#fdf4ff', flexShrink: 0 }}
          >
            {/* Current tag label */}
            <span className="font-mono shrink-0" style={{ color: cursorTag.kind === 'hyphen' ? '#15803d' : '#7b2d8b' }}>
              {cursorTag.kind === 'ref'
                ? (cursorTag.level ? `<ref level="${cursorTag.level}">` : '<ref>')
                : cursorTag.kind === 'note'
                ? '<note>'
                : cursorTag.kind === 'hyphen'
                ? `${cursorTag.word}-`
                : cursorTag.tag}
            </span>

            <span className="shrink-0" style={{ color: 'var(--mute)' }}>→</span>

            {/* Ref: level buttons */}
            {cursorTag.kind === 'ref' && levelList.length === 0 && (
              <span className="text-[11px] italic shrink-0" style={{ color: 'var(--mute)' }}>
                no levels defined —{' '}
                <button
                  className="underline"
                  style={{ color: 'var(--mute)' }}
                  onClick={() => navigate('/export')}
                >
                  configure in TEI Export
                </button>
              </span>
            )}
            {cursorTag.kind === 'ref' && levelList.length > 0 && (
              <>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--mute)' }}>
                  level (from TEI Export):
                </span>
                {levelList.map((l) => {
                  const { fg, bg } = levelColor(l)
                  const active = String(l.depth) === cursorTag.level
                  return (
                    <button
                      key={l.depth}
                      className="btn btn-quiet !py-0 !px-2 !text-[11px] font-mono shrink-0"
                      style={active ? { background: fg, color: '#fff', borderColor: fg } : { borderColor: fg, color: fg }}
                      onClick={() => replaceTag(cursorTag.start, cursorTag.end, `<ref level="${l.depth}">${cursorTag.inner}</ref>`)}
                      title={l.name}
                    >
                      {l.depth} <span className="opacity-60 ml-0.5 text-[10px]">{l.name}</span>
                    </button>
                  )
                })}
                <button
                  className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0"
                  style={!cursorTag.level ? { background: '#7b2d8b', color: '#fff', borderColor: '#7b2d8b' } : {}}
                  onClick={() => replaceTag(cursorTag.start, cursorTag.end, `<ref>${cursorTag.inner}</ref>`)}
                  title="Unclassified ref (no level)"
                >
                  none
                </button>
              </>
            )}

            {/* Ref ↔ Note conversions */}
            {cursorTag.kind === 'ref' && (
              <button
                className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0"
                onClick={() => replaceTag(cursorTag.start, cursorTag.end, `<note>${cursorTag.inner}</note>`)}
                title="Convert to <note>"
              >
                → &lt;note&gt;
              </button>
            )}
            {cursorTag.kind === 'note' && (
              <button
                className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0"
                onClick={() => replaceTag(cursorTag.start, cursorTag.end, `<ref level="">${cursorTag.inner}</ref>`)}
                title="Convert to <ref>"
              >
                → &lt;ref&gt;
              </button>
            )}

            {/* Unwrap (keep text) — paired tags only */}
            {(cursorTag.kind === 'ref' || cursorTag.kind === 'note') && (
              <button
                className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0"
                onClick={() => replaceTag(cursorTag.start, cursorTag.end, cursorTag.inner)}
                title="Remove tags, keep text"
              >
                unwrap
              </button>
            )}

            {/* Hyphen fix actions */}
            {cursorTag.kind === 'hyphen' && (
              <>
                <button
                  className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0 font-mono"
                  style={{ borderColor: '#15803d', color: '#15803d' }}
                  onClick={() => replaceTag(cursorTag.start, cursorTag.end, `${cursorTag.word}<lb break="no"/>`)}
                  title="Replace with <lb break='no'/>"
                >
                  &lt;lb break="no"/&gt;
                </button>
                <button
                  className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0"
                  onClick={() => replaceTag(cursorTag.start, cursorTag.end, cursorTag.word)}
                  title="Join words without break marker"
                >
                  join only
                </button>
              </>
            )}

            {/* Delete — not shown for hyphen (it's plain text, not a tag) */}
            {cursorTag.kind !== 'hyphen' && (
              <button
                className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0"
                style={{ color: '#c0392b' }}
                onClick={() => replaceTag(cursorTag.start, cursorTag.end, '')}
                title="Delete tag and its content"
              >
                delete
              </button>
            )}
          </div>
        )}

        {/* Re-OCR panel */}
        {reOcrOpen && (
          <div
            className="px-8 py-3 border-b shrink-0 flex items-center gap-4 flex-wrap text-[11.5px]"
            style={{ borderColor: 'var(--line)', background: '#f0f9ff' }}
          >
            {/* Engine toggle */}
            <div className="flex items-center gap-1 shrink-0">
              {(['kraken', 'lm'] as const).map((eng) => (
                <button
                  key={eng}
                  className="btn btn-quiet !py-0.5 !px-2.5 !text-[11px] shrink-0"
                  style={reOcrEngine === eng ? { background: '#0369a1', color: '#fff', borderColor: '#0369a1' } : {}}
                  onClick={() => { setReOcrEngine(eng); setReOcrError(null) }}
                >
                  {eng === 'kraken' ? 'Kraken (ONNX)' : 'LM Studio (Vision)'}
                </button>
              ))}
            </div>

            {/* Engine description */}
            {reOcrEngine === 'kraken' ? (
              <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--mute)' }}>
                Built-in Ancient Greek models (seg + rec)
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--mute)' }}>
                {project.lmConfig.endpoint} · <span style={{ color: 'var(--ink)' }}>{project.lmConfig.model || '(no model set)'}</span>
              </span>
            )}

            {reOcrError && (
              <span className="shrink-0 text-[11px]" style={{ color: '#b04a3a' }}>{reOcrError}</span>
            )}

            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button
                className="btn btn-primary !py-1 !px-3 !text-[11.5px] gap-1.5"
                onClick={runReOcr}
                disabled={reOcrRunning}
              >
                {reOcrRunning ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.3-8.6" />
                    </svg>
                    Running…
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Run
                  </>
                )}
              </button>
              <button
                className="tool-btn !w-5 !h-5 shrink-0"
                onClick={() => { setReOcrOpen(false); setReOcrError(null) }}
                disabled={reOcrRunning}
                title="Dismiss"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Scan results panel */}
        {scanInfo !== null && (
          <div
            className="px-8 py-2.5 border-b shrink-0 flex items-center gap-4 text-[11.5px] flex-wrap"
            style={{ borderColor: 'var(--line)', background: '#f0f9ff' }}
          >
            <span className="font-mono font-semibold shrink-0" style={{ color: '#0369a1' }}>
              {scanInfo.total} unclassified &lt;ref&gt;{scanInfo.total !== 1 ? 's' : ''} found
            </span>
            {scanInfo.total === 0 ? (
              <span style={{ color: 'var(--mute)' }}>No unclassified &lt;ref&gt; tags on this page.</span>
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
                    <span className="font-semibold">unmatched:</span>{' '}
                    {scanInfo.unmatched.slice(0, 5).join(', ')}{scanInfo.unmatched.length > 5 ? ` +${scanInfo.unmatched.length - 5}` : ''}
                  </span>
                )}
                <button
                  className="btn btn-quiet !py-0.5 !px-2.5 !text-[11px] shrink-0"
                  style={{ background: '#0369a1', color: '#fff', borderColor: '#0369a1' }}
                  onClick={applyAnnotations}
                  title="Replace all matched [token] with <ref level=&quot;N&quot;>token</ref>"
                >
                  Annotate {scanInfo.matched} matched
                </button>
              </>
            )}
            <button
              className="tool-btn !w-5 !h-5 ml-auto shrink-0"
              onClick={() => setScanInfo(null)}
              title="Dismiss"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Main two-column editor */}
        <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {/* Left — image */}
          <div
            className="overflow-auto flex items-start justify-center p-4 border-r"
            style={{ borderColor: 'var(--line)', background: '#f5f2ec' }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`Page ${currentPage?.n}`}
                className="max-w-full shadow-md"
                style={{ border: '1px solid var(--line)' }}
              />
            ) : (
              <div
                className="flex items-center justify-center w-full h-full text-[13px]"
                style={{ color: 'var(--mute)' }}
              >
                {currentPage ? 'Loading…' : 'No page selected'}
              </div>
            )}
          </div>

          {/* Right — editor */}
          <div className="overflow-hidden flex flex-col">
            {/* Outer scroll container — this is the only scrollable element */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto"
              style={{ background: currentState?.loaded ? 'white' : 'var(--paper-2)' }}
            >
              <div className="relative">
                {/* Highlight layer — no scroll, always same size as the textarea */}
                <div
                  ref={highlightRef}
                  aria-hidden="true"
                  className="absolute inset-0 p-4 overflow-hidden pointer-events-none font-mono leading-relaxed whitespace-pre-wrap break-words"
                  style={{ color: 'transparent', background: 'transparent', fontSize }}
                  dangerouslySetInnerHTML={{ __html: highlightMarkdown(content, levelMap) }}
                />
                {/* Editable textarea — auto-grows; outer div handles scrolling */}
                <textarea
                  ref={textareaRef}
                  className="relative w-full p-4 font-mono leading-relaxed resize-none outline-none caret-[var(--ink)]"
                  style={{ color: 'var(--ink)', background: 'transparent', overflow: 'hidden', display: 'block', fontSize }}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value)
                    if (betaMode) scheduleSigmaFix()
                    updateCursorTag()
                  }}
                  onClick={updateCursorTag}
                  onKeyUp={updateCursorTag}
                  onKeyDown={handleBetaKeyDown}
                  spellCheck={false}
                  placeholder={currentState?.loaded ? '' : 'Loading…'}
                />
              </div>
            </div>

            {/* Beta Code helper map */}
            {betaMode && (
              <div className="shrink-0 px-4 pb-2" style={{ background: 'white' }}>
                <BetaCodeHelper />
              </div>
            )}

            {/* Page mini-strip */}
            <div
              className="shrink-0 border-t overflow-x-auto flex gap-1.5 p-2"
              style={{ borderColor: 'var(--line)', background: 'var(--paper-3)', minHeight: 56 }}
            >
              {activePages.map((p, i) => {
                const dirty = pages.get(p.n)?.dirty
                return (
                  <button
                    key={p.n}
                    onClick={() => setCurrentIdx(i)}
                    className="relative shrink-0 rounded text-[10px] font-mono tabular-nums px-2 py-1 border transition-colors"
                    style={{
                      borderColor: i === currentIdx ? 'var(--oxblood)' : 'var(--line-2)',
                      background: i === currentIdx ? '#f5eae8' : 'var(--paper)',
                      color: i === currentIdx ? 'var(--oxblood)' : 'var(--mute)',
                      fontWeight: i === currentIdx ? 600 : undefined
                    }}
                  >
                    {p.n}
                    {dirty && (
                      <span
                        className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                        style={{ background: 'var(--amber, #c89328)' }}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        mark.tag-ref-u{ background: #f5e6fa; color: #7b2d8b; font-weight: 600; }
        mark.tag-note { background: #f0e8ff; color: #6d28d9; font-weight: 600; }
        mark.tag-misc { background: #e5e7eb; color: #4b5563; }
        mark.tag-head { background: transparent; color: #4a6f8a; font-weight: 600; }
        mark.tag-lb   { background: #dcfce7; color: #15803d; }
      `}</style>
    </div>
  )
}
