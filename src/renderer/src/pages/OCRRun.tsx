import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LMConfig, OCRProgressEvent, Page } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'
import { renderMaskedPage } from '../utils/renderMaskedPage'

function LearnFromExamplesToggle({
  enabled,
  count,
  onChange,
}: {
  enabled: boolean
  count: number
  onChange: (v: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px 4px 6px',
        borderRadius: 999,
        border: '1px solid',
        background: enabled ? '#fbf2dc' : 'var(--paper-3)',
        borderColor: enabled ? '#d9c688' : 'var(--line-2)',
        color: enabled ? '#8a6a18' : 'var(--mute)',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      <span style={{
        width: 28, height: 16, borderRadius: 999,
        background: enabled ? '#c89328' : 'var(--line-2)',
        display: 'inline-flex', alignItems: 'center',
        padding: 2,
        flexShrink: 0,
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', background: '#fff',
          transform: enabled ? 'translateX(12px)' : 'translateX(0)',
          transition: 'transform .15s',
          display: 'block',
          boxShadow: '0 1px 2px rgba(0,0,0,.2)'
        }} />
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="m12 2 2.6 6.5 7 .6-5.3 4.6 1.7 6.8L12 17l-6 3.5 1.7-6.8L2.4 9.1l7-.6z" />
      </svg>
      {t('ocr.learnFromExamples')}
      <span style={{
        background: enabled ? '#c89328' : 'var(--mute-2)',
        color: '#fff',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        padding: '0 5px',
        lineHeight: '16px',
        minWidth: 18,
        textAlign: 'center',
        display: 'inline-block',
      }}>{count}</span>
    </button>
  )
}


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

  const [lmConfig, setLMConfig] = useState<LMConfig>(
    project?.lmConfig ?? {
      endpoint: 'http://localhost:1234',
      model: '',
      contextLength: 4096,
      temperature: 0
    }
  )
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [connectionLatency, setConnectionLatency] = useState<number | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
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

  const fetchModels = useCallback(async () => {
    try {
      const result = await window.api.testLMStudio(lmConfig.endpoint, lmConfig.apiKey)
      if (result.models) setAvailableModels(result.models)
    } catch { /* silent */ }
  }, [lmConfig.endpoint, lmConfig.apiKey])

  useEffect(() => { fetchModels() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const testConnection = useCallback(async () => {
    setConnectionStatus('idle')
    const result = await window.api.testLMStudio(lmConfig.endpoint, lmConfig.apiKey)
    setConnectionLatency(result.latencyMs)
    setConnectionStatus(result.ok ? 'ok' : 'error')
    if (result.models) setAvailableModels(result.models)
    addLog(
      result.ok
        ? `[info] Connected · latency=${result.latencyMs}ms · models=${result.models?.join(', ')}`
        : `[error] Connection failed · ${result.error}`
    )
  }, [lmConfig.endpoint, lmConfig.apiKey])

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
    const cfg = { ...lmConfig }

    const forcedNs = new Set(rows.filter((r) => r.forceReprocess).map((r) => r.page.n))
    const pagesWithReset = project.pages.map((p) =>
      forcedNs.has(p.n) ? { ...p, status: 'pending' as const } : p
    )
    const projectToSave = { ...project, pages: pagesWithReset, lmConfig: cfg }
    await saveProject(projectToSave)

    let pagesForOCR = pagesWithReset.filter((p) => !excluded.has(p.n))
    addLog(`[info] Starting OCR · ${pagesForOCR.filter((p) => p.status !== 'skipped').length} pages`)
    if (forcedNs.size > 0) addLog(`[info] Force-reprocessing ${forcedNs.size} page(s): ${[...forcedNs].join(', ')}`)

    const excludedExamplesWithMasks = pagesWithReset.filter(
      (p) => p.isExample && p.status === 'ocr_done' && p.masks.length > 0 && excluded.has(p.n)
    )
    const toMask = [...pagesForOCR.filter((p) => p.masks.length > 0), ...excludedExamplesWithMasks]
    const maskedPaths = new Map<number, string>()
    if (toMask.length > 0) {
      addLog(`[info] Applying masks to ${toMask.length} pages…`)
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

    const allPagesWithMasks = pagesWithReset.map((p) =>
      maskedPaths.has(p.n) ? { ...p, maskedImagePath: maskedPaths.get(p.n) } : p
    )
    await window.api.runOCR(project.projectDir, pagesForOCR, cfg, allPagesWithMasks)

    const reloaded = await window.api.reloadProject(project.projectDir)
    await saveProject(reloaded)

    setRunning(false)
    addLog('[info] OCR run complete')
  }, [project, lmConfig, rows, excluded, saveProject])

  const stopOCR = useCallback(async () => {
    await window.api.stopOCR()
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

  const examplePageNs = project?.pages.filter((p) => p.isExample && p.status === 'ocr_done') ?? []

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

  const advSummary = `temp ${lmConfig.temperature} · ctx ${lmConfig.contextLength}${lmConfig.apiKey ? ' · key set' : ' · no key'}`

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
              {!running && examplePageNs.length > 1 && (
                <LearnFromExamplesToggle
                  enabled={lmConfig.inMemoryLearning !== false}
                  count={examplePageNs.length}
                  onChange={(v) => setLMConfig((c) => ({ ...c, inMemoryLearning: v }))}
                />
              )}
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

          {/* ── LM Studio ── */}
          <section>
            <div className="panel">
              {/* Single inline row */}
              <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
                <h3 className="font-serif text-[15px] leading-none shrink-0 py-1 pr-3 mr-1 border-r" style={{ borderColor: 'var(--line)' }}>{t('ocr.lmStudio')}</h3>

                <div className="flex items-center gap-2">
                  <div className="label" style={{ letterSpacing: '.1em' }}>{t('ocr.endpoint')}</div>
                  <input
                    className="input font-mono text-[12px]"
                    style={{ paddingTop: 4, paddingBottom: 4, width: 210 }}
                    data-tour="ocr-endpoint"
                    value={lmConfig.endpoint}
                    onChange={(e) => setLMConfig((c) => ({ ...c, endpoint: e.target.value }))}
                    placeholder="http://localhost:1234"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <div className="label" style={{ letterSpacing: '.1em' }}>{t('ocr.model')}</div>
                  <div className="relative">
                    <input
                      className="input font-mono text-[12px]"
                      style={{ paddingTop: 4, paddingBottom: 4, width: 170, paddingRight: 28 }}
                      list="model-list"
                      value={lmConfig.model}
                      onChange={(e) => setLMConfig((c) => ({ ...c, model: e.target.value }))}
                      placeholder={availableModels.length ? 'click ▾ or type' : 'qwen2.5-vl-7b-instruct'}
                    />
                    <svg className="absolute right-2 top-1/2 -translate-y-1/2" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--mute)', pointerEvents: 'none' }}><path d="m6 9 6 6 6-6" /></svg>
                    <datalist id="model-list">
                      {availableModels.map((m) => <option key={m} value={m} />)}
                    </datalist>
                  </div>
                  <button className="btn btn-quiet" style={{ padding: 5 }} onClick={fetchModels} title={t('ocr.refreshModels')}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v6h6" /></svg>
                  </button>
                </div>

                <button className="btn btn-ghost" style={{ paddingTop: 4, paddingBottom: 4 }} onClick={testConnection}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  {t('ocr.test')}
                </button>

                {connectionStatus !== 'idle' && (
                  <span className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono border ${connectionStatus === 'ok' ? 'bg-[color:var(--moss-bg)] border-[#b8c8a0] text-[#3b5a30]' : 'bg-[#f1d6cf] border-[#d9a0a0] text-[#7a2a23]'}`}>
                    <span className={`dot ${connectionStatus === 'ok' ? 'dot-ok' : 'dot-err'}`} />
                    {connectionStatus === 'ok' ? t('ocr.connected', { latency: connectionLatency }) : t('ocr.connectionError')}
                  </span>
                )}
              </div>

              {/* Advanced disclosure */}
              <details className="border-t" style={{ borderColor: 'var(--line)' }}>
                <summary className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-[color:var(--paper-3)] transition-colors list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2 text-[12px]">
                    <svg className="details-chev transition-transform" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--mute)' }}><path d="m9 6 6 6-6 6" /></svg>
                    <span className="font-medium">{t('ocr.advancedParams')}</span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--mute)' }}>{advSummary}</span>
                  </div>
                  <span className="text-[10px] tracking-[.1em] uppercase" style={{ color: 'var(--mute-2)' }}>{t('ocr.advancedDefaults')}</span>
                </summary>
                <div className="px-3 pb-3 pt-2 grid gap-3 border-t border-dashed" style={{ borderColor: 'var(--line)', gridTemplateColumns: '120px 160px 1fr' }}>
                  <div>
                    <div className="label mb-1">{t('ocr.temperature')}</div>
                    <input
                      className="input font-mono text-[12px]"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={lmConfig.temperature}
                      onChange={(e) => setLMConfig((c) => ({ ...c, temperature: parseFloat(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <div className="label mb-1">{t('ocr.contextLength')}</div>
                    <input
                      className="input font-mono text-[12px]"
                      type="number"
                      value={lmConfig.contextLength}
                      onChange={(e) => setLMConfig((c) => ({ ...c, contextLength: parseInt(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <div className="label mb-1">{t('ocr.apiKey')}</div>
                    <input
                      className="input font-mono text-[12px]"
                      type="password"
                      value={lmConfig.apiKey ?? ''}
                      placeholder={t('ocr.apiKeyPlaceholder')}
                      onChange={(e) => setLMConfig((c) => ({ ...c, apiKey: e.target.value || undefined }))}
                    />
                  </div>
                </div>
              </details>
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
