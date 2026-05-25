import React, { useState, useEffect, useRef, useCallback } from 'react'
import { stringify } from 'yaml'
import { useNavigate } from 'react-router-dom'
import type { HierarchyLevel, ProjectMetadata, BibEntry, BibPerson, BibScope } from '@shared/types'
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

// ── Bibliography helpers ───────────────────────────────────────────────────────

interface BibPersonDraft { persName: string; viafId: string; worldcatId: string }
interface BibDraft {
  id: string; n: string
  authors: BibPersonDraft[]; editors: BibPersonDraft[]
  title: string; titleLevel: string
  publisher: string; pubPlace: string; date: string; dateReprint: string
  scopes: { unit: string; value: string }[]
}

const uid = (): string => Math.random().toString(36).slice(2, 10)
const newPerson = (): BibPersonDraft => ({ persName: '', viafId: '', worldcatId: '' })
const freshDraft = (): BibDraft => ({
  id: uid(), n: '',
  authors: [newPerson()], editors: [],
  title: '', titleLevel: 'm',
  publisher: '', pubPlace: '', date: '', dateReprint: '',
  scopes: [{ unit: 'page', value: '' }],
})
const entryToDraft = (e: BibEntry): BibDraft => ({
  id: e.id, n: e.n,
  authors: e.authors.length ? e.authors.map(a => ({ persName: a.persName, viafId: a.viafId ?? '', worldcatId: a.worldcatId ?? '' })) : [newPerson()],
  editors: e.editors.map(a => ({ persName: a.persName, viafId: a.viafId ?? '', worldcatId: a.worldcatId ?? '' })),
  title: e.title, titleLevel: e.titleLevel || 'm',
  publisher: e.publisher ?? '', pubPlace: e.pubPlace ?? '',
  date: e.date ?? '', dateReprint: e.dateReprint ?? '',
  scopes: e.scopes.length ? e.scopes : [{ unit: 'page', value: '' }],
})
const draftToEntry = (d: BibDraft): BibEntry => {
  const trimPerson = (a: BibPersonDraft): BibPerson => ({
    persName: a.persName,
    ...(a.viafId && { viafId: a.viafId }),
    ...(a.worldcatId && { worldcatId: a.worldcatId }),
  })
  const trimScope = (s: { unit: string; value: string }): BibScope => ({ unit: s.unit, value: s.value })
  return {
    id: d.id, n: d.n,
    authors: d.authors.filter(a => a.persName).map(trimPerson),
    editors: d.editors.filter(a => a.persName).map(trimPerson),
    title: d.title, titleLevel: d.titleLevel,
    publisher: d.publisher || undefined,
    pubPlace: d.pubPlace || undefined,
    date: d.date || undefined,
    dateReprint: d.dateReprint || undefined,
    scopes: d.scopes.filter(s => s.value).map(trimScope),
  }
}

const INP = 'border rounded px-2 py-1 text-[12px] outline-none w-full'
const inpStyle = { borderColor: 'var(--line)', background: 'var(--paper)', color: 'var(--ink)' }
const LABEL = 'text-[10px] font-mono tracking-[.14em] uppercase mb-0.5 block'
const labelStyle = { color: 'var(--mute)' }

const SCOPE_UNITS = ['page', 'volume', 'column', 'lines', 'part', 'section', 'fascicle']

