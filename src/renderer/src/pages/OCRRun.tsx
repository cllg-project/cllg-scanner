import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LMConfig, OCRProgressEvent, Page } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'

async function renderMaskedPage(projectDir: string, page: Page): Promise<string> {
  const imgPath = page.imagePath.startsWith('/') ? page.imagePath : `${projectDir}/${page.imagePath}`
  const dataUrl = await window.api.loadImageAsDataUrl(imgPath)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const el = new window.Image()
    el.onload = () => res(el)
    el.onerror = rej
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  for (const mask of page.masks) {
    ctx.fillStyle = mask.fill
    ctx.fillRect(mask.x, mask.y, mask.width, mask.height)
  }
  const blob: Blob = await new Promise((res) => canvas.toBlob(res as BlobCallback, 'image/png'))
  const buf = await blob.arrayBuffer()
  return window.api.saveMaskedImage(projectDir, page.n, buf)
}

interface PageRow {
  page: Page
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  tokens?: number
  elapsedMs?: number
  errorMessage?: string
  fromCache?: boolean
}

export default function OCRRun(): React.JSX.Element {
  const { project, saveProject } = useProject()
  const navigate = useNavigate()

  const [lmConfig, setLMConfig] = useState<LMConfig>(
    project?.lmConfig ?? {
      endpoint: 'http://localhost:1234',
      model: '',
      contextLength: 2048,
      temperature: 0
    }
  )
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [connectionLatency, setConnectionLatency] = useState<number | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<PageRow[]>([])
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [log, setLog] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!project) return
    setRows(
      project.pages.map((p) => ({
        page: p,
        status: p.status === 'skipped' ? 'skipped' : p.status === 'ocr_done' ? 'done' : 'pending'
      }))
    )
  }, [project])

  // Subscribe to OCR progress events
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
      if (e.status === 'done') {
        addLog(`[${ts}] page[${e.pageNum}] done · tokens=${e.tokens} elapsed=${((e.elapsedMs ?? 0) / 1000).toFixed(1)}s`)
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

  // Auto-populate model list on mount
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

  const startOCR = useCallback(async () => {
    if (!project) return
    setRunning(true)
    const cfg = { ...lmConfig }
    await saveProject({ ...project, lmConfig: cfg })

    let pagesForOCR = project.pages.filter((p) => !excluded.has(p.n))
    addLog(`[info] Starting OCR · ${pagesForOCR.filter((p) => p.status !== 'skipped').length} pages`)

    // Apply masks on the fly for any page that has mask rectangles defined
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

    await window.api.runOCR(project.projectDir, pagesForOCR, cfg)

    // Reload from disk so page statuses written by main process are reflected in context
    const reloaded = await window.api.reloadProject(project.projectDir)
    await saveProject(reloaded)

    setRunning(false)
    addLog('[info] OCR run complete')
  }, [project, lmConfig, excluded, saveProject])

  const stopOCR = useCallback(async () => {
    await window.api.stopOCR()
    setRunning(false)
    addLog('[info] OCR stopped by user')
  }, [])

  const doneCount = rows.filter((r) => r.status === 'done').length
  const totalActive = rows.filter((r) => r.status !== 'skipped').length
  const pct = totalActive > 0 ? Math.round((doneCount / totalActive) * 100) : 0

  // ETA: average real-API elapsed only (exclude cache hits)
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

  if (!project) return <div className="p-8">No project open.</div>

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--paper-2)' }}>
        {/* Header */}
        <div className="px-10 pt-8 pb-5 border-b flex items-end justify-between" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="font-mono text-[10px] tracking-[.18em] uppercase" style={{ color: 'var(--mute)' }}>
              Step 03 of 05
            </div>
            <h2 className="font-serif text-[28px] leading-tight mt-1">OCR run</h2>
            <div className="text-[12.5px] mt-1" style={{ color: 'var(--mute)' }}>
              Pages are sent one at a time to LM Studio. Output is appended to{' '}
              <span className="font-mono" style={{ color: 'var(--ink)' }}>ocr_output.md</span>.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <button className="btn btn-ghost" onClick={stopOCR}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
                Pause OCR
              </button>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={startOCR} disabled={running || doneCount === 0}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v6h6" />
                  </svg>
                  Resume
                </button>
                <button className="btn btn-primary" onClick={startOCR} disabled={running}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Run OCR
                </button>
              </>
            )}
          </div>
        </div>

        {/* LM Studio config */}
        <div className="px-10 pt-8 pb-6">
          <h3 className="font-serif text-[18px] mb-3">LM Studio</h3>
          <div className="panel p-5 grid grid-cols-12 gap-5">
            {/* Endpoint */}
            <div className="col-span-5">
              <div className="label mb-1.5">Endpoint URL</div>
              <input
                className="input font-mono text-[12px]"
                value={lmConfig.endpoint}
                onChange={(e) => setLMConfig((c) => ({ ...c, endpoint: e.target.value }))}
                placeholder="http://localhost:1234"
              />
            </div>
            {/* Model */}
            <div className="col-span-4">
              <div className="label mb-1.5 flex items-center gap-2">
                Model
                <button
                  className="text-[10.5px] font-mono px-1.5 py-0.5 rounded border hover:opacity-80"
                  style={{ color: 'var(--mute)', borderColor: 'var(--line-2)' }}
                  onClick={fetchModels}
                  title="Refresh model list from LM Studio"
                >↻ refresh</button>
              </div>
              <input
                className="input font-mono text-[12px]"
                list="model-list"
                value={lmConfig.model}
                onChange={(e) => setLMConfig((c) => ({ ...c, model: e.target.value }))}
                placeholder={availableModels.length ? 'click ▾ or type' : 'qwen2.5-vl-7b-instruct'}
              />
              <datalist id="model-list">
                {availableModels.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            {/* Test */}
            <div className="col-span-3">
              <div className="label mb-1.5">Connection</div>
              <div className="flex items-stretch gap-2">
                <button className="btn btn-ghost !py-2 flex-1 justify-center" onClick={testConnection}>
                  Test
                </button>
                {connectionStatus !== 'idle' && (
                  <div
                    className={`flex items-center gap-1.5 px-3 rounded-md border text-[11.5px] font-mono ${connectionStatus === 'ok' ? 'bg-[#e7efdf] border-[#b8c8a0] text-[#3b5a30]' : 'bg-[#f1d6cf] border-[#d9a0a0] text-[#7a2a23]'}`}
                  >
                    <span className={`dot ${connectionStatus === 'ok' ? 'dot-ok' : 'dot-err'}`} />
                    {connectionStatus === 'ok' ? `${connectionLatency}ms` : 'error'}
                  </div>
                )}
              </div>
            </div>
            {/* Second row */}
            <div className="col-span-12 grid grid-cols-12 gap-5 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
              <div className="col-span-2">
                <div className="label mb-1.5">Temperature</div>
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
              <div className="col-span-2">
                <div className="label mb-1.5">Context length</div>
                <input
                  className="input font-mono text-[12px]"
                  type="number"
                  value={lmConfig.contextLength}
                  onChange={(e) => setLMConfig((c) => ({ ...c, contextLength: parseInt(e.target.value) }))}
                />
              </div>
              <div className="col-span-2">
                <div className="label mb-1.5">API key</div>
                <input
                  className="input font-mono text-[12px]"
                  type="password"
                  value={lmConfig.apiKey ?? ''}
                  placeholder="optional"
                  onChange={(e) => setLMConfig((c) => ({ ...c, apiKey: e.target.value || undefined }))}
                />
              </div>
              <div className="col-span-3 flex items-end gap-2">
                <button
                  className="btn btn-quiet !py-1.5 text-[11.5px]"
                  onClick={() => setExcluded(new Set())}
                >Select all</button>
                <button
                  className="btn btn-quiet !py-1.5 text-[11.5px]"
                  onClick={() => setExcluded(new Set(project.pages.map((p) => p.n)))}
                >Deselect all</button>
              </div>
            </div>
          </div>
        </div>

        {/* Queue */}
        <div className="px-10 pb-6">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-serif text-[18px]">Page queue</h3>
            <div className="flex items-center gap-4 text-[11.5px] font-mono" style={{ color: 'var(--mute)' }}>
              <span><span className="dot dot-ok mr-1" />done <span className="font-semibold" style={{ color: 'var(--ink)' }}>{doneCount}</span></span>
              <span><span className="dot dot-warn mr-1" />running <span className="font-semibold" style={{ color: 'var(--ink)' }}>{rows.filter((r) => r.status === 'running').length}</span></span>
              <span><span className="dot dot-err mr-1" />error <span className="font-semibold" style={{ color: 'var(--ink)' }}>{rows.filter((r) => r.status === 'error').length}</span></span>
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div
              className="grid gap-3 px-4 py-2.5 border-b text-[10.5px] uppercase tracking-wider font-semibold"
              style={{ gridTemplateColumns: '32px 80px 40px 1fr 120px 90px 80px', background: 'var(--paper-3)', borderColor: 'var(--line)', color: 'var(--mute)' }}
            >
              <div />
              <div>Page</div><div />
              <div>Status</div>
              <div>Badge</div>
              <div>Elapsed</div>
              <div className="text-right">Tokens</div>
            </div>

            <div className="divide-y max-h-72 overflow-y-auto" style={{ borderColor: 'var(--line)' }}>
              {rows.map((r) => {
                const isExcluded = excluded.has(r.page.n)
                return (
                  <div
                    key={r.page.n}
                    className="grid gap-3 px-4 py-2.5 items-center text-[12.5px]"
                    style={{
                      gridTemplateColumns: '32px 80px 40px 1fr 120px 90px 80px',
                      background: r.status === 'running' ? '#fbf5e7' : r.status === 'error' ? '#f7ece5' : undefined,
                      opacity: r.status === 'skipped' || isExcluded ? 0.4 : 1
                    }}
                  >
                    <div>
                      <input
                        type="checkbox"
                        checked={!isExcluded}
                        disabled={running || r.status === 'skipped'}
                        onChange={() => toggleExcluded(r.page.n)}
                        className="cursor-pointer"
                      />
                    </div>
                    <div className="font-mono tabular-nums" style={{ color: r.status === 'running' ? 'var(--ink)' : 'var(--mute)' }}>
                      p. {r.page.n}
                    </div>
                    <div>
                      {r.status === 'done' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5a8c3f" strokeWidth="2.5"><path d="m5 12 5 5 9-12" /></svg>}
                      {r.status === 'error' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b04a3a" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>}
                      {r.status === 'running' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c89328" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.3-8.6" /></svg>}
                      {r.status === 'skipped' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></svg>}
                      {r.status === 'pending' && <div className="w-3 h-3 rounded-full border" style={{ borderColor: 'var(--mute-2)' }} />}
                    </div>
                    <div className="font-serif italic" style={{ color: r.status === 'skipped' ? 'var(--mute)' : undefined, textDecoration: r.status === 'skipped' || isExcluded ? 'line-through' : undefined }}>
                      {r.errorMessage ?? `page ${r.page.n}`}
                    </div>
                    <div>
                      <span className={`badge ${r.status === 'done' ? 'badge-ocr' : r.status === 'error' ? 'badge-error' : r.status === 'skipped' ? 'badge-skipped' : r.status === 'running' ? 'badge-pending' : 'badge-pending'}`}>
                        {r.status === 'done' && <span className="dot dot-ok" />}
                        {r.status}
                      </span>
                    </div>
                    <div className="font-mono tabular-nums text-[11px]" style={{ color: 'var(--mute)' }}>
                      {r.fromCache
                        ? <span className="badge badge-skipped">cache</span>
                        : r.elapsedMs != null ? `${(r.elapsedMs / 1000).toFixed(1)} s` : '—'}
                    </div>
                    <div className="font-mono tabular-nums text-right text-[11px]" style={{ color: 'var(--mute)' }}>
                      {r.tokens ?? '—'}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer progress */}
            <div className="px-4 py-3 border-t flex items-center gap-4" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
              <div className="flex-1">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[11.5px] font-medium">
                    Overall{' '}
                    <span className="font-mono" style={{ color: 'var(--mute)' }}>
                      {doneCount} / {totalActive} pages
                    </span>
                  </span>
                  <div className="flex items-baseline gap-4">
                    {avgMs != null && (
                      <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--mute)' }}>
                        avg {(avgMs / 1000).toFixed(0)} s/page
                      </span>
                    )}
                    {etaMs != null && running && (
                      <span className="font-mono text-[11.5px] tabular-nums font-semibold" style={{ color: 'var(--oxblood)' }}>
                        {fmtEta(etaMs)} remaining
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
        </div>

        {/* Live log */}
        <div className="px-10 pb-10">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-serif text-[18px]">Live log</h3>
            <button
              className="text-[11.5px] font-mono"
              style={{ color: 'var(--oxblood)' }}
              onClick={() => setLog([])}
            >
              clear
            </button>
          </div>
          <div ref={logRef} className="terminal h-[200px] overflow-y-auto">
            {log.map((line, i) => {
              const isErr = line.includes('ERROR') || line.includes('error')
              const isOk = line.includes('done') || line.includes('Connected')
              const isWarn = line.includes('warn')
              return (
                <div key={i} className={isErr ? 't-err' : isOk ? 't-ok' : isWarn ? 't-warn' : ''}>
                  {line}
                </div>
              )
            })}
            {log.length === 0 && <div className="t-mute">Waiting for run…</div>}
          </div>
        </div>

        {/* Next step */}
        <div className="px-10 pb-10 flex justify-end">
          <button className="btn btn-primary" onClick={() => navigate('/review')}>
            Next: Review
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
      </main>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
