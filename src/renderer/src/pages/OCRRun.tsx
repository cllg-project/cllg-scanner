import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { KrakenConfig, OCRProgressEvent, Page } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'
import { renderMaskedPage } from '../utils/renderMaskedPage'
import KrakenModelPicker from '../components/KrakenModelPicker'

interface PageRow {
  page: Page
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  tokens?: number
  elapsedMs?: number
  errorMessage?: string
  fromCache?: boolean
  forceReprocess?: boolean
}

type Filter = 'all' | 'pending' | 'done' | 'errors'

const CURRENT_STEP = 3 // 1-based

export default function OCRRun(): React.JSX.Element {
  const { t } = useTranslation()
  const STEP_LABELS = [t('steps.import'), t('steps.mask'), t('steps.ocr'), t('steps.config'), t('steps.review'), t('steps.tei')]
  const { project, saveProject } = useProject()
  const navigate = useNavigate()

  const [krakenConfig, setKrakenConfig] = useState<KrakenConfig>(
    project?.krakenConfig ?? { segModelPath: '', recModelPath: '', builtinModels: true }
  )
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<PageRow[]>([])
  const [excluded, setExcluded] = useState<Set<number>>(
    () => new Set((project?.pages ?? []).filter((p) => p.status === 'ocr_done').map((p) => p.n))
  )
  const [log, setLog] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!project) return
    setRows(
      project.pages.map((p) => ({
        page: p,
        status: p.status === 'skipped' ? 'skipped' : p.status === 'ocr_done' ? 'done' : 'pending',
        tokens: p.tokens,
        elapsedMs: p.elapsedMs,
      }))
    )
  }, [project])

  useEffect(() => {
    const unsub = window.api.onOCRProgress((e: OCRProgressEvent) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.page.n !== e.pageNum) return r
          return {
            ...r,
            status:
              e.status === 'done' ? 'done'
              : e.status === 'error' ? 'error'
              : e.status === 'skipped' ? 'skipped'
              : 'running',
            tokens: e.tokens ?? r.tokens,
            elapsedMs: e.elapsedMs ?? r.elapsedMs,
            errorMessage: e.errorMessage,
            fromCache: e.fromCache
          }
        })
      )
      const ts = new Date().toISOString().slice(11, 23)
      if (e.status === 'model-reload') {
        addLog(`[${ts}] ${e.logMessage ?? 'model reload'}`)
      } else if (e.status === 'done') {
        if (e.fromCache) {
          addLog(`[${ts}] page[${e.pageNum}] done · (cache)`)
        } else {
          addLog(`[${ts}] page[${e.pageNum}] done · tokens=${e.tokens} elapsed=${((e.elapsedMs ?? 0) / 1000).toFixed(1)}s`)
        }
      } else if (e.status === 'error') {
        addLog(`[${ts}] page[${e.pageNum}] ERROR · ${e.errorMessage}`)
      } else if (e.status === 'started') {
        addLog(`[${ts}] page[${e.pageNum}] started`)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const addLog = (line: string): void => setLog((l) => [...l, line])

  useEffect(() => {
    if (project?.krakenConfig) return
    window.api.getKrakenBuiltinPaths().then((paths) =>
      setKrakenConfig({ segModelPath: paths.segModelPath, recModelPath: paths.recModelPath, builtinModels: true })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.projectDir])

  const updateKrakenConfig = useCallback(
    (cfg: KrakenConfig) => {
      setKrakenConfig(cfg)
      if (project) void saveProject({ ...project, krakenConfig: cfg })
    },
    [project, saveProject]
  )

  const toggleExcluded = useCallback((n: number) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n); else next.add(n)
      return next
    })
  }, [])

  const toggleForceReprocess = useCallback((n: number) => {
    setRows((prev) =>
      prev.map((r) => r.page.n === n ? { ...r, forceReprocess: !r.forceReprocess } : r)
    )
  }, [])

  const startOCR = useCallback(async () => {
    if (!project) return
    setRunning(true)

    const forcedNs = new Set(rows.filter((r) => r.forceReprocess).map((r) => r.page.n))
    const pagesWithReset = project.pages.map((p) =>
      forcedNs.has(p.n) ? { ...p, status: 'pending' as const } : p
    )
    await saveProject({ ...project, pages: pagesWithReset })

    let pagesForOCR = pagesWithReset.filter((p) => !excluded.has(p.n))
    addLog(`[info] Starting OCR · ${pagesForOCR.filter((p) => p.status !== 'skipped').length} pages`)
    if (forcedNs.size > 0) addLog(`[info] Force-reprocessing ${forcedNs.size} page(s): ${[...forcedNs].join(', ')}`)

    const toMask = pagesForOCR.filter((p) => p.masks.length > 0)
    if (toMask.length > 0) {
      addLog(`[info] Applying masks to ${toMask.length} pages…`)
      const maskedPaths = new Map<number, string>()
      for (const p of toMask) {
        try {
          maskedPaths.set(p.n, await renderMaskedPage(project.projectDir, p))
        } catch (err) {
          addLog(`[warn] Mask apply failed for page ${p.n}: ${err}`)
        }
      }
      pagesForOCR = pagesForOCR.map((p) =>
        maskedPaths.has(p.n) ? { ...p, maskedImagePath: maskedPaths.get(p.n) } : p
      )
    }

    await window.api.runKraken(project.projectDir, pagesForOCR, krakenConfig)

    const reloaded = await window.api.reloadProject(project.projectDir)
    await saveProject(reloaded)

    setRunning(false)
    addLog('[info] OCR run complete')
  }, [project, krakenConfig, rows, excluded, saveProject])

  const stopOCR = useCallback(async () => {
    await window.api.stopKraken()
    setRunning(false)
    addLog('[info] OCR stopped by user')
  }, [])

  const doneCount = rows.filter((r) => r.status === 'done').length
  const errorCount = rows.filter((r) => r.status === 'error').length
  const runningCount = rows.filter((r) => r.status === 'running').length
  const pendingCount = rows.filter((r) => r.status === 'pending').length
  const totalActive = rows.filter((r) => r.status !== 'skipped').length
  const pct = totalActive > 0 ? Math.round((doneCount / totalActive) * 100) : 0

  const timedRows = rows.filter((r) => r.status === 'done' && !r.fromCache && r.elapsedMs != null)
  const avgMs = timedRows.length > 0
    ? timedRows.reduce((s, r) => s + (r.elapsedMs ?? 0), 0) / timedRows.length
    : null
  const remainingActive = rows.filter((r) => r.status === 'pending' || r.status === 'running').length
  const etaMs = avgMs != null && remainingActive > 0 ? avgMs * remainingActive : null

  const fmtEta = (ms: number): string => {
    const s = Math.round(ms / 1000)
    if (s < 60) return `~${s} s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return rem > 0 ? `~${m} min ${rem} s` : `~${m} min`
  }

  const filteredRows = rows.filter((r) => {
    const matchesFilter =
      filter === 'all' ? true
      : filter === 'pending' ? (r.status === 'pending' || r.status === 'running')
      : filter === 'done' ? r.status === 'done'
      : r.status === 'error'
    const q = search.trim().toLowerCase()
    const matchesSearch = !q
      || String(r.page.n).includes(q)
      || r.page.imagePath.toLowerCase().includes(q)
    return matchesFilter && matchesSearch
  })

  const basename = (p: string): string => p.split('/').pop() ?? p

  if (!project) return <div className="p-8">{t('common.noProjectOpen')}</div>

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--paper-2)' }}>

        {/* ── Sticky header ── */}
        <div className="px-8 pt-5 pb-4 border-b shrink-0" style={{ borderColor: 'var(--line)', boxShadow: '0 1px 0 var(--line)' }}>

          {/* Step rail */}
          <div className="flex items-center gap-1.5 mb-3" style={{ fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 10, letterSpacing: '.04em', color: 'var(--mute)' }}>
            <span className="text-[10px] tracking-[.18em] uppercase mr-1" style={{ color: 'var(--mute-2)' }}>Step</span>
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

          {/* Title row + run buttons */}
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <h2 className="font-serif text-[26px] leading-none">{t('ocr.title')}</h2>
              <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--mute)' }}>
                {t('ocr.subtitle')}{' '}
                <span className="font-mono" style={{ color: 'var(--ink)' }}>ocr_output.md</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {running ? (
                <button className="btn btn-ghost" onClick={stopOCR}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                  </svg>
                  {t('ocr.stop')}
                </button>
              ) : (
                <>
                  <button className="btn btn-ghost" onClick={startOCR} disabled={running || doneCount === 0}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v6h6" />
                    </svg>
                    {t('ocr.resume')}
                  </button>
                  <button className="btn btn-primary" data-tour="ocr-run" onClick={startOCR} disabled={running}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>
                    {t('ocr.runOcr')}
                  </button>
                </>
              )}
            </div>
          </div>

        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-8 pt-5 pb-6 space-y-5">

          {/* ── Kraken model config ── */}
          <section>
            <div className="panel px-3 py-2.5">
              <h3 className="font-serif text-[15px] leading-none mb-2">{t('review.krakenEngine')}</h3>
              <KrakenModelPicker value={krakenConfig} onChange={updateKrakenConfig} />
            </div>
          </section>

          {/* ── Page queue ── */}
          <section>
            <div className="flex items-end justify-between mb-2">
              <div className="flex items-baseline gap-3">
                <h3 className="font-serif text-[16px]">{t('ocr.pageQueue')}</h3>
                <div className="flex items-center gap-3 text-[11px] font-mono" style={{ color: 'var(--mute)' }}>
                  <span><span className="dot dot-ok mr-0.5" />{t('ocr.statusDone')} <span className="font-semibold" style={{ color: 'var(--ink)' }}>{doneCount}</span></span>
                  {runningCount > 0 && <span><span className="dot dot-warn mr-0.5" />{t('ocr.statusRunning')} <span className="font-semibold" style={{ color: 'var(--ink)' }}>{runningCount}</span></span>}
                  <span><span className="dot mr-0.5" style={{ background: 'var(--mute-2)' }} />{t('ocr.statusPending')} <span className="font-semibold" style={{ color: 'var(--ink)' }}>{pendingCount}</span></span>
                  {errorCount > 0 && <span><span className="dot dot-err mr-0.5" />{t('ocr.statusError')} <span className="font-semibold" style={{ color: 'var(--ink)' }}>{errorCount}</span></span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Filter tabs */}
                <div className="flex p-0.5 rounded-md border gap-0.5" style={{ background: 'var(--paper-3)', borderColor: 'var(--line-2)' }}>
                  {(['all', 'pending', 'done', 'errors'] as Filter[]).map((f) => {
                    const filterLabel: Record<Filter, string> = {
                      all: t('ocr.filterAll'),
                      pending: t('ocr.filterPending'),
                      done: t('ocr.filterDone'),
                      errors: t('ocr.filterErrors'),
                    }
                    return (
                      <button
                        key={f}
                        className="px-2.5 py-1 rounded text-[11.5px] font-medium capitalize"
                        style={{
                          background: filter === f ? 'var(--paper-2)' : 'transparent',
                          color: filter === f ? 'var(--ink)' : 'var(--mute)',
                          boxShadow: filter === f ? '0 1px 2px rgba(0,0,0,.05), 0 0 0 1px rgba(0,0,0,.04)' : undefined
                        }}
                        onClick={() => setFilter(f)}
                      >
                        {f === 'errors' && errorCount > 0
                          ? <><span>{filterLabel[f]}</span> <span style={{ color: 'var(--oxblood)' }}>{errorCount}</span></>
                          : filterLabel[f]}
                      </button>
                    )
                  })}
                </div>
                {/* Search */}
                <div className="relative">
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--mute)' }}>
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    className="input text-[12px]"
                    style={{ paddingLeft: 26, paddingRight: 8, paddingTop: 5, paddingBottom: 5, width: 150 }}
                    placeholder={t('ocr.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="panel overflow-hidden">
              {/* Selection bar */}
              <div className="px-3 py-1.5 flex items-center gap-2 border-b text-[11.5px]" style={{ borderColor: 'var(--line)', background: 'rgba(236,229,214,.6)' }}>
                <span style={{ color: 'var(--mute)' }}>{t('common.all')}</span>
                <button className="btn btn-quiet text-[11.5px]" style={{ padding: '2px 6px' }}
                  onClick={() => setExcluded(new Set())}>{t('ocr.selectAll')}</button>
                <button className="btn btn-quiet text-[11.5px]" style={{ padding: '2px 6px' }}
                  onClick={() => setExcluded(new Set(project.pages.map((p) => p.n)))}>{t('ocr.selectNone')}</button>
                <button className="btn btn-quiet text-[11.5px]" style={{ padding: '2px 6px' }}
                  onClick={() => setExcluded(new Set(project.pages.filter((p) => p.status === 'ocr_done').map((p) => p.n)))}>{t('ocr.selectPendingOnly')}</button>
              </div>

              {/* Table */}
              <div className="overflow-y-auto" style={{ maxHeight: 420 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--paper-3)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ width: 36, padding: '7px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 600 }} />
                      <th style={{ width: 58, padding: '7px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 600 }}>{t('ocr.colPage')}</th>
                      <th style={{ width: 28, padding: '7px 10px', textAlign: 'left', fontSize: 10 }} />
                      <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 600 }}>{t('ocr.colFile')}</th>
                      <th style={{ width: 110, padding: '7px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 600 }}>{t('ocr.colStatus')}</th>
                      <th style={{ width: 90, padding: '7px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 600 }}>{t('ocr.colElapsed')}</th>
                      <th style={{ width: 80, padding: '7px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 600 }}>{t('ocr.colTokens')}</th>
                      <th style={{ width: 70, padding: '7px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 600 }}>{t('ocr.colTokPerSec')}</th>
                      <th style={{ width: 60, padding: '7px 10px', textAlign: 'right', fontSize: 10 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => {
                      const isExcluded = excluded.has(r.page.n)
                      const isExamplePage = r.page.isExample
                      const canReprocess = !running && (r.status === 'done' || r.status === 'error')
                      const tokensPerSec = r.tokens && r.elapsedMs && r.elapsedMs > 0
                        ? Math.round(r.tokens / (r.elapsedMs / 1000))
                        : null
                      const rowBg =
                        r.status === 'running' ? '#fbf5e7'
                        : r.status === 'error' ? '#f7ece5'
                        : r.forceReprocess ? '#f0eaf8'
                        : undefined
                      const tdStyle = { padding: '6px 10px', borderBottom: '1px solid var(--line)', fontSize: 12.5, verticalAlign: 'middle' as const }
                      const dimmed = r.status === 'skipped' || isExcluded

                      return (
                        <tr key={r.page.n} style={{ background: rowBg, opacity: dimmed ? 0.45 : 1 }}>
                          <td style={tdStyle}>
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              disabled={running || r.status === 'skipped'}
                              onChange={() => toggleExcluded(r.page.n)}
                              className="cursor-pointer"
                              style={{ width: 14, height: 14 }}
                            />
                          </td>
                          <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, ui-monospace)', fontVariantNumeric: 'tabular-nums', color: r.status === 'running' ? 'var(--ink)' : 'var(--mute)', fontWeight: r.status === 'running' ? 600 : undefined }}>
                            {isExamplePage && <span style={{ color: '#c89328', marginRight: 3 }}>★</span>}
                            p. {r.page.n}
                          </td>
                          <td style={tdStyle}>
                            <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              {r.status === 'done' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a8c3f" strokeWidth="2.5"><path d="m5 12 5 5 9-12" /></svg>}
                              {r.status === 'error' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b04a3a" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>}
                              {r.status === 'running' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c89328" strokeWidth="2.2" className="animate-spin" style={{ animationDuration: '1.6s' }}><path d="M21 12a9 9 0 1 1-6.3-8.6" /></svg>}
                              {r.status === 'skipped' && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></svg>}
                              {r.status === 'pending' && <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1px solid var(--mute-2)' }} />}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, fontStyle: 'italic', textDecoration: dimmed ? 'line-through' : undefined, color: (r.status === 'skipped' || dimmed) ? 'var(--mute)' : undefined }}>
                            {basename(r.page.imagePath)}
                            {r.status === 'error' && r.errorMessage && (
                              <span style={{ fontStyle: 'normal', fontSize: 11, color: 'var(--mute)', marginLeft: 8 }}>— {r.errorMessage}</span>
                            )}
                            {r.status === 'running' && (
                              <span style={{ fontStyle: 'normal', fontSize: 11, color: 'var(--mute)', marginLeft: 8 }}>— {t('ocr.running')}</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <span className={`badge ${r.status === 'done' ? 'badge-ocr' : r.status === 'error' ? 'badge-error' : r.status === 'skipped' ? 'badge-skipped' : r.status === 'running' ? 'badge-pending' : 'badge-pending'}`}>
                              {r.status === 'done' && <span className="dot dot-ok" />}
                              {r.status === 'running' && <span className="dot dot-warn" />}
                              {r.forceReprocess ? t('ocr.queued') : r.fromCache ? t('ocr.cache') : r.status}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, ui-monospace)', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--mute)' }}>
                            {r.elapsedMs != null ? `${(r.elapsedMs / 1000).toFixed(1)} s` : '—'}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, ui-monospace)', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--mute)' }}>
                            {r.tokens != null
                              ? r.status === 'running'
                                ? <strong style={{ color: 'var(--ink)' }}>{r.tokens}</strong>
                                : r.tokens
                              : '—'}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, ui-monospace)', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--mute)' }}>
                            {tokensPerSec != null ? `${tokensPerSec}/s` : '—'}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {canReprocess && (
                              <button
                                className="btn btn-quiet"
                                style={{ padding: '2px 6px', fontSize: 11, color: r.forceReprocess ? 'var(--oxblood)' : 'var(--mute)' }}
                                title={t('ocr.forceReprocess')}
                                onClick={() => toggleForceReprocess(r.page.n)}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v6h6" /></svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ padding: '20px', textAlign: 'center', color: 'var(--mute)', fontSize: 12.5 }}>
                          {t('ocr.noMatchingPages')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Progress footer */}
              <div className="px-3 py-2.5 border-t flex items-center gap-4" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
                <div className="flex-1">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[11.5px] font-medium">
                      {t('ocr.overall')} <span className="font-mono" style={{ color: 'var(--mute)' }}>{doneCount} / {totalActive} {t('common.pages')}</span>
                    </span>
                    <div className="flex items-baseline gap-3">
                      {avgMs != null && (
                        <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--mute)' }}>
                          {t('ocr.avgPerPage', { avg: (avgMs / 1000).toFixed(0) })}
                        </span>
                      )}
                      {etaMs != null && running && (
                        <span className="font-mono text-[11.5px] tabular-nums font-semibold" style={{ color: 'var(--oxblood)' }}>
                          {t('ocr.eta', { eta: fmtEta(etaMs) })}
                        </span>
                      )}
                      <span className="font-mono text-[11.5px] tabular-nums font-semibold" style={{ color: 'var(--oxblood)' }}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                  <div className="progress">
                    <div className="progress-bar" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Live log (collapsible) ── */}
          <details className="panel" open>
            <summary className="px-3 py-2 flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden" style={{ borderRadius: 8 }}>
              <div className="flex items-center gap-2 text-[12.5px]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--mute)' }}><path d="m9 6 6 6-6 6" /></svg>
                <h3 className="font-serif text-[15px]">{t('ocr.liveLog')}</h3>
                <span className="font-mono text-[11px]" style={{ color: 'var(--mute)' }}>{t('ocr.logLines', { count: log.length })}</span>
              </div>
              <button
                className="text-[11.5px] font-mono"
                style={{ color: 'var(--oxblood)' }}
                onClick={(e) => { e.preventDefault(); setLog([]) }}
              >
                {t('ocr.clearLog')}
              </button>
            </summary>
            <div className="px-3 pb-3">
              <div ref={logRef} className="terminal overflow-y-auto" style={{ height: 150 }}>
                {log.map((line, i) => {
                  const isErr = line.includes('ERROR') || line.includes('error')
                  const isOk = line.includes('done') || line.includes('Connected')
                  const isWarn = line.includes('warn') || line.includes('[model]')
                  return (
                    <div key={i} className={isErr ? 't-err' : isOk ? 't-ok' : isWarn ? 't-warn' : ''}>
                      {line}
                    </div>
                  )
                })}
                {log.length === 0 && <div className="t-mute">{t('ocr.waitingForRun')}</div>}
              </div>
            </div>
          </details>

          {/* Next step */}
          <div className="flex justify-end pt-1">
            <button className="btn btn-primary" onClick={() => navigate('/config')}>
              {t('ocr.nextStructure')}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>

        </div>
      </main>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        details[open] > summary > div > svg:first-child { transform: rotate(90deg); }
        table tbody tr:hover { background: rgba(0,0,0,.02); }
      `}</style>
    </div>
  )
}
