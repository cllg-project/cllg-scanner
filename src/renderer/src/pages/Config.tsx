import React, { useState, useEffect, useRef } from 'react'
import { stringify } from 'yaml'
import { useNavigate } from 'react-router-dom'
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
            <div className="flex gap-1.5 items-center">
              <input
                type="color"
                value={level.color ?? '#888888'}
                onChange={(e) => onChange({ ...level, color: e.target.value })}
                title="Highlight color for this level"
                style={{ width: 28, height: 28, padding: 2, borderRadius: 4, border: '1px solid var(--line-2)', cursor: 'pointer', flexShrink: 0 }}
              />
              <input
                className="input text-[12.5px]"
                value={level.name}
                onChange={(e) => onChange({ ...level, name: e.target.value })}
                placeholder="chapter"
              />
            </div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--mute)' }}>Format / pattern</div>
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
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={level.isMilestone}
                onChange={(e) => onChange({ ...level, isMilestone: e.target.checked })}
                className="rounded border"
                style={{ borderColor: 'var(--line-2)', accentColor: 'var(--oxblood)' }}
              />
              milestone
            </label>
          </div>

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
                      { name: '', pattern: 'Arabic', format: '', missingFirst: false, allowGaps: false, isMilestone: false, children: [] }
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
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add child level
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function hierarchyToYAML(hierarchy: HierarchyLevel[], metadata: ProjectMetadata): string {
  function levelToObj(l: HierarchyLevel): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      name: l.name,
      format: l.pattern,
      missing_first: l.missingFirst,
      ...(l.isMilestone && { is_milestone: true })
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

export default function Config(): React.JSX.Element {
  const { project, saveProject } = useProject()
  const navigate = useNavigate()
  const [metadata, setMetadata] = useState<ProjectMetadata>(
    project?.metadata ?? { title: '', author: '', edition: '', language: '' }
  )
  const [hierarchy, setHierarchy] = useState<HierarchyLevel[]>(project?.hierarchy ?? [])
  const skipSave = useRef(true)

  useEffect(() => {
    if (!project) return
    skipSave.current = true
    setMetadata(project.metadata)
    setHierarchy(project.hierarchy)
  }, [project?.id])

  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return }
    if (!project) return
    saveProject({ ...project, metadata, hierarchy })
  }, [hierarchy, metadata]) // eslint-disable-line react-hooks/exhaustive-deps

  const compiledYAML = hierarchyToYAML(hierarchy, metadata)

  const addLevel = (): void => {
    setHierarchy([
      ...hierarchy,
      { name: '', pattern: 'Roman', format: '', missingFirst: false, allowGaps: false, isMilestone: false, children: [] }
    ])
  }

  if (!project) return <div className="p-8">No project open.</div>

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--paper-2)' }}>
        {/* Header */}
        <div className="px-10 pt-7 pb-5 border-b shrink-0" style={{ borderColor: 'var(--line)' }}>
          <div className="font-mono text-[10px] tracking-[.18em] uppercase mb-1" style={{ color: 'var(--mute)' }}>
            Step 04 of 06
          </div>
          <h2 className="font-serif text-[28px] leading-tight">Structure configuration</h2>
          <div className="text-[12.5px] mt-1" style={{ color: 'var(--mute)' }}>
            Describe the textual hierarchy and document metadata. This drives both TEI export and reference classification.
          </div>
        </div>

        {/* Two-col body */}
        <div className="flex-1 overflow-hidden grid divide-x" style={{ gridTemplateColumns: '1fr 360px', borderColor: 'var(--line)' }}>

          {/* Left — editor */}
          <div className="overflow-y-auto px-10 py-7 flex flex-col gap-8">

            {/* Metadata */}
            <section>
              <div className="flex items-baseline gap-3 mb-4">
                <h3 className="font-serif text-[20px]">Document metadata</h3>
                <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: 'var(--mute)' }}>
                  TEI header
                </span>
              </div>
              <div className="panel p-5 grid grid-cols-2 gap-4">
                {(
                  [
                    ['title', 'Title'],
                    ['author', 'Author'],
                    ['edition', 'Edition / source'],
                    ['language', 'Language (BCP-47)']
                  ] as const
                ).map(([k, label]) => (
                  <div key={k}>
                    <div className="label mb-1.5">{label}</div>
                    <input
                      className="input"
                      value={metadata[k as keyof ProjectMetadata]}
                      onChange={(e) => setMetadata((m) => ({ ...m, [k]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* Hierarchy */}
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <div className="flex items-baseline gap-3">
                  <h3 className="font-serif text-[20px]">Hierarchy</h3>
                  <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: 'var(--mute)' }}>
                    TEI structure
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn btn-quiet !py-1 !px-2 !text-[11px] gap-1" onClick={addLevel}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add level
                  </button>
                </div>
              </div>

              {hierarchy.length === 0 && (
                <div
                  className="panel p-6 flex flex-col items-center gap-2 text-center"
                  style={{ borderStyle: 'dashed' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--mute)' }}>
                    <path d="M12 2 2 21h20z" /><path d="M12 9v5M12 17h.01" />
                  </svg>
                  <div className="text-[12.5px]" style={{ color: 'var(--mute)' }}>
                    No levels defined. Add at least one to enable TEI export.
                  </div>
                  <button className="btn btn-quiet !py-1 !px-3 !text-[11.5px] mt-1" onClick={addLevel}>
                    Add first level
                  </button>
                </div>
              )}

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
                        { name: '', pattern: 'Arabic', format: '', missingFirst: false, allowGaps: false, isMilestone: false, children: [] }
                      ]
                    }
                    setHierarchy(h)
                  }}
                />
              ))}
            </section>
          </div>

          {/* Right — live YAML preview */}
          <div className="flex flex-col overflow-hidden border-l" style={{ borderColor: 'var(--line)' }}>
            <div
              className="px-5 py-3 border-b shrink-0 flex items-center justify-between"
              style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}
            >
              <span className="font-mono text-[11px] tracking-wider uppercase" style={{ color: 'var(--mute)' }}>
                structure.yaml
              </span>
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--mute)' }}>
                live preview
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <pre
                className="code text-[12px] leading-relaxed whitespace-pre-wrap"
                style={{ color: compiledYAML ? 'var(--ink)' : 'var(--mute)' }}
              >
                {compiledYAML || '# fill in metadata and hierarchy\n# to see the compiled YAML'}
              </pre>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="border-t px-6 h-14 flex items-center gap-3 shrink-0"
          style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}
        >
          <button className="btn btn-ghost" onClick={() => navigate('/ocr')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to OCR
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11.5px] font-mono" style={{ color: 'var(--mute)' }}>
              auto-saved
            </span>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/review')}
            >
              Next: Review
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
