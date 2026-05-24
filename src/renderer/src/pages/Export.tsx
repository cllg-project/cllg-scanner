import React, { useState, useEffect, useRef, useCallback } from 'react'
import { stringify } from 'yaml'
import type { HierarchyLevel, ProjectMetadata } from '@shared/types'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'

const FORMAT_OPTIONS = ['Roman', 'Arabic', 'Alpha', 'Greek', 'Stephanus']

function LevelCard({
  level,
  depth,
  onChange,
  onDelete,
  onAddChild
}: {
  level: HierarchyLevel
  depth: number
  onChange: (updated: HierarchyLevel) => void
  onDelete: () => void
  onAddChild: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)

  return (
    <div className={`panel mb-2.5 ${depth > 0 ? 'ml-5 relative' : ''}`}>
      {depth > 0 && (
        <div className="absolute -left-3 top-0 bottom-0 w-px" style={{ background: 'var(--line-2)' }} />
      )}
      <div
        className="px-3 py-2.5 flex items-center gap-2 border-b cursor-pointer"
        style={{ background: 'var(--paper-3)', borderColor: 'var(--line)' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-mono text-[10.5px] font-semibold" style={{ color: 'var(--oxblood)' }}>
          L{depth + 1}
        </span>
        <span className="font-serif text-[14px]">{level.name || 'Unnamed'}</span>
        <span className="ml-auto text-[11px] font-mono" style={{ color: 'var(--mute)' }}>
          {level.pattern}
        </span>
        <button
          className="tool-btn !w-6 !h-6"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete level"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
        <button className="tool-btn !w-6 !h-6" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={open ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
          </svg>
        </button>
      </div>

      {open && (
        <div className="px-3 py-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--mute)' }}>Name</div>
            <input
              className="input text-[12.5px]"
              value={level.name}
              onChange={(e) => onChange({ ...level, name: e.target.value })}
              placeholder="chapter"
            />
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--mute)' }}>
              Format / pattern
            </div>
            <div className="flex gap-1.5">
              <select
                className="input font-mono text-[12px] !w-auto"
                value={FORMAT_OPTIONS.includes(level.pattern) ? level.pattern : 'custom'}
                onChange={(e) =>
                  onChange({ ...level, pattern: e.target.value === 'custom' ? '' : e.target.value })
                }
              >
                {FORMAT_OPTIONS.map((f) => <option key={f}>{f}</option>)}
                <option value="custom">custom regex</option>
              </select>
              {!FORMAT_OPTIONS.includes(level.pattern) && (
                <input
                  className="input font-mono text-[12px]"
                  value={level.pattern}
                  onChange={(e) => onChange({ ...level, pattern: e.target.value })}
                  placeholder="\d+"
                />
              )}
            </div>
          </div>
          <div className="col-span-2 flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={level.missingFirst}
                onChange={(e) => onChange({ ...level, missingFirst: e.target.checked })}
                className="rounded border"
                style={{ borderColor: 'var(--line-2)', accentColor: 'var(--oxblood)' }}
              />
              missing_first
            </label>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={level.allowGaps}
                onChange={(e) => onChange({ ...level, allowGaps: e.target.checked })}
                className="rounded border"
                style={{ borderColor: 'var(--line-2)', accentColor: 'var(--oxblood)' }}
              />
              allow_gaps
            </label>
          </div>

          {/* Children */}
          {level.children.map((child, i) => (
            <div key={i} className="col-span-2">
              <LevelCard
                level={child}
                depth={depth + 1}
                onChange={(updated) => {
                  const children = [...level.children]
                  children[i] = updated
                  onChange({ ...level, children })
                }}
                onDelete={() => {
                  const children = level.children.filter((_, ci) => ci !== i)
                  onChange({ ...level, children })
                }}
                onAddChild={() => {
                  const children = [...level.children]
                  children[i] = {
                    ...children[i],
                    children: [
                      ...children[i].children,
                      { name: '', pattern: 'Arabic', format: '', missingFirst: false, allowGaps: false, children: [] }
                    ]
                  }
                  onChange({ ...level, children })
                }}
              />
            </div>
          ))}

          {depth < 3 && (
            <div className="col-span-2">
              <button
                className="btn btn-quiet !py-1 !px-2 !text-[11px] gap-1"
                onClick={onAddChild}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                Add child level
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function hierarchyToYAML(hierarchy: HierarchyLevel[], metadata: ProjectMetadata): string {
  function levelToObj(l: HierarchyLevel): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      name: l.name,
      format: l.pattern,
      missing_first: l.missingFirst
    }
    if (l.children.length > 0) obj['child'] = levelToObj(l.children[0])
    return obj
  }
  const doc: Record<string, unknown> = {
    metadata: {
      title: metadata.title,
      author: metadata.author,
      source: metadata.edition
    }
  }
  if (hierarchy.length > 0) doc['structure'] = levelToObj(hierarchy[0])
  return stringify(doc)
}

export default function Export(): React.JSX.Element {
  const { project, saveProject } = useProject()
  const [metadata, setMetadata] = useState<ProjectMetadata>(
    project?.metadata ?? { title: '', author: '', edition: '', language: '' }
  )
  const [hierarchy, setHierarchy] = useState<HierarchyLevel[]>(project?.hierarchy ?? [])
  const [log, setLog] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [lastOutputPath, setLastOutputPath] = useState<string | null>(null)
  const [ocrPreview, setOcrPreview] = useState<string>('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!project) return
    setMetadata(project.metadata)
    setHierarchy(project.hierarchy)
  }, [project])

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

  const compiledYAML = hierarchyToYAML(hierarchy, metadata)

  const addLevel = (): void => {
    setHierarchy([
      ...hierarchy,
      { name: '', pattern: 'Roman', format: '', missingFirst: false, allowGaps: false, children: [] }
    ])
  }

  const generate = useCallback(async () => {
    if (!project) return
    setGenerating(true)
    setLog([])

    // Save updated metadata + hierarchy
    const updated = { ...project, metadata, hierarchy }
    await saveProject(updated)

    const markdownPath = `${project.projectDir}/ocr_output.md`
    const outputPath = await window.api.selectSaveFile(`${project.name}.xml`, 'xml')
    if (!outputPath) { setGenerating(false); return }

    // Write YAML config to temp file
    const yamlPath = `${project.projectDir}/structure.yaml`
    // We can't write files directly from renderer, so we'll use the TEI IPC which handles it
    try {
      await window.api.generateTEI({
        projectDir: project.projectDir,
        markdownPath,
        outputPath,
        yamlConfigPath: yamlPath,
        yamlContent: compiledYAML
      })
      setLastOutputPath(outputPath)
    } catch (err) {
      setLog((l) => [...l, `[error] ${err}`])
    } finally {
      setGenerating(false)
    }
  }, [project, metadata, hierarchy, saveProject])

  if (!project) return <div className="p-8">No project open.</div>

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--paper-2)' }}>
        {/* Header */}
        <div className="px-10 pt-7 pb-4 border-b flex items-end justify-between shrink-0" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="font-mono text-[10px] tracking-[.18em] uppercase" style={{ color: 'var(--mute)' }}>
              Step 05 of 05
            </div>
            <h2 className="font-serif text-[28px] leading-tight mt-1">TEI Export</h2>
            <div className="text-[12.5px] mt-1" style={{ color: 'var(--mute)' }}>
              Define the textual hierarchy. CLLG will concatenate the OCR'd markdown and emit a single TEI P5 XML.
            </div>
          </div>
          <div className="text-[11.5px] font-mono text-right" style={{ color: 'var(--mute)' }}>
            schema · <span style={{ color: 'var(--ink)' }}>tei_all.rng</span><br />
            encoding · <span style={{ color: 'var(--ink)' }}>UTF-8 (NFC)</span>
          </div>
        </div>

        {/* Two-col body */}
        <div className="flex-1 grid overflow-hidden divide-x" style={{ gridTemplateColumns: '480px 1fr', borderColor: 'var(--line)' }}>
          {/* Left — structure editor */}
          <div className="overflow-y-auto">
            <div className="px-7 pt-6">
              <h3 className="font-serif text-[18px] mb-1">Structure</h3>
              <div className="text-[12px] mb-5" style={{ color: 'var(--mute)' }}>
                Each level becomes a TEI <span className="font-mono">&lt;div type="…"&gt;</span>.
              </div>

              {/* Metadata */}
              <div className="panel p-4 mb-5">
                <div className="label mb-2">Document metadata</div>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ['title', 'Title'],
                      ['author', 'Author'],
                      ['edition', 'Edition'],
                      ['language', 'Language (BCP-47)']
                    ] as const
                  ).map(([k, label]) => (
                    <div key={k}>
                      <div className="text-[11px] mb-1" style={{ color: 'var(--mute)' }}>{label}</div>
                      <input
                        className="input text-[12.5px]"
                        value={metadata[k as keyof ProjectMetadata]}
                        onChange={(e) =>
                          setMetadata((m) => ({ ...m, [k]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Hierarchy */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="label">Hierarchy</div>
                <button className="btn btn-quiet !py-1 !px-2 !text-[11px] gap-1" onClick={addLevel}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                  Add level
                </button>
              </div>

              {hierarchy.map((level, i) => (
                <LevelCard
                  key={i}
                  level={level}
                  depth={0}
                  onChange={(updated) => {
                    const h = [...hierarchy]
                    h[i] = updated
                    setHierarchy(h)
                  }}
                  onDelete={() => setHierarchy(hierarchy.filter((_, hi) => hi !== i))}
                  onAddChild={() => {
                    const h = [...hierarchy]
                    h[i] = {
                      ...h[i],
                      children: [
                        ...h[i].children,
                        { name: '', pattern: 'Arabic', format: '', missingFirst: false, allowGaps: false, children: [] }
                      ]
                    }
                    setHierarchy(h)
                  }}
                />
              ))}

              {/* Compiled YAML preview */}
              <div className="mt-5 mb-7">
                <div className="label mb-1.5">Compiled YAML</div>
                <pre
                  className="panel p-3 code text-[11.5px] leading-relaxed overflow-x-auto"
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {compiledYAML}
                </pre>
              </div>
            </div>
          </div>

          {/* Right — preview + log */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-6 pt-5 pb-0 border-b flex items-end gap-1 shrink-0" style={{ borderColor: 'var(--line)' }}>
              <span className="px-3 py-2 text-[12.5px] font-medium border-b-2" style={{ borderColor: 'var(--oxblood)', color: 'var(--ink)' }}>
                ocr_output.md
              </span>
              <div className="ml-auto pb-1 text-[11.5px] font-mono" style={{ color: 'var(--mute)' }}>
                {(ocrPreview.match(/<pb n="/g) ?? []).length} pages done
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="code text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: ocrPreview ? 'var(--ink)' : 'var(--mute)' }}>
                {ocrPreview || '(OCR output will appear here after running OCR)'}
              </div>
            </div>

            {/* Log */}
            {log.length > 0 && (
              <div className="px-6 py-4 border-t shrink-0" style={{ borderColor: 'var(--line)' }}>
                <div className="label mb-2">Generation log</div>
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
        </div>

        {/* Bottom bar */}
        <div className="border-t px-6 h-14 flex items-center gap-4 shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
          <button
            className="btn btn-primary"
            onClick={generate}
            disabled={generating || hierarchy.length === 0}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h12l4 4v12H4z" /><path d="M4 14h16" />
            </svg>
            {generating ? 'Generating…' : 'Generate TEI XML'}
          </button>

          {lastOutputPath && (
            <button
              className="btn btn-ghost"
              onClick={() => window.api.openInFinder(lastOutputPath!)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
              </svg>
              Show in folder
            </button>
          )}

          {hierarchy.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border" style={{ background: '#fbf2dc', borderColor: '#d9c688' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a6a18" strokeWidth="2">
                <path d="M12 2 2 21h20z" /><path d="M12 9v5M12 17h.01" />
              </svg>
              <span className="text-[11.5px]" style={{ color: '#8a6a18' }}>
                Add at least one hierarchy level before generating.
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
