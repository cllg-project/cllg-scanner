import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { Page, Mask } from '@shared/types'
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
import type * as pdfjs from 'pdfjs-dist'

type Tool = 'pointer' | 'rect'

const FILL_WHITE = '#ffffff'
const FILL_BLACK = '#000000'
const MAX_EXAMPLES = 3
const CURRENT_STEP = 2

function StatusBadge({ status }: { status: Page['status'] }): React.JSX.Element {
  const { t } = useTranslation()
  const map: Record<Page['status'], string> = {
    pending: 'badge-pending',
    masked: 'badge-masked',
    ocr_done: 'badge-ocr',
    skipped: 'badge-skipped',
    error: 'badge-error'
  }
  const labels: Record<Page['status'], string> = {
    pending: t('masker.statusPend'),
    masked: t('masker.statusMask'),
    ocr_done: t('masker.statusOcr'),
    skipped: t('masker.statusSkip'),
    error: t('masker.statusErr')
  }
  return <span className={`badge ${map[status]}`}>{labels[status]}</span>
}

// ── Add Pages Modal ──────────────────────────────────────────────────────────

type AddImportMode = 'pdf' | 'djvu' | 'images'

interface PendingAdd {
  mode: AddImportMode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: pdfjs.PDFDocumentProxy | any | null
  imagePaths: string[]
  totalPages: number
  rangeText: string
}

interface AddPagesModalProps {
  pending: PendingAdd | null
  thumbnails: string[]
  thumbProgress: { cur: number; total: number } | null
  importProgress: { cur: number; total: number } | null
  onPickSource: (mode: 'document' | 'folder' | 'images') => void
  onRangeChange: (r: string) => void
  onTogglePage: (n: number) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onConfirm: () => void
  onClose: () => void
}

