import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type * as pdfjs from 'pdfjs-dist'
import type { Project } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'
import {
  detectFormatFromBytes,
  formatFromExtension,
  tryLoadDocument,
  renderPDFPages,
  renderDjVuPages,
  importImagePages,
  pdfThumbnail,
  djvuThumbnail,
  imageThumbnail,
  parseRange,
  compressRange,
  togglePage
} from '../utils/pageImport'

const STATUS_LABEL: Record<string, string> = {
  pending: 'pending',
  masked: 'masking',
  ocr_done: 'complete',
  skipped: 'skipped',
  error: 'error'
}

function projectProgress(p: Project): number {
  if (!p.pages.length) return 0
  const done = p.pages.filter((pg) => pg.status === 'ocr_done').length
  return Math.round((done / p.pages.length) * 100)
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} days ago`
}

// ── Types ────────────────────────────────────────────────────────────────────

type ImportMode = 'pdf' | 'djvu' | 'images'

interface PendingImport {
  mode: ImportMode
  sourcePath: string
  // projectDir is NOT here — asked only when Import is clicked
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: pdfjs.PDFDocumentProxy | any | null
  imagePaths: string[]
  totalPages: number
  rangeText: string   // e.g. "1-5,7,9"
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Home(): React.JSX.Element {
  const [recent, setRecent] = useState<Project[]>([])
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importStep, setImportStep] = useState<string | null>(null)
  const [importProgress, setImportProgress] = useState<{ cur: number; total: number } | null>(null)
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [thumbProgress, setThumbProgress] = useState<{ cur: number; total: number } | null>(null)
  const [errorMessage, setErrorMessage] = useState<{ title: string; detail: string } | null>(null)
  const [zoomedPage, setZoomedPage] = useState<number | null>(null)
  const [filmstripHeight, setFilmstripHeight] = useState(180)
  const filmstripRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ startY: number; startH: number } | null>(null)
  const { setProject, saveProject } = useProject()
  const navigate = useNavigate()

  useEffect(() => {
    window.api.getRecentProjects().then(setRecent)
  }, [])

  // Render thumbnails progressively when pendingImport is set
  useEffect(() => {
    if (!pendingImport) { setThumbnails([]); setThumbProgress(null); return }
    let cancelled = false
    const { mode, doc, imagePaths, totalPages } = pendingImport
    setThumbnails([])
    setThumbProgress({ cur: 0, total: totalPages })
    const thumbs: string[] = []

    ;(async () => {
      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) break
        let url: string
        if (mode === 'pdf') {
          url = await pdfThumbnail(doc as pdfjs.PDFDocumentProxy, i)
        } else if (mode === 'djvu') {
          url = await djvuThumbnail(doc, i)
        } else {
          url = await imageThumbnail(imagePaths[i - 1])
        }
        thumbs.push(url)
        if (!cancelled) {
          setThumbnails([...thumbs])
          setThumbProgress({ cur: i, total: totalPages })
        }
      }
      if (!cancelled) setThumbProgress(null)
    })()

    return () => { cancelled = true }
  // Keying on doc+imagePaths: a new import always replaces both
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImport?.doc, pendingImport?.imagePaths])


  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: filmstripHeight }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setFilmstripHeight(Math.max(80, dragRef.current.startH + ev.clientY - dragRef.current.startY))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }, [filmstripHeight])

  // Keyboard navigation for the zoom lightbox
  useEffect(() => {
    if (zoomedPage === null || !pendingImport) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setZoomedPage(null); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setZoomedPage((p) => p !== null ? Math.min(p + 1, pendingImport.totalPages) : p)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        setZoomedPage((p) => p !== null ? Math.max(p - 1, 1) : p)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [zoomedPage, pendingImport])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleNewProject = useCallback(async () => {
    const sourcePath = await window.api.selectDocument()
    if (!sourcePath) return

    setImportStep('Reading file…')
    try {
      const bytes = await window.api.loadPDFData(sourcePath)

      const magic = detectFormatFromBytes(bytes)
      const primary: 'pdf' | 'djvu' = magic !== 'unknown' ? magic : formatFromExtension(sourcePath)
      const fallback: 'pdf' | 'djvu' = primary === 'pdf' ? 'djvu' : 'pdf'

      setImportStep(`Opening as ${primary.toUpperCase()}…`)
      let mode = primary
      let result: { doc: pdfjs.PDFDocumentProxy | unknown; totalPages: number } | null = null
      let primaryError: string | null = null

      try {
        result = await tryLoadDocument(primary, bytes)
      } catch (err) {
        primaryError = err instanceof Error ? err.message : String(err)
        console.warn(`Failed as ${primary}, trying ${fallback}:`, err)
        setImportStep(`Retrying as ${fallback.toUpperCase()}…`)
        try {
          result = await tryLoadDocument(fallback, bytes)
          mode = fallback
        } catch (fallbackErr) {
          const fallbackError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          setErrorMessage({
            title: 'Cannot open this file',
            detail: `Tried PDF: ${primaryError}\n\nTried DjVu: ${fallbackError}`
          })
          return
        }
      }

      const n = result!.totalPages
      setPendingImport({
        mode, sourcePath,
        doc: result!.doc, imagePaths: [],
        totalPages: n,
        rangeText: ''
      })
    } catch (err) {
      setErrorMessage({
        title: 'Failed to read file',
        detail: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImportStep(null)
    }
  }, [])

  const handleNewProjectFromImages = useCallback(async () => {
    const dirPath = await window.api.selectImageDir()
    if (!dirPath) return

    setImportStep('Scanning folder…')
    try {
      const files = await window.api.listImagesInDir(dirPath)
      if (!files.length) {
        setImportStep('No images found in that folder')
        await new Promise((r) => setTimeout(r, 2000))
        return
      }
      setPendingImport({
        mode: 'images',
        sourcePath: dirPath,
        doc: null,
        imagePaths: files.map((f) => f.path),
        totalPages: files.length,
        rangeText: ''
      })
    } finally {
      setImportStep(null)
    }
  }, [])

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImport) return
    const { mode, sourcePath, doc, imagePaths, totalPages, rangeText } = pendingImport
    const pageNums = parseRange(rangeText, totalPages)
    if (!pageNums.length) return

    const projectDir = await window.api.selectProjectDir()
    if (!projectDir) return

    setPendingImport(null)
    setImportStep('Creating project…')
    try {
      const project = await window.api.newProject(sourcePath, projectDir)
      setImportStep(`Importing ${pageNums.length} pages…`)

      let updated: Project
      if (mode === 'pdf') {
        updated = await renderPDFPages(doc as pdfjs.PDFDocumentProxy, project, pageNums, (cur, total) => setImportProgress({ cur, total }))
      } else if (mode === 'djvu') {
        updated = await renderDjVuPages(doc, project, pageNums, (cur, total) => setImportProgress({ cur, total }))
      } else {
        const selectedPaths = pageNums.map((n) => imagePaths[n - 1])
        updated = await importImagePages(selectedPaths, project, (cur, total) => setImportProgress({ cur, total }))
      }

      setImportStep('Saving…')
      await saveProject(updated)
      setProject(updated)
      navigate('/masker')
    } finally {
      setImportStep(null)
      setImportProgress(null)
    }
  }, [pendingImport, saveProject, setProject, navigate])

  const handleOpenProject = useCallback(async () => {
    const p = await window.api.openProject()
    if (p) { setProject(p); navigate('/masker') }
  }, [setProject, navigate])

  const openRecent = useCallback((p: Project) => {
    setProject(p); navigate('/masker')
  }, [setProject, navigate])

  const removeRecent = useCallback(async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation()
    await window.api.removeRecentProject(p.id)
    setRecent((prev) => prev.filter((r) => r.id !== p.id))
  }, [])

  const busy = !!importStep
  const modeLabel: Record<ImportMode, string> = { pdf: 'PDF', djvu: 'DjVu', images: 'images' }

  return (
    <div className="flex h-full">
      <Sidebar />

      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--paper-2)' }}>

        {/* ── Hero ───────────────────────────────────────────────── */}
        <div className="px-10 pt-10 pb-8 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-end justify-between gap-8">
            <div>
              <div className="font-mono text-[10px] tracking-[.18em] uppercase mb-2" style={{ color: 'var(--mute)' }}>
                Welcome back
              </div>
              <h1 className="font-serif text-[40px] leading-[1.05] tracking-tight">
                Begin a new <em>codex</em>, or resume your work.
              </h1>
              <p className="text-[13.5px] mt-3 max-w-[560px]" style={{ color: 'var(--mute)' }}>
                Import a PDF, DjVu, or folder of images — CLLG will render them for masking and OCR.
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0 items-end">
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={handleNewProject} disabled={busy || !!pendingImport}>
                  {busy ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.3-8.6" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                  New project (PDF / DjVu)
                </button>
                <button className="btn btn-ghost" onClick={handleNewProjectFromImages} disabled={busy || !!pendingImport}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 15 5-5 4 4 3-3 5 5" />
                  </svg>
                  Image folder…
                </button>
              </div>
              <button className="btn btn-ghost" onClick={handleOpenProject} disabled={busy || !!pendingImport}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 7l2-2h6l2 2h8v12H3z" />
                </svg>
                Open existing project…
              </button>
            </div>
          </div>

          {/* ── Page range picker ─────────────────────────────────── */}
          {pendingImport && (
            <div className="mt-6 panel p-5" style={{ maxWidth: '960px' }}>
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="font-serif text-[17px] leading-tight">Select pages to import</div>
                  <div className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--mute)' }}>
                    {pendingImport.mode === 'images'
                      ? `Folder contains `
                      : `${modeLabel[pendingImport.mode]} has `}
                    <span style={{ color: 'var(--ink)' }}>{pendingImport.totalPages}</span>
                    {pendingImport.mode === 'images' ? ' images' : ' pages'} total
                  </div>
                </div>
                <button className="btn btn-quiet !py-1 !px-2 !text-[12px]" onClick={() => setPendingImport(null)}>
                  Cancel
                </button>
              </div>

              {(() => {
                const parsed = parseRange(pendingImport.rangeText, pendingImport.totalPages)
                const valid = parsed.length > 0
                return (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="label mb-1">Pages</div>
                        <input
                          type="text"
                          className="input font-mono"
                          placeholder={`e.g. 1-5,7,9 (total: ${pendingImport.totalPages})`}
                          value={pendingImport.rangeText}
                          onChange={(e) => {
                            const val = e.target.value
                            setPendingImport((p) => {
                              if (!p) return p
                              const updated = { ...p, rangeText: val }
                              const first = parseRange(val, p.totalPages)[0]
                              if (first != null && filmstripRef.current) {
                                const el = filmstripRef.current.querySelector(`[data-page="${first}"]`) as HTMLElement | null
                                el?.scrollIntoView({ block: 'nearest', inline: 'start' })
                              }
                              return updated
                            })
                          }}
                          style={{ borderColor: valid ? undefined : 'var(--oxblood)' }}
                        />
                      </div>
                      <div className="mt-4 font-mono text-[12px]" style={{ color: valid ? 'var(--ink)' : 'var(--oxblood)', fontWeight: 600, minWidth: 60 }}>
                        {valid ? `${parsed.length} pages` : 'invalid'}
                      </div>
                      <div className="mt-4">
                        <button className="btn btn-primary" onClick={handleConfirmImport} disabled={!valid}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
                          </svg>
                          Import {valid ? parsed.length : 0} pages
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex gap-2 flex-wrap">
                      <button className="btn btn-quiet !py-1 !px-2 !text-[11px]" onClick={() => setPendingImport((p) => p && ({ ...p, rangeText: `1-${p.totalPages}` }))}>All</button>
                      <button className="btn btn-quiet !py-1 !px-2 !text-[11px]" onClick={() => setPendingImport((p) => p && ({ ...p, rangeText: `${Math.max(1, Math.round(p.totalPages * 0.05))}-${Math.round(p.totalPages * 0.95)}` }))}>Skip covers (~5%)</button>
                      <button className="btn btn-quiet !py-1 !px-2 !text-[11px]" onClick={() => setPendingImport((p) => p && ({ ...p, rangeText: `1-${Math.ceil(p.totalPages / 2)}` }))}>First half</button>
                      <button className="btn btn-quiet !py-1 !px-2 !text-[11px]" onClick={() => setPendingImport((p) => p && ({ ...p, rangeText: `${Math.floor(p.totalPages / 2) + 1}-${p.totalPages}` }))}>Second half</button>
                      <div className="w-px self-stretch" style={{ background: 'var(--line-2)' }} />
                      <button
                        className="btn btn-quiet !py-1 !px-2 !text-[11px]"
                        title="Keep only odd-numbered pages from the current selection"
                        onClick={() => setPendingImport((p) => {
                          if (!p) return p
                          const base = parseRange(p.rangeText || `1-${p.totalPages}`, p.totalPages)
                          return { ...p, rangeText: compressRange(base.filter((n) => n % 2 === 1)) }
                        })}
                      >Odd pages</button>
                      <button
                        className="btn btn-quiet !py-1 !px-2 !text-[11px]"
                        title="Keep only even-numbered pages from the current selection"
                        onClick={() => setPendingImport((p) => {
                          if (!p) return p
                          const base = parseRange(p.rangeText || `1-${p.totalPages}`, p.totalPages)
                          return { ...p, rangeText: compressRange(base.filter((n) => n % 2 === 0)) }
                        })}
                      >Even pages</button>
                    </div>

                    {/* ── Thumbnail filmstrip ───────────────────────── */}
                    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="label">Preview</span>
                        {thumbProgress && (
                          <span className="font-mono text-[10px]" style={{ color: 'var(--mute)' }}>
                            Loading {thumbProgress.cur}/{thumbProgress.total}…
                          </span>
                        )}
                      </div>
                      <div
                        ref={filmstripRef}
                        className="flex gap-2 overflow-x-auto"
                        style={{ height: filmstripHeight, alignItems: 'flex-start', scrollbarWidth: 'thin', scrollbarColor: 'var(--line-2) transparent' }}
                      >
                        {Array.from({ length: pendingImport.totalPages }, (_, i) => i + 1).map((n) => {
                          const selected = parsed.includes(n)
                          const thumb = thumbnails[n - 1]
                          const thumbH = filmstripHeight - 6  // leave a little room
                          return (
                            <div
                              key={n} data-page={n}
                              className="group/thumb"
                              style={{
                                flexShrink: 0, height: thumbH, position: 'relative',
                                outline: selected ? '2.5px solid var(--oxblood)' : '2px solid var(--line)',
                                outlineOffset: 2, borderRadius: 4, overflow: 'hidden',
                                background: 'var(--paper-3)', opacity: selected ? 1 : 0.4,
                                transition: 'opacity 0.1s'
                              }}
                            >
                              <button
                                title={`View page ${n}`}
                                onClick={() => setZoomedPage(n)}
                                style={{ display: 'block', height: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}
                              >
                                {thumb
                                  ? <img src={thumb} alt={`Page ${n}`} style={{ display: 'block', height: '100%', width: 'auto' }} draggable={false} />
                                  : <div style={{ height: '100%', width: Math.round(thumbH * 0.72), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ color: 'var(--mute-2)' }}>
                                        <path d="M21 12a9 9 0 1 1-6.3-8.6"/>
                                      </svg>
                                    </div>
                                }
                              </button>

                              <div style={{
                                position: 'absolute', bottom: 0, left: 0, right: 0,
                                textAlign: 'center', fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
                                background: selected ? 'var(--oxblood)' : 'rgba(0,0,0,0.4)',
                                color: '#fff', padding: '2px 0', pointerEvents: 'none'
                              }}>{n}</div>

                              <button
                                className="opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                                title={selected ? 'Remove from selection' : 'Add to selection'}
                                onClick={() => setPendingImport((p) => p && ({ ...p, rangeText: togglePage(p.rangeText, n, p.totalPages) }))}
                                style={{
                                  position: 'absolute', top: 3, right: 3,
                                  width: 18, height: 18, borderRadius: '50%', border: 'none',
                                  background: selected ? 'var(--oxblood)' : 'rgba(255,255,255,0.85)',
                                  color: selected ? '#fff' : 'var(--ink)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  cursor: 'pointer', fontSize: 12, fontWeight: 700, lineHeight: 1
                                }}
                              >{selected ? '×' : '+'}</button>
                            </div>
                          )
                        })}
                      </div>

                      {/* Drag handle */}
                      <div
                        onMouseDown={handleResizeStart}
                        style={{ height: 10, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}
                      >
                        <div style={{ width: 36, height: 3, borderRadius: 2, background: 'var(--line-2)' }} />
                      </div>

                      <div className="text-[10.5px] mt-1" style={{ color: 'var(--mute)' }}>
                        Click thumbnail to preview · +/× to add/remove · drag handle to resize · nothing saved until you choose a folder
                      </div>
                    </div>
                  </>
                )
              })()}

            </div>
          )}

          {/* ── Render progress ───────────────────────────────────── */}
          {importStep && (
            <div className="mt-6 max-w-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[12px]" style={{ color: 'var(--mute)' }}>{importStep}</span>
                {importProgress && (
                  <span className="font-mono text-[12px]" style={{ color: 'var(--ink)' }}>
                    {importProgress.cur} / {importProgress.total}
                  </span>
                )}
              </div>
              <div className="progress">
                <div
                  className="progress-bar"
                  style={{
                    width: importProgress ? `${(importProgress.cur / importProgress.total) * 100}%` : '60%',
                    background: importProgress ? undefined : 'var(--mute-2)',
                    animation: importProgress ? undefined : 'pulse 1.2s ease-in-out infinite'
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Recent projects ────────────────────────────────────── */}
        {recent.length > 0 && (
          <div className="px-10 pt-8 pb-10">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="font-serif text-[22px]">Recent projects</h2>
              <span className="text-[12px]" style={{ color: 'var(--mute)' }}>{recent.length} total</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {recent.map((p) => {
                const progress = projectProgress(p)
                const done = progress === 100
                return (
                  <article
                    key={p.id}
                    className="group panel p-4 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => openRecent(p)}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <span className={`badge ${done ? 'badge-ocr' : p.pages.some((pg) => pg.status === 'masked') ? 'badge-masked' : 'badge-pending'}`}>
                        {done && <span className="dot dot-ok" />}
                        {STATUS_LABEL[done ? 'ocr_done' : p.pages.some((pg) => pg.status === 'masked') ? 'masked' : 'pending']}
                      </span>
                      <span className="font-mono text-[10.5px] mr-auto" style={{ color: 'var(--mute)' }}>
                        {timeAgo(p.updatedAt)}
                      </span>
                      <button
                        onClick={(e) => removeRecent(e, p)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded hover:bg-black/10 shrink-0"
                        title="Remove from list"
                        style={{ color: 'var(--mute)' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <h3 className="font-serif text-[18px] leading-tight">{p.name}</h3>
                    {p.metadata.author && (
                      <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--mute)' }}>
                        {p.metadata.author}{p.metadata.edition ? ` · ${p.metadata.edition}` : ''}
                      </div>
                    )}
                    <div className="mt-4 flex items-baseline justify-between font-mono tabular-nums">
                      <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                        <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                          {p.pages.filter((pg) => pg.status === 'ocr_done').length}
                        </span>{' '}/ {p.pages.length} pages
                      </div>
                      <div className="text-[11px] font-semibold" style={{ color: done ? 'var(--moss)' : 'var(--oxblood)' }}>
                        {p.pages.length ? `${progress}%` : '—'}
                      </div>
                    </div>
                    <div className="progress mt-1.5">
                      <div className="progress-bar" style={{ width: `${progress}%`, background: done ? 'var(--moss)' : undefined }} />
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* ── Zoom lightbox ────────────────────────────────────────── */}
      {zoomedPage !== null && pendingImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(12,10,8,0.82)' }}
          onClick={() => setZoomedPage(null)}
        >
          {/* Prev */}
          <button
            onClick={(e) => { e.stopPropagation(); setZoomedPage((p) => p !== null ? Math.max(p - 1, 1) : p) }}
            disabled={zoomedPage <= 1}
            style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
            className="btn btn-ghost !px-2 !py-3 opacity-70 hover:opacity-100 disabled:opacity-20"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>

          {/* Image */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '80vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
          >
            {thumbnails[zoomedPage - 1]
              ? <img
                  src={thumbnails[zoomedPage - 1]}
                  alt={`Page ${zoomedPage}`}
                  style={{ maxWidth: '80vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
                  draggable={false}
                />
              : <div style={{ width: 400, height: 560, background: 'var(--paper-3)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin" style={{ color: 'var(--mute-2)' }}>
                    <path d="M21 12a9 9 0 1 1-6.3-8.6"/>
                  </svg>
                </div>
            }

            {/* Controls bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: 12 }}>
                Page {zoomedPage} / {pendingImport.totalPages}
              </span>
              <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.2)' }} />
              <button
                className="btn btn-quiet"
                style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}
                onClick={() => setPendingImport((p) => p && ({ ...p, rangeText: togglePage(p.rangeText, zoomedPage, p.totalPages) }))}
              >{pendingImport && parseRange(pendingImport.rangeText, pendingImport.totalPages).includes(zoomedPage) ? '× Remove' : '+ Add'}</button>
              <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.2)' }} />
              <button
                className="btn btn-quiet"
                style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                onClick={() => setZoomedPage(null)}
              >Close <kbd style={{ fontSize: 10, opacity: 0.6 }}>Esc</kbd></button>
            </div>
          </div>

          {/* Next */}
          <button
            onClick={(e) => { e.stopPropagation(); setZoomedPage((p) => p !== null ? Math.min(p + 1, pendingImport.totalPages) : p) }}
            disabled={zoomedPage >= pendingImport.totalPages}
            style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
            className="btn btn-ghost !px-2 !py-3 opacity-70 hover:opacity-100 disabled:opacity-20"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      )}

      {/* ── Error modal ──────────────────────────────────────────── */}
      {errorMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(20,16,12,0.55)' }}
          onClick={() => setErrorMessage(null)}
        >
          <div
            className="panel p-6 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="mt-0.5 shrink-0" style={{ color: 'var(--oxblood)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
                </svg>
              </div>
              <div>
                <div className="font-serif text-[18px] leading-tight mb-1">{errorMessage.title}</div>
                <pre
                  className="text-[11.5px] leading-relaxed whitespace-pre-wrap font-mono mt-2 p-3 rounded"
                  style={{ background: 'var(--paper-3)', color: 'var(--mute)', maxHeight: 200, overflowY: 'auto' }}
                >
                  {errorMessage.detail}
                </pre>
              </div>
            </div>
            <div className="flex justify-end">
              <button className="btn btn-ghost" onClick={() => setErrorMessage(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  )
}
