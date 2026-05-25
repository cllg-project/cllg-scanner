import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { Page, Mask } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'

type Tool = 'pointer' | 'rect'

const FILL_WHITE = '#ffffff'
const FILL_BLACK = '#000000'

function StatusBadge({ status }: { status: Page['status'] }): React.JSX.Element {
  const map: Record<Page['status'], string> = {
    pending: 'badge-pending',
    masked: 'badge-masked',
    ocr_done: 'badge-ocr',
    skipped: 'badge-skipped',
    error: 'badge-error'
  }
  const labels: Record<Page['status'], string> = {
    pending: 'Pend',
    masked: 'Mask',
    ocr_done: 'OCR',
    skipped: 'Skip',
    error: 'Err'
  }
  return <span className={`badge ${map[status]}`}>{labels[status]}</span>
}

export default function Masker(): React.JSX.Element {
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

  const pages = project?.pages ?? []
  const page: Page | undefined = pages[selectedPageIdx]

  // Load image when page changes
  useEffect(() => {
    if (!page?.imagePath) return
    setKonvaImg(null)
    window.api.loadImageAsDataUrl(page.imagePath).then((dataUrl) => {
      const img = new window.Image()
      img.onload = () => {
        setKonvaImg(img)
        // Fit to canvas: base display width ~600px
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

  if (!project) return <div className="p-8">No project open.</div>

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
            <div className="font-serif text-[15px] leading-tight">Pages</div>
            <div className="font-mono text-[10.5px]" style={{ color: 'var(--mute)' }}>
              {pages.length} total · {pages.filter((p) => p.status === 'masked').length} masked
            </div>
          </div>
        </div>
        <div className="overflow-y-auto px-3 py-3 grid grid-cols-2 gap-2.5">
          {pages.map((p, i) => (
            <div key={p.n} className="space-y-1">
              <div
                className={`relative cursor-pointer rounded overflow-hidden border ${i === selectedPageIdx ? 'border-[color:var(--oxblood)] shadow-[0_0_0_2px_var(--oxblood)]' : 'border-[color:var(--line-2)]'}`}
                style={{ aspectRatio: '3/4', background: '#fff' }}
                onClick={() => setSelectedPageIdx(i)}
              >
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
      </aside>

      {/* Main canvas area */}
      <main className="flex-1 flex flex-col" style={{ background: 'var(--paper-3)' }}>
        {/* Toolbar */}
        <div className="toolbar">
          <button
            className={`tool-btn ${tool === 'pointer' ? 'active' : ''}`}
            onClick={() => setTool('pointer')}
            title="Pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 4 6 16 2-7 7-2z" />
            </svg>
          </button>
          <button
            className={`tool-btn ${tool === 'rect' ? 'active' : ''}`}
            onClick={() => setTool('rect')}
            title="Rectangle mask"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="6" width="16" height="12" rx="1" />
            </svg>
          </button>

          <div className="tool-sep" />

          {/* Fill color */}
          <span className="text-[11px] mr-1" style={{ color: 'var(--mute)' }}>Fill</span>
          <button
            className={`w-7 h-7 rounded border-2 bg-white ${fillColor === FILL_WHITE ? 'border-[color:var(--oxblood)]' : 'border-[color:var(--line-2)]'}`}
            onClick={() => setFillColor(FILL_WHITE)}
            title="White"
          />
          <button
            className={`w-7 h-7 rounded border bg-[#1a1714] ${fillColor === FILL_BLACK ? 'border-[color:var(--oxblood)]' : 'border-[color:var(--line-2)]'}`}
            onClick={() => setFillColor(FILL_BLACK)}
            title="Black"
          />

          <div className="tool-sep" />

          <button
            className="tool-btn"
            onClick={deleteSelected}
            title="Delete selected"
            disabled={selectedRectId === null}
            style={{ color: selectedRectId !== null ? 'var(--oxblood)' : undefined }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
            </svg>
          </button>

          <div className="tool-sep" />

          <button className="btn btn-quiet !py-1.5 text-[12px]" onClick={copyMasksToAll} title="Copy current page masks to all pages">
            Copy to all pages
          </button>

          <span className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--paper-2)', color: 'var(--mute)' }}>
            Draw rectangles to cover <span style={{ color: 'var(--ink)' }}>apparatus criticus</span> and marginalia — masked areas are whited out before OCR
            {project?.pages.some((p) => p.masks.length > 0) && (
              <> · {project.pages.filter((p) => p.masks.length > 0).length} pages masked</>
            )}
          </span>

          <div className="tool-sep" />

          <button
            className="btn btn-quiet !py-1.5 text-[12px]"
            onClick={() => project && window.api.exportCOCO(project)}
            title="Export all masks as COCO JSON (class: ApparatusCriticus)"
            disabled={!project?.pages.some((p) => p.masks.length > 0)}
          >
            Export COCO
          </button>

          <div className="ml-auto flex items-center gap-2 text-[12px]" style={{ color: 'var(--mute)' }}>
            <span>
              p. <span className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>{page?.n}</span>
            </span>
            <span>·</span>
            <span>{page?.masks.length ?? 0} masks</span>
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
              <span className="font-mono text-[12px]" style={{ color: 'var(--mute)' }}>Loading…</span>
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
              <span style={{ color: 'var(--mute)' }}>Skip this page</span>
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
              Next: OCR Run
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
