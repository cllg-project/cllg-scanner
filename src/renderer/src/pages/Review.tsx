import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Page, HierarchyLevel } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'

// Flatten nested HierarchyLevel tree into ordered [{depth, name}] list
function flattenHierarchy(levels: HierarchyLevel[]): { depth: number; name: string }[] {
  const out: { depth: number; name: string }[] = []
  function walk(node: HierarchyLevel, depth: number): void {
    out.push({ depth, name: node.name })
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  for (const l of levels) walk(l, 1)
  return out
}

type TagInfo =
  | { kind: 'ref';   start: number; end: number; inner: string; level: string }
  | { kind: 'note';  start: number; end: number; inner: string }
  | { kind: 'self';  start: number; end: number; tag: string }   // <tab/>, <lb/>, etc.

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
  return null
}

function highlightMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // <ref level="N"> where N is a real positive integer → classified (red)
    .replace(/(&lt;ref\s+level="[1-9]\d*"&gt;)(.*?)(&lt;\/ref&gt;)/g,
      '<mark class="tag-ref">$1$2$3</mark>')
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

  const levelList = flattenHierarchy(project?.hierarchy ?? [])

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
    const abs = imgPath.startsWith('/') ? imgPath : `${project.projectDir}/${imgPath}`
    window.api.loadImageAsDataUrl(abs).then(setImageUrl).catch(() => setImageUrl(null))
  }, [currentPage, project])

  const syncScroll = (): void => {
    if (!textareaRef.current || !highlightRef.current) return
    highlightRef.current.scrollTop = textareaRef.current.scrollTop
  }

  const currentState = currentPage ? pages.get(currentPage.n) : undefined
  const content = currentState?.content ?? ''

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

  if (!project) return <div className="p-8">No project open.</div>
  if (activePages.length === 0) {
    return (
      <div className="flex h-full">
        <Sidebar collapsed />
        <main className="flex-1 flex items-center justify-center" style={{ background: 'var(--paper-2)' }}>
          <div className="text-center">
            <div className="font-serif text-[20px] mb-2">No processed pages yet</div>
            <div className="text-[13px] mb-5" style={{ color: 'var(--mute)' }}>Run OCR first to populate the review.</div>
            <button className="btn btn-primary" onClick={() => navigate('/ocr')}>← Back to OCR</button>
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
              Step 04 of 05
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

          <div className="ml-auto flex items-center gap-3">
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
            style={{ borderColor: 'var(--line)', background: '#fdf4ff', flexShrink: 0 }}
          >
            {/* Current tag label */}
            <span className="font-mono shrink-0" style={{ color: '#7b2d8b' }}>
              {cursorTag.kind === 'ref'
                ? (cursorTag.level ? `<ref level="${cursorTag.level}">` : '<ref>')
                : cursorTag.kind === 'note'
                ? '<note>'
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
                {levelList.map((l) => (
                  <button
                    key={l.depth}
                    className="btn btn-quiet !py-0 !px-2 !text-[11px] font-mono shrink-0"
                    style={String(l.depth) === cursorTag.level
                      ? { background: '#c0392b', color: '#fff', borderColor: '#c0392b' }
                      : {}}
                    onClick={() => replaceTag(cursorTag.start, cursorTag.end, `<ref level="${l.depth}">${cursorTag.inner}</ref>`)}
                    title={l.name}
                  >
                    {l.depth} <span className="opacity-60 ml-0.5 text-[10px]">{l.name}</span>
                  </button>
                ))}
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

            {/* Delete */}
            <button
              className="btn btn-quiet !py-0 !px-2 !text-[11px] shrink-0"
              style={{ color: '#c0392b' }}
              onClick={() => replaceTag(cursorTag.start, cursorTag.end, '')}
              title="Delete tag and its content"
            >
              delete
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
            <div
              className="flex-1 relative overflow-hidden"
              style={{ background: currentState?.loaded ? 'white' : 'var(--paper-2)' }}
            >
              {/* Highlight layer — transparent text, only mark backgrounds show */}
              <div
                ref={highlightRef}
                aria-hidden="true"
                className="absolute inset-0 p-4 overflow-y-auto pointer-events-none font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
                style={{ color: 'transparent', background: 'transparent', zIndex: 1 }}
                dangerouslySetInnerHTML={{ __html: highlightMarkdown(content) }}
              />
              {/* Editable textarea — transparent so highlight layer shows through */}
              <textarea
                ref={textareaRef}
                className="absolute inset-0 w-full h-full p-4 font-mono text-[12.5px] leading-relaxed resize-none outline-none caret-[var(--ink)]"
                style={{ color: 'var(--ink)', zIndex: 2, background: 'transparent' }}
                value={content}
                onChange={(e) => { setContent(e.target.value); updateCursorTag() }}
                onClick={updateCursorTag}
                onKeyUp={updateCursorTag}
                onScroll={syncScroll}
                spellCheck={false}
                placeholder={currentState?.loaded ? '' : 'Loading…'}
              />
            </div>

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
        mark.tag-ref  { background: #fdecea; color: #c0392b; font-weight: 600; }
        mark.tag-ref-u{ background: #f5e6fa; color: #7b2d8b; font-weight: 600; }
        mark.tag-note { background: #f0e8ff; color: #6d28d9; font-weight: 600; }
        mark.tag-misc { background: #e5e7eb; color: #4b5563; }
        mark.tag-head { background: transparent; color: #4a6f8a; font-weight: 600; }
        mark.tag-lb   { background: #dcfce7; color: #15803d; }
      `}</style>
    </div>
  )
}