function PersonList({ persons, list, onChange }: {
  persons: BibPersonDraft[]
  list: 'authors' | 'editors'
  onChange: (updated: BibPersonDraft[]) => void
}): React.JSX.Element {
  const setPerson = (i: number, k: keyof BibPersonDraft, v: string): void => {
    onChange(persons.map((p, j) => j === i ? { ...p, [k]: v } : p))
  }
  return (
    <div className="space-y-1">
      {persons.map((p, i) => (
        <div key={i} className="flex gap-1.5 items-end">
          <div className="flex-1">
            {i === 0 && <span style={labelStyle} className={LABEL}>Name</span>}
            <input className={INP} style={inpStyle} value={p.persName}
              placeholder="Personal name"
              onChange={e => setPerson(i, 'persName', e.target.value)} />
          </div>
          <div className="w-24">
            {i === 0 && <span style={labelStyle} className={LABEL}>VIAF ID</span>}
            <input className={INP} style={inpStyle} value={p.viafId}
              placeholder="e.g. 7524651"
              onChange={e => setPerson(i, 'viafId', e.target.value)} />
          </div>
          <div className="w-28">
            {i === 0 && <span style={labelStyle} className={LABEL}>WorldCat ID</span>}
            <input className={INP} style={inpStyle} value={p.worldcatId}
              placeholder="OCLC / WC"
              onChange={e => setPerson(i, 'worldcatId', e.target.value)} />
          </div>
          <button className="tool-btn shrink-0" style={{ marginBottom: 2 }}
            onClick={() => onChange(persons.filter((_, j) => j !== i))}
            title="Remove">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
      <button className="btn btn-quiet !py-0.5 !px-2 !text-[11px] mt-0.5"
        onClick={() => onChange([...persons, newPerson()])}>
        + {list === 'authors' ? 'Author' : 'Editor'}
      </button>
    </div>
  )
}

function BibForm({ draft, onChange, onSave, onCancel }: {
  draft: BibDraft
  onChange: (d: BibDraft) => void
  onSave: () => void
  onCancel: () => void
}): React.JSX.Element {
  const set = <K extends keyof BibDraft>(k: K, v: BibDraft[K]): void => onChange({ ...draft, [k]: v })

  return (
    <div className="border rounded-lg p-5 space-y-4" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
      <div className="flex gap-4">
        <div className="w-48">
          <span style={labelStyle} className={LABEL}>Identifier <span className="font-mono normal-case tracking-normal">n=</span></span>
          <input className={INP} style={inpStyle} value={draft.n}
            placeholder='e.g. 1381 001'
            onChange={e => set('n', e.target.value)} />
        </div>
      </div>

      <div>
        <span style={labelStyle} className={`${LABEL} mb-1`}>Authors</span>
        <PersonList persons={draft.authors} list="authors"
          onChange={updated => set('authors', updated)} />
      </div>

      <div>
        <span style={labelStyle} className={`${LABEL} mb-1`}>Editors</span>
        <PersonList persons={draft.editors} list="editors"
          onChange={updated => set('editors', updated)} />
      </div>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <span style={labelStyle} className={LABEL}>Title</span>
          <input className={INP} style={inpStyle} value={draft.title}
            placeholder="Work title"
            onChange={e => set('title', e.target.value)} />
        </div>
        <div className="w-32">
          <span style={labelStyle} className={LABEL}>Level</span>
          <select className={INP} style={inpStyle} value={draft.titleLevel}
            onChange={e => set('titleLevel', e.target.value)}>
            <option value="m">m — monograph</option>
            <option value="s">s — series</option>
            <option value="a">a — article</option>
            <option value="j">j — journal</option>
            <option value="">— none</option>
          </select>
        </div>
      </div>

      <div>
        <span style={labelStyle} className={`${LABEL} mb-1.5`}>Imprint</span>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span style={labelStyle} className={LABEL}>Publisher</span>
            <input className={INP} style={inpStyle} value={draft.publisher}
              placeholder="Publisher name"
              onChange={e => set('publisher', e.target.value)} />
          </div>
          <div>
            <span style={labelStyle} className={LABEL}>Place of publication</span>
            <input className={INP} style={inpStyle} value={draft.pubPlace}
              placeholder="City"
              onChange={e => set('pubPlace', e.target.value)} />
          </div>
          <div>
            <span style={labelStyle} className={LABEL}>Date</span>
            <input className={INP} style={inpStyle} value={draft.date}
              placeholder="e.g. 1846"
              onChange={e => set('date', e.target.value)} />
          </div>
          <div>
            <span style={labelStyle} className={LABEL}>Reprint date</span>
            <input className={INP} style={inpStyle} value={draft.dateReprint}
              placeholder="e.g. 1974"
              onChange={e => set('dateReprint', e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <span style={labelStyle} className={`${LABEL} mb-1`}>Bibliographic scope</span>
        <div className="space-y-1">
          {draft.scopes.map((s, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <select className="border rounded px-2 py-1 text-[12px] outline-none w-28 shrink-0"
                style={inpStyle} value={s.unit}
                onChange={e => onChange({ ...draft, scopes: draft.scopes.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) })}>
                {SCOPE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input className={INP} style={inpStyle} value={s.value}
                placeholder="e.g. 3–12 or MPG 2"
                onChange={e => onChange({ ...draft, scopes: draft.scopes.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
              <button className="tool-btn shrink-0"
                onClick={() => onChange({ ...draft, scopes: draft.scopes.filter((_, j) => j !== i) })}
                title="Remove">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          <button className="btn btn-quiet !py-0.5 !px-2 !text-[11px] mt-0.5"
            onClick={() => onChange({ ...draft, scopes: [...draft.scopes, { unit: 'page', value: '' }] })}>
            + Scope
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1 border-t" style={{ borderColor: 'var(--line)' }}>
        <button className="btn btn-ghost !text-[12px]" onClick={onCancel}>Discard</button>
        <button className="btn btn-primary !text-[12px]" onClick={onSave}>Done</button>
      </div>
    </div>
  )
}

function BibCard({ entry, onEdit, onDelete }: { entry: BibEntry; onEdit: () => void; onDelete: () => void }): React.JSX.Element {
  const author = entry.authors[0]?.persName ?? entry.editors[0]?.persName ?? ''
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
      <div className="flex-1 min-w-0">
        {entry.n && <span className="font-mono text-[10px] mr-2" style={{ color: 'var(--mute)' }}>{entry.n}</span>}
        {author && <span className="text-[12px] font-medium mr-1" style={{ color: 'var(--ink)' }}>{author}</span>}
        {entry.title && <span className="text-[12px] italic" style={{ color: 'var(--mute)' }}>{entry.title}</span>}
        {entry.date && <span className="text-[11px] ml-2" style={{ color: 'var(--mute)' }}>{entry.date}</span>}
      </div>
      <div className="flex gap-1 shrink-0">
        <button className="tool-btn" onClick={onEdit} title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button className="tool-btn" onClick={onDelete} title="Delete" style={{ color: '#c0392b' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── YAML export ───────────────────────────────────────────────────────────────

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
  const [bibliography, setBibliography] = useState<BibEntry[]>(project?.bibliography ?? [])
  const [bibDraft, setBibDraft] = useState<BibDraft | null>(null)
  const skipSave = useRef(true)

  useEffect(() => {
    if (!project) return
    skipSave.current = true
    setMetadata(project.metadata)
    setHierarchy(project.hierarchy)
    setBibliography(project.bibliography ?? [])
  }, [project?.id])

  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return }
    if (!project) return
    saveProject({ ...project, metadata, hierarchy, bibliography })
  }, [hierarchy, metadata, bibliography]) // eslint-disable-line react-hooks/exhaustive-deps

  const upsertBibDraft = useCallback((draft: BibDraft): void => {
    setBibDraft(draft)
    setBibliography(prev => {
      const entry = draftToEntry(draft)
      const idx = prev.findIndex(e => e.id === entry.id)
      return idx >= 0 ? prev.map((e, i) => i === idx ? entry : e) : [...prev, entry]
    })
  }, [])

  const cancelBibDraft = useCallback((draft: BibDraft): void => {
    setBibDraft(null)
    setBibliography(prev => {
      // remove the entry only if it was just created (no meaningful content yet)
      const entry = draftToEntry(draft)
      if (!entry.title && !entry.authors.some(a => a.persName)) {
        return prev.filter(e => e.id !== draft.id)
      }
      return prev
    })
  }, [])

  const deleteBibEntry = useCallback((id: string): void => {
    setBibliography(prev => prev.filter(e => e.id !== id))
  }, [])

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

            {/* Bibliography */}
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <div className="flex items-baseline gap-3">
                  <h3 className="font-serif text-[20px]">Bibliography</h3>
                  <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: 'var(--mute)' }}>
                    TEI sourceDesc
                  </span>
                </div>
                {!bibDraft && (
                  <button className="btn btn-quiet !py-1 !px-2 !text-[11px] gap-1" onClick={() => upsertBibDraft(freshDraft())}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add entry
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {bibliography.map(entry => (
                  bibDraft?.id === entry.id ? (
                    <BibForm key={entry.id}
                      draft={bibDraft}
                      onChange={upsertBibDraft}
                      onSave={() => setBibDraft(null)}
                      onCancel={() => cancelBibDraft(bibDraft)}
                    />
                  ) : (
                    <BibCard key={entry.id} entry={entry}
                      onEdit={() => upsertBibDraft(entryToDraft(entry))}
                      onDelete={() => deleteBibEntry(entry.id)} />
                  )
                ))}

                {bibDraft && !bibliography.some(e => e.id === bibDraft.id) ? (
                  <BibForm
                    draft={bibDraft}
                    onChange={upsertBibDraft}
                    onSave={() => setBibDraft(null)}
                    onCancel={() => cancelBibDraft(bibDraft)}
                  />
                ) : bibliography.length === 0 ? (
                  <div
                    className="panel p-5 flex flex-col items-center gap-2 text-center"
                    style={{ borderStyle: 'dashed' }}
                  >
                    <div className="text-[12.5px]" style={{ color: 'var(--mute)' }}>
                      No entries. Entries are placed in <span className="font-mono">&lt;sourceDesc&gt;&lt;listBibl&gt;</span> in the TEI header.
                    </div>
                    <button className="btn btn-quiet !py-1 !px-3 !text-[11.5px] mt-1" onClick={() => upsertBibDraft(freshDraft())}>
                      Add first entry
                    </button>
                  </div>
                ) : null}
              </div>
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
