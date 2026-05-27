import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'
import { hierarchyToYAML } from './Config'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'md' | 'tei'

// ── Sub-components ────────────────────────────────────────────────────────────

function XmlHighlight({ xml }: { xml: string }): React.JSX.Element {
  const nodes: React.ReactNode[] = []
  let key = 0
  const tagRe = /(<[^>]+>)|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml)) !== null) {
    const [, tag, text] = m
    if (tag) {
      const valueRe = /("[^"]*"|'[^']*')/g
      let last = 0; let vm: RegExpExecArray | null
      while ((vm = valueRe.exec(tag)) !== null) {
        if (vm.index > last) nodes.push(<span key={key++} style={{ color: '#569cd6' }}>{tag.slice(last, vm.index)}</span>)
        nodes.push(<span key={key++} style={{ color: '#ce9178' }}>{vm[0]}</span>)
        last = vm.index + vm[0].length
      }
      if (last < tag.length) nodes.push(<span key={key++} style={{ color: '#569cd6' }}>{tag.slice(last)}</span>)
    } else if (text) {
      nodes.push(<span key={key++}>{text}</span>)
    }
  }
  return <>{nodes}</>
}

// ── Main component ────────────────────────────────────────────────────────────

const CURRENT_STEP = 6

export default function Export(): React.JSX.Element {
  const { t } = useTranslation()
  const STEP_LABELS = [t('steps.import'), t('steps.mask'), t('steps.ocr'), t('steps.config'), t('steps.review'), t('steps.tei')]
  const { project } = useProject()
  const [log, setLog] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastOutputPath, setLastOutputPath] = useState<string | null>(null)
  const [ocrPreview, setOcrPreview] = useState<string>('')
  const [teiXml, setTeiXml] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('md')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!project) return
    window.api.loadOCROutput(project.projectDir).then(setOcrPreview)
  }, [project?.projectDir])

  useEffect(() => {
    const unsub = window.api.onTEILog((line) => {
      setLog((l) => [...l, line])
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
    return unsub
  }, [])

  const generate = useCallback(async () => {
    if (!project) return
    setGenerating(true)
    setLog([])
    setTeiXml(null)

    const compiledYAML = hierarchyToYAML(project.hierarchy, project.metadata)
    const markdownPath = `${project.projectDir}/ocr_output.md`
    const yamlPath = `${project.projectDir}/structure.yaml`
    try {
      const xml = await window.api.generateTEI({
        projectDir: project.projectDir,
        markdownPath,
        yamlConfigPath: yamlPath,
        yamlContent: compiledYAML,
        bibliography: project.bibliography ?? [],
      })
      setTeiXml(xml)
      setActiveTab('tei')
    } catch (err) {
      setLog((l) => [...l, `[error] ${err}`])
    } finally {
      setGenerating(false)
    }
  }, [project])

  const saveXml = useCallback(async () => {
    if (!project || !teiXml) return
    setSaving(true)
    try {
      const outputPath = await window.api.selectSaveFile(`${project.name}.xml`, 'xml')
      if (!outputPath) return
      await window.api.saveTEI({ xml: teiXml, outputPath })
      setLastOutputPath(outputPath)
    } catch (err) {
      setLog((l) => [...l, `[error] ${err}`])
    } finally {
      setSaving(false)
    }
  }, [project, teiXml])

  if (!project) return <div className="p-8">{t('common.noProjectOpen')}</div>

  const hasHierarchy = project.hierarchy.length > 0

  const tabBtn = (tab: Tab, label: string, enabled = true): React.JSX.Element => (
    <button
      onClick={() => enabled && setActiveTab(tab)}
      className="px-3 py-2 text-[12.5px] font-medium border-b-2"
      style={{
        borderColor: activeTab === tab ? 'var(--oxblood)' : 'transparent',
        color: activeTab === tab ? 'var(--ink)' : 'var(--mute)',
        background: 'none',
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.4,
      }}
    >{label}</button>
  )

  const bibliography = project.bibliography ?? []

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--paper-2)' }}>
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b shrink-0" style={{ borderColor: 'var(--line)' }}>
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
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <h2 className="font-serif text-[26px] leading-none">{t('export.title')}</h2>
              <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--mute)' }}>
                {t('export.subtitle')}
              </div>
            </div>
            <div className="text-[11.5px] font-mono text-right shrink-0" style={{ color: 'var(--mute)' }}>
              {t('export.schema')} · <span style={{ color: 'var(--ink)' }}>tei_all.rng</span><br />
              {t('export.encoding')} · <span style={{ color: 'var(--ink)' }}>UTF-8 (NFC)</span>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-10 pt-5 pb-0 border-b flex items-end gap-1 shrink-0" style={{ borderColor: 'var(--line)' }}>
          {tabBtn('md', 'ocr_output.md')}
          {tabBtn('tei', 'output.xml', !!teiXml)}
          <div className="ml-auto pb-1 text-[11.5px] font-mono" style={{ color: 'var(--mute)' }}>
            {activeTab === 'md' && t('export.pagesDone', { count: (ocrPreview.match(/<pb n="/g) ?? []).length })}
            {activeTab === 'tei' && teiXml && t('export.lines', { count: teiXml.split('\n').length })}
          </div>
          {bibliography.length > 0 && (
            <div className="pb-1 ml-2 text-[11px] font-mono" style={{ color: 'var(--mute)' }}>
              {bibliography.length === 1 ? t('export.bibEntry', { count: 1 }) : t('export.bibEntries', { count: bibliography.length })}
            </div>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-10 py-6">
            {activeTab === 'md' && (
              <div className="code text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: ocrPreview ? 'var(--ink)' : 'var(--mute)' }}>
                {ocrPreview || t('export.ocrOutputPlaceholder')}
              </div>
            )}
            {activeTab === 'tei' && (
              <pre className="code text-[12px] leading-relaxed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {teiXml ? <XmlHighlight xml={teiXml} /> : null}
              </pre>
            )}
          </div>

          {log.length > 0 && (
            <div className="px-10 py-4 border-t shrink-0" style={{ borderColor: 'var(--line)' }}>
              <div className="label mb-2">{t('export.generationLog')}</div>
              <div ref={logRef} className="terminal h-36 overflow-y-auto">
                {log.map((line, i) => (
                  <div key={i} className={line.includes('error') ? 't-err' : line.includes('done') || line.includes('✓') ? 't-ok' : ''}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="border-t px-6 h-14 flex items-center gap-4 shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
          <button className="btn btn-primary" onClick={generate} disabled={generating || !hasHierarchy}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
            </svg>
            {generating ? t('export.generating') : t('export.generate')}
          </button>

          <button className="btn btn-ghost" onClick={saveXml} disabled={saving || !teiXml}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
            </svg>
            {saving ? t('export.saving') : t('export.saveAs')}
          </button>

          {lastOutputPath && (
            <button className="btn btn-ghost" onClick={() => window.api.openInFinder(lastOutputPath!)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
              </svg>
              {t('export.showInFolder')}
            </button>
          )}

          {!hasHierarchy && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border" style={{ background: '#fbf2dc', borderColor: '#d9c688' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a6a18" strokeWidth="2">
                <path d="M12 2 2 21h20z" /><path d="M12 9v5M12 17h.01" />
              </svg>
              <span className="text-[11.5px]" style={{ color: '#8a6a18' }}>
                {t('export.noHierarchy')}
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