function AddPagesModal({
  pending, thumbnails, thumbProgress, importProgress,
  onPickSource, onRangeChange, onTogglePage, onSelectAll, onDeselectAll,
  onConfirm, onClose
}: AddPagesModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const selectedNums = pending ? parseRange(pending.rangeText, pending.totalPages) : []
  const selectedSet = new Set(selectedNums)
  const [thumbSize, setThumbSize] = useState<80 | 120 | 160>(80)

  // Importing in progress
  if (importProgress) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,.45)' }}>
        <div className="rounded-lg shadow-2xl w-[400px] overflow-hidden" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
          <div className="px-6 py-8 flex flex-col items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ color: 'var(--oxblood)' }}>
              <path d="M21 12a9 9 0 1 1-6.3-8.6" />
            </svg>
            <div className="text-[13px]">{t('masker.importingPage', { cur: importProgress.cur, total: importProgress.total })}</div>
            <div className="w-full progress mt-1">
              <div className="progress-bar" style={{ width: `${Math.round((importProgress.cur / importProgress.total) * 100)}%` }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,.45)' }}>
      <div className="rounded-lg shadow-2xl overflow-hidden flex flex-col" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', width: pending ? 640 : 360, maxHeight: '85vh' }}>
        <div className="px-6 pt-5 pb-3 border-b shrink-0" style={{ borderColor: 'var(--line)' }}>
          <div className="font-serif text-[20px]">{t('masker.addPages')}</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--mute)' }}>
            {pending ? t('masker.pagesFound', { count: pending.totalPages }) : t('masker.addPagesSubtitle')}
          </div>
        </div>

        {/* Step 1: source selection */}
        {!pending && (
          <div className="px-6 py-5 flex flex-col gap-3">
            <button className="btn btn-ghost w-full justify-start gap-3 !py-3" onClick={() => onPickSource('document')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 4h10l4 4v12H4z" /><path d="M14 4v4h4" />
              </svg>
              <div className="text-left">
                <div className="text-[13px] font-medium">{t('masker.pdfOrDjvu')}</div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{t('masker.pdfOrDjvuSubtitle')}</div>
              </div>
            </button>
            <button className="btn btn-ghost w-full justify-start gap-3 !py-3" onClick={() => onPickSource('folder')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 7l2-2h6l2 2h8v12H3z" />
              </svg>
              <div className="text-left">
                <div className="text-[13px] font-medium">{t('masker.imageFolder')}</div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{t('masker.imageFolderSubtitle')}</div>
              </div>
            </button>
            <button className="btn btn-ghost w-full justify-start gap-3 !py-3" onClick={() => onPickSource('images')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 15 5-5 4 4 3-3 5 5" />
              </svg>
              <div className="text-left">
                <div className="text-[13px] font-medium">{t('masker.individualImages')}</div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{t('masker.individualImagesSubtitle')}</div>
              </div>
            </button>
          </div>
        )}

        {/* Step 2: page selection */}
        {pending && (
          <>
            {/* Range controls */}
            <div className="px-4 py-3 border-b flex items-center gap-3 shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
              <input
                className="input font-mono text-[12px] flex-1"
                placeholder={`e.g. 1-${pending.totalPages} or 1,3,5-8`}
                value={pending.rangeText}
                onChange={(e) => onRangeChange(e.target.value)}
              />
              <button className="btn btn-quiet !py-1 !text-[11.5px]" onClick={onSelectAll}>{t('common.all')}</button>
              <button className="btn btn-quiet !py-1 !text-[11.5px]" onClick={onDeselectAll}>{t('common.none')}</button>
              <span className="text-[11.5px] tabular-nums font-mono shrink-0" style={{ color: 'var(--mute)' }}>
                {t('masker.selected', { count: selectedNums.length, total: pending.totalPages })}
              </span>
              <div className="flex border rounded overflow-hidden shrink-0" style={{ borderColor: 'var(--line-2)' }}>
                {([80, 120, 160] as const).map((size, si) => (
                  <button
                    key={size}
                    className="!py-0.5 !px-2 text-[11px]"
                    style={{
                      background: thumbSize === size ? 'var(--oxblood)' : 'var(--paper-2)',
                      color: thumbSize === size ? '#fff' : 'var(--mute)',
                      borderLeft: si > 0 ? '1px solid var(--line-2)' : undefined,
                      cursor: 'pointer'
                    }}
                    onClick={() => setThumbSize(size)}
                  >
                    {['S', 'M', 'L'][si]}
                  </button>
                ))}
              </div>
            </div>

            {/* Thumbnail filmstrip */}
            <div className="overflow-y-auto flex-1 px-4 py-3">
              {thumbProgress && thumbProgress.cur < thumbProgress.total && (
                <div className="text-[11px] mb-2" style={{ color: 'var(--mute)' }}>
                  {t('masker.importingPage', { cur: thumbProgress.cur, total: thumbProgress.total })}
                </div>
              )}
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
                {Array.from({ length: pending.totalPages }, (_, i) => i + 1).map((n) => {
                  const thumb = thumbnails[n - 1]
                  const selected = selectedSet.has(n)
                  return (
                    <div
                      key={n}
                      className="cursor-pointer flex flex-col items-center gap-1"
                      onClick={() => onTogglePage(n)}
                    >
                      <div
                        className={`relative rounded overflow-hidden border-2 w-full transition-colors ${selected ? 'border-[color:var(--oxblood)] shadow-[0_0_0_1px_var(--oxblood)]' : 'border-[color:var(--line-2)]'}`}
                        style={{ aspectRatio: '3/4', background: '#f0ede8' }}
                      >
                        {thumb ? (
                          <img src={thumb} alt={`Page ${n}`} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--mute)' }}>
                              <path d="M21 12a9 9 0 1 1-6.3-8.6" className="animate-spin origin-center" />
                            </svg>
                          </div>
                        )}
                        {selected && (
                          <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--oxblood)' }}>
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="m5 12 5 5 9-12" /></svg>
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[9px]" style={{ color: selected ? 'var(--ink)' : 'var(--mute)' }}>{n}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <div className="px-6 py-4 border-t flex justify-between items-center shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
          <button className="btn btn-quiet" onClick={onClose}>{t('common.cancel')}</button>
          {pending && (
            <button
              className="btn btn-primary"
              disabled={selectedNums.length === 0}
              onClick={onConfirm}
            >
              {t('masker.importPages', { count: selectedNums.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Masker(): React.JSX.Element {
  const { t } = useTranslation()
  const STEP_LABELS = [t('steps.import'), t('steps.mask'), t('steps.ocr'), t('steps.config'), t('steps.review'), t('steps.tei')]
  const { project, saveProject } = useProject()
  const navigate = useNavigate()

  const [selectedPageIdx, setSelectedPageIdx] = useState(0)
  const [tool, setTool] = useState<Tool>('rect')
  const [fillColor, setFillColor] = useState(FILL_WHITE)
  const [zoom, setZoom] = useState(1)
  const [konvaImg, setKonvaImg] = useState<HTMLImageElement | null>(null)
  const [selectedRectId, setSelectedRectId] = useState<number | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const rectRefs = useRef<Map<number, Konva.Rect>>(new Map())

  // Filmstrip thumbnails
  const [filmstripImages, setFilmstripImages] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    if (!project) return
    let cancelled = false
    const load = async (): Promise<void> => {
      for (const p of project.pages) {
        if (cancelled) break
        if (filmstripImages.has(p.n)) continue
        const abs = await window.api.joinPaths(project.projectDir, p.imagePath)
        const url = await window.api.loadImageAsDataUrl(abs)
        if (cancelled) break
        setFilmstripImages((prev) => {
          const next = new Map(prev)
          next.set(p.n, url)
          return next
        })
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.pages.length, project?.id])

  // Add Pages state
  const [showAddPages, setShowAddPages] = useState(false)
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null)
  const [addThumbnails, setAddThumbnails] = useState<string[]>([])
  const [addThumbProgress, setAddThumbProgress] = useState<{ cur: number; total: number } | null>(null)
  const [addImportProgress, setAddImportProgress] = useState<{ cur: number; total: number } | null>(null)
  const [exampleWarning, setExampleWarning] = useState(false)

  // Drag-to-reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const pages = project?.pages ?? []
  const page: Page | undefined = pages[selectedPageIdx]

  // Load image when page changes
  useEffect(() => {
    if (!page?.imagePath) return
    setKonvaImg(null)
    window.api.joinPaths(project!.projectDir, page.imagePath)
      .then((abs) => window.api.loadImageAsDataUrl(abs))
      .then((dataUrl) => {
        const img = new window.Image()
        img.onload = () => {
          setKonvaImg(img)
          const fitZoom = Math.min(600 / img.naturalWidth, 800 / img.naturalHeight)
          setZoom(Math.min(fitZoom, 1))
        }
        img.src = dataUrl
      })
  }, [page?.imagePath])

  // Sync transformer to selected rect
  useEffect(() => {
    if (!transformerRef.current) return
    if (selectedRectId !== null && rectRefs.current.has(selectedRectId)) {
      transformerRef.current.nodes([rectRefs.current.get(selectedRectId)!])
    } else {
      transformerRef.current.nodes([])
    }
    transformerRef.current.getLayer()?.batchDraw()
  }, [selectedRectId])

  const updateMasks = useCallback(
    async (masks: Mask[]) => {
      if (!project || !page) return
      const updatedPages = project.pages.map((p, i) =>
        i === selectedPageIdx
          ? { ...p, masks, status: masks.length > 0 ? ('masked' as const) : ('pending' as const) }
          : p
      )
      const updated = { ...project, pages: updatedPages }
      await saveProject(updated)
    },
    [project, page, selectedPageIdx, saveProject]
  )

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (tool !== 'rect' || !konvaImg) return
      if (e.target !== stageRef.current && e.target.getClassName() !== 'Image') return
      const pos = stageRef.current!.getPointerPosition()!
      drawStartRef.current = { x: pos.x / zoom, y: pos.y / zoom }
      setIsDrawing(true)
      setSelectedRectId(null)
    },
    [tool, konvaImg, zoom]
  )

  const handleStageMouseMove = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isDrawing || !drawStartRef.current || !stageRef.current) return
      const pos = stageRef.current.getPointerPosition()!
      const x1 = drawStartRef.current.x
      const y1 = drawStartRef.current.y
      const x2 = pos.x / zoom
      const y2 = pos.y / zoom
      setDraftRect({
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1)
      })
    },
    [isDrawing, zoom]
  )

  const handleStageMouseUp = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isDrawing || !drawStartRef.current) return
      setIsDrawing(false)
      setDraftRect(null)
      const pos = stageRef.current!.getPointerPosition()!
      const x1 = drawStartRef.current.x
      const y1 = drawStartRef.current.y
      const x2 = pos.x / zoom
      const y2 = pos.y / zoom
      const w = Math.abs(x2 - x1)
      const h = Math.abs(y2 - y1)
      if (w < 4 || h < 4) return
      const newMask: Mask = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: w,
        height: h,
        fill: fillColor
      }
      updateMasks([...(page?.masks ?? []), newMask])
    },
    [isDrawing, zoom, fillColor, page, updateMasks]
  )

  const deleteSelected = useCallback(() => {
    if (selectedRectId === null || !page) return
    const newMasks = page.masks.filter((_, i) => i !== selectedRectId)
    setSelectedRectId(null)
    updateMasks(newMasks)
  }, [selectedRectId, page, updateMasks])

  const copyMasksToAll = useCallback(async () => {
    if (!project || !page) return
    const srcMasks = page.masks
    const updatedPages = project.pages.map((p) => ({
      ...p,
      masks: srcMasks,
      status: (srcMasks.length > 0 ? 'masked' : p.status) as Page['status']
    }))
    await saveProject({ ...project, pages: updatedPages })
  }, [project, page, saveProject])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'd') setTool('rect')
      else if (e.key === 's') setTool('pointer')
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSelected])

  const toggleSkip = useCallback(async () => {
    if (!project || !page) return
    const newStatus: Page['status'] =
      page.status === 'skipped' ? 'pending' : 'skipped'
    const updatedPages = project.pages.map((p, i) =>
      i === selectedPageIdx ? { ...p, status: newStatus } : p
    )
    await saveProject({ ...project, pages: updatedPages })
  }, [project, page, selectedPageIdx, saveProject])

  // ── Example page toggle ────────────────────────────────────────────────────

  const toggleExample = useCallback(async (pageIdx: number) => {
    if (!project) return
    const targetPage = project.pages[pageIdx]
    if (!targetPage) return

    const currentExamples = project.pages.filter((p) => p.isExample).length

    if (!targetPage.isExample && currentExamples >= MAX_EXAMPLES) {
      setExampleWarning(true)
      setTimeout(() => setExampleWarning(false), 2500)
      return
    }

    const updatedPages = project.pages.map((p, i) =>
      i === pageIdx ? { ...p, isExample: !p.isExample } : p
    )
    await saveProject({ ...project, pages: updatedPages })
  }, [project, saveProject])

  // ── Add Pages — step 1: pick source, load doc, generate thumbnails ──────────

  const handlePickSource = useCallback(async (mode: 'document' | 'folder' | 'images') => {
    let addMode: AddImportMode = 'images'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let doc: pdfjs.PDFDocumentProxy | any | null = null
    let imagePaths: string[] = []
    let totalPages = 0

    if (mode === 'document') {
      const sourcePath = await window.api.selectDocument()
      if (!sourcePath) return
      const bytes = await window.api.loadPDFData(sourcePath)
      const magic = detectFormatFromBytes(bytes)
      const fmt: 'pdf' | 'djvu' = magic !== 'unknown' ? magic : formatFromExtension(sourcePath)
      const result = await tryLoadDocument(fmt, bytes)
      addMode = fmt
      doc = result.doc
      totalPages = result.totalPages
    } else if (mode === 'folder') {
      const dirPath = await window.api.selectImageDir()
      if (!dirPath) return
      const files = await window.api.listImagesInDir(dirPath)
      if (!files.length) return
      addMode = 'images'
      imagePaths = files.map((f) => f.path)
      totalPages = imagePaths.length
    } else {
      const filePaths = await window.api.selectImages()
      if (!filePaths.length) return
      addMode = 'images'
      imagePaths = filePaths
      totalPages = filePaths.length
    }

    const pending: PendingAdd = {
      mode: addMode, doc, imagePaths, totalPages,
      rangeText: `1-${totalPages}`
    }
    setPendingAdd(pending)
    setAddThumbnails([])
    setAddThumbProgress({ cur: 0, total: totalPages })

    // Generate thumbnails progressively
    const thumbs: string[] = []
    for (let i = 1; i <= totalPages; i++) {
      let url: string
      if (addMode === 'pdf') {
        url = await pdfThumbnail(doc as pdfjs.PDFDocumentProxy, i)
      } else if (addMode === 'djvu') {
        url = await djvuThumbnail(doc, i)
      } else {
        url = await imageThumbnail(imagePaths[i - 1])
      }
      thumbs.push(url)
      setAddThumbnails([...thumbs])
      setAddThumbProgress({ cur: i, total: totalPages })
    }
    setAddThumbProgress(null)
  }, [])

  // ── Add Pages — step 2: import selected pages ────────────────────────────

  const handleConfirmAdd = useCallback(async () => {
    if (!project || !pendingAdd) return
    const { mode, doc, imagePaths, totalPages, rangeText } = pendingAdd
    const pageNums = parseRange(rangeText, totalPages)
    if (!pageNums.length) return

    try {
      let updated = project
      if (mode === 'pdf') {
        updated = await renderPDFPages(
          doc as pdfjs.PDFDocumentProxy, project, pageNums,
          (cur, total) => setAddImportProgress({ cur, total })
        )
      } else if (mode === 'djvu') {
        updated = await renderDjVuPages(
          doc, project, pageNums,
          (cur, total) => setAddImportProgress({ cur, total })
        )
      } else {
        const selectedPaths = pageNums.map((n) => imagePaths[n - 1])
        updated = await importImagePages(
          selectedPaths, project,
          (cur, total) => setAddImportProgress({ cur, total })
        )
      }
      await saveProject(updated)
    } finally {
      setAddImportProgress(null)
      setPendingAdd(null)
      setAddThumbnails([])
      setShowAddPages(false)
    }
  }, [project, pendingAdd, saveProject])

  const handleCloseAddPages = useCallback(() => {
    setShowAddPages(false)
    setPendingAdd(null)
    setAddThumbnails([])
    setAddThumbProgress(null)
  }, [])

  // ── Drag-to-reorder ────────────────────────────────────────────────────────

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    setDragOverIdx(idx)
  }, [])

  const handleDrop = useCallback(async (dropIdx: number) => {
    if (!project || dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null)
      setDragOverIdx(null)
      return
    }

    const reordered = [...project.pages]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(dropIdx, 0, moved)

    // Renumber sequentially
    const renumbered = reordered.map((p, i) => ({ ...p, n: i + 1 }))
    setSelectedPageIdx(dropIdx)
    setDragIdx(null)
    setDragOverIdx(null)
    await saveProject({ ...project, pages: renumbered })
  }, [project, dragIdx, saveProject])

  if (!project) return <div className="p-8">{t('common.noProjectOpen')}</div>

  const stageW = konvaImg ? konvaImg.naturalWidth * zoom : 600
  const stageH = konvaImg ? konvaImg.naturalHeight * zoom : 800

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      {/* Filmstrip */}
      <aside
        className="w-[220px] shrink-0 flex flex-col"
        style={{ background: 'var(--paper-3)', borderRight: '1px solid var(--line-2)' }}
      >
        <div className="px-3 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--line-2)' }}>
          <div>
            <div className="font-serif text-[15px] leading-tight">{t('masker.pages')}</div>
            <div className="font-mono text-[10.5px]" style={{ color: 'var(--mute)' }}>
              {t('masker.pagesStats', { total: pages.length, masked: pages.filter((p) => p.status === 'masked').length })}
            </div>
          </div>
        </div>

        {exampleWarning && (
          <div className="mx-3 mt-2 px-2 py-1.5 rounded text-[11px]"
            style={{ background: '#fdf3d0', border: '1px solid #e8c84a', color: '#7a6010' }}>
            {t('masker.maxExamples', { count: MAX_EXAMPLES })}
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-3 py-3 grid grid-cols-2 gap-2.5 content-start">
          {pages.map((p, i) => (
            <div
              key={p.n}
              className="space-y-1"
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
              style={{
                opacity: dragIdx === i ? 0.4 : 1,
                outline: dragOverIdx === i && dragIdx !== i ? '2px solid var(--oxblood)' : undefined,
                borderRadius: 4,
                cursor: 'grab'
              }}
            >
              <div
                className={`relative cursor-pointer rounded overflow-hidden border ${i === selectedPageIdx ? 'border-[color:var(--oxblood)] shadow-[0_0_0_2px_var(--oxblood)]' : 'border-[color:var(--line-2)]'}`}
                style={{ aspectRatio: '3/4', background: '#f0ede8' }}
                onClick={() => setSelectedPageIdx(i)}
              >
                {filmstripImages.has(p.n) ? (
                  <img src={filmstripImages.get(p.n)} alt={`Page ${p.n}`} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--mute)', opacity: 0.4 }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 15 5-5 4 4 3-3 5 5" />
                    </svg>
                  </div>
                )}
                {p.status === 'skipped' && (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-10">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" />
                    </svg>
                  </div>
                )}
                {p.masks.length > 0 && (
                  <div
                    className="absolute bottom-0 left-0 right-0 h-1/4 opacity-40"
                    style={{ background: 'repeating-linear-gradient(45deg, var(--oxblood) 0 4px, transparent 4px 8px)' }}
                  />
                )}
                {/* Star example toggle */}
                <button
                  className="absolute top-1 right-1 z-20 w-5 h-5 flex items-center justify-center rounded"
                  style={{ background: 'rgba(255,255,255,.75)' }}
                  title={p.isExample ? t('masker.removeExample') : t('masker.setExample', { max: MAX_EXAMPLES })}
                  onClick={(e) => { e.stopPropagation(); toggleExample(i) }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill={p.isExample ? '#c89328' : 'none'} stroke={p.isExample ? '#c89328' : '#aaa'} strokeWidth="2">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
                  </svg>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className={`font-mono text-[10px] ${i === selectedPageIdx ? 'font-semibold' : ''}`} style={{ color: i === selectedPageIdx ? 'var(--ink)' : 'var(--mute)' }}>
                  p. {p.n}
                </span>
                <StatusBadge status={p.status} />
              </div>
            </div>
          ))}
        </div>

        {/* Add pages button */}
        <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--line-2)' }}>
          <button
            className="btn btn-quiet w-full !py-2 text-[12px] gap-2"
            onClick={() => setShowAddPages(true)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('masker.addPagesButton')}
          </button>
        </div>
      </aside>

      {/* Main canvas area */}
      <main className="flex-1 flex flex-col" style={{ background: 'var(--paper-3)' }}>
        {/* Step rail */}
        <div className="px-4 pt-3 pb-2 border-b shrink-0 flex items-center gap-1.5" style={{ borderColor: 'var(--line)', background: 'var(--paper-2)', fontSize: 10, color: 'var(--mute)' }}>
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
          <button className="btn btn-primary ml-2" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => navigate('/ocr')}>
            {t('masker.nextOcr')}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
        {/* Toolbar — row 1: description */}
        <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0 text-[11.5px]" style={{ borderColor: 'var(--line)', background: 'var(--paper-2)', color: 'var(--mute)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--mute-2)', flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span>
            {t('masker.instructionsBefore')} <span style={{ color: 'var(--ink)', fontStyle: 'italic' }}>{t('masker.apparatusCriticus')}</span> {t('masker.instructionsAfter')}
          </span>
          {project?.pages.some((p) => p.masks.length > 0) && (
            <span className="font-mono shrink-0" style={{ color: 'var(--moss, #5a8c3f)' }}>
              {t('masker.pagesMasked', { count: project.pages.filter((p) => p.masks.length > 0).length })}
            </span>
          )}
        </div>

        {/* Toolbar — row 2: tools */}
        <div className="toolbar">
          <button
            className={`tool-btn ${tool === 'pointer' ? 'active' : ''}`}
            onClick={() => setTool('pointer')}
            title={t('masker.toolPointer')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 4 6 16 2-7 7-2z" />
            </svg>
          </button>
          <button
            className={`tool-btn ${tool === 'rect' ? 'active' : ''}`}
            onClick={() => setTool('rect')}
            title={t('masker.toolRect')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="6" width="16" height="12" rx="1" />
            </svg>
          </button>

          <div className="tool-sep" />

          {/* Fill color */}
          <span className="text-[11px] mr-1" style={{ color: 'var(--mute)' }}>{t('masker.fillLabel')}</span>
          <button
            className={`w-7 h-7 rounded border-2 bg-white ${fillColor === FILL_WHITE ? 'border-[color:var(--oxblood)]' : 'border-[color:var(--line-2)]'}`}
            onClick={() => setFillColor(FILL_WHITE)}
            title={t('masker.fillWhite')}
          />
          <button
            className={`w-7 h-7 rounded border bg-[#1a1714] ${fillColor === FILL_BLACK ? 'border-[color:var(--oxblood)]' : 'border-[color:var(--line-2)]'}`}
            onClick={() => setFillColor(FILL_BLACK)}
            title={t('masker.fillBlack')}
          />

          <div className="tool-sep" />

          <button
            className="tool-btn"
            onClick={deleteSelected}
            title={t('masker.deleteSelected')}
            disabled={selectedRectId === null}
            style={{ color: selectedRectId !== null ? 'var(--oxblood)' : undefined }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
            </svg>
          </button>

          <div className="tool-sep" />

          <button className="btn btn-quiet !py-1.5 text-[12px]" onClick={copyMasksToAll} title={t('masker.copyToAllTitle')}>
            {t('masker.copyToAll')}
          </button>

          <div className="tool-sep" />

          <button
            className="btn btn-quiet !py-1.5 text-[12px]"
            onClick={() => project && window.api.exportCOCO(project)}
            title={t('masker.exportCocoTitle')}
            disabled={!project?.pages.some((p) => p.masks.length > 0)}
          >
            {t('masker.exportCoco')}
          </button>

          <div className="ml-auto flex items-center gap-2 text-[12px]" style={{ color: 'var(--mute)' }}>
            <span>
              p. <span className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>{page?.n}</span>
            </span>
            <span>·</span>
            <span>{t('masker.masksCount', { count: page?.masks.length ?? 0 })}</span>
          </div>
        </div>

        {/* Canvas */}
        <div
          className="flex-1 relative overflow-auto flex items-start justify-center p-8"
          style={{ background: '#d5cdb8', backgroundImage: 'radial-gradient(rgba(0,0,0,.08) 1px, transparent 1px)', backgroundSize: '14px 14px' }}
        >
          {konvaImg ? (
            <Stage
              ref={stageRef}
              width={stageW}
              height={stageH}
              style={{ boxShadow: '0 20px 50px -20px rgba(0,0,0,.4)', cursor: tool === 'rect' ? 'crosshair' : 'default' }}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onClick={(e) => {
                if (tool === 'pointer' && (e.target === stageRef.current || e.target.getClassName() === 'Image')) {
                  setSelectedRectId(null)
                }
              }}
            >
              <Layer>
                <KonvaImage image={konvaImg} width={stageW} height={stageH} />
                {(page?.masks ?? []).map((mask, i) => (
                  <Rect
                    key={i}
                    ref={(node) => {
                      if (node) rectRefs.current.set(i, node)
                      else rectRefs.current.delete(i)
                    }}
                    x={mask.x * zoom}
                    y={mask.y * zoom}
                    width={mask.width * zoom}
                    height={mask.height * zoom}
                    fill={mask.fill}
                    opacity={mask.fill === FILL_WHITE ? 0.8 : 0.7}
                    stroke={selectedRectId === i ? 'var(--oxblood)' : '#aaa'}
                    strokeWidth={1.5}
                    draggable={tool === 'pointer'}
                    onClick={() => { if (tool === 'pointer') setSelectedRectId(i) }}
                    onDragEnd={(e) => {
                      const newMasks = [...(page?.masks ?? [])]
                      newMasks[i] = { ...newMasks[i], x: e.target.x() / zoom, y: e.target.y() / zoom }
                      updateMasks(newMasks)
                    }}
                    onTransformEnd={(e) => {
                      const node = e.target as Konva.Rect
                      const newMasks = [...(page?.masks ?? [])]
                      newMasks[i] = {
                        ...newMasks[i],
                        x: node.x() / zoom,
                        y: node.y() / zoom,
                        width: (node.width() * node.scaleX()) / zoom,
                        height: (node.height() * node.scaleY()) / zoom
                      }
                      node.scaleX(1); node.scaleY(1)
                      updateMasks(newMasks)
                    }}
                  />
                ))}
                {draftRect && (
                  <Rect
                    x={draftRect.x * zoom}
                    y={draftRect.y * zoom}
                    width={draftRect.width * zoom}
                    height={draftRect.height * zoom}
                    fill={fillColor}
                    opacity={0.4}
                    stroke={fillColor === FILL_WHITE ? '#888' : '#ccc'}
                    strokeWidth={1.5}
                    dash={[6, 3]}
                    listening={false}
                  />
                )}
                <Transformer ref={transformerRef} rotateEnabled={false} />
              </Layer>
            </Stage>
          ) : (
            <div className="flex items-center justify-center w-[420px] h-[560px]" style={{ background: 'var(--paper-2)', border: '1px solid var(--line-2)' }}>
              <span className="font-mono text-[12px]" style={{ color: 'var(--mute)' }}>{t('masker.loading')}</span>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="border-t px-4 h-11 flex items-center gap-4" style={{ borderColor: 'var(--line)', background: 'var(--paper-2)' }}>
          {/* Page nav */}
          <div className="flex items-center gap-1">
            <button
              className="tool-btn"
              onClick={() => setSelectedPageIdx((i) => Math.max(0, i - 1))}
              disabled={selectedPageIdx === 0}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 6-6 6 6 6" /></svg>
            </button>
            <span className="font-mono text-[12px] px-1 tabular-nums">
              {selectedPageIdx + 1} / {pages.length}
            </span>
            <button
              className="tool-btn"
              onClick={() => setSelectedPageIdx((i) => Math.min(pages.length - 1, i + 1))}
              disabled={selectedPageIdx >= pages.length - 1}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>

          <div className="tool-sep h-5" />

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button className="tool-btn" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6" /></svg>
            </button>
            <span className="font-mono text-[12px] w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button className="tool-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" /></svg>
            </button>
            <button className="btn btn-quiet !py-1 !px-2 !text-[11px]" onClick={() => setZoom(1)}>100%</button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <span style={{ color: 'var(--mute)' }}>{t('masker.skipPage')}</span>
              <button
                className={`relative w-9 h-5 rounded-full border transition-colors ${page?.status === 'skipped' ? 'bg-[color:var(--oxblood)] border-[color:var(--oxblood-2)]' : 'border-[color:var(--line-2)]'}`}
                style={{ background: page?.status === 'skipped' ? undefined : 'var(--paper-3)' }}
                onClick={toggleSkip}
              >
                <span
                  className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${page?.status === 'skipped' ? 'left-[18px]' : 'left-0.5'}`}
                />
              </button>
            </label>
            <div className="tool-sep h-5" />
            <button
              className="btn btn-ghost !py-1.5"
              onClick={() => navigate('/ocr')}
            >
              {t('masker.nextOcrRun')}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>
        </div>
      </main>

      {showAddPages && (
        <AddPagesModal
          pending={pendingAdd}
          thumbnails={addThumbnails}
          thumbProgress={addThumbProgress}
          importProgress={addImportProgress}
          onPickSource={handlePickSource}
          onRangeChange={(r) => setPendingAdd((p) => p ? { ...p, rangeText: r } : p)}
          onTogglePage={(n) => setPendingAdd((p) => p ? { ...p, rangeText: togglePage(p.rangeText, n, p.totalPages) } : p)}
          onSelectAll={() => setPendingAdd((p) => p ? { ...p, rangeText: `1-${p.totalPages}` } : p)}
          onDeselectAll={() => setPendingAdd((p) => p ? { ...p, rangeText: '' } : p)}
          onConfirm={handleConfirmAdd}
          onClose={handleCloseAddPages}
        />
      )}
    </div>
  )
}
