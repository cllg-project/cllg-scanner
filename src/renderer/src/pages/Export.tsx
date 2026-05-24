import React, { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'
import { hierarchyToYAML } from './Config'

export default function Export(): React.JSX.Element {
  const { project, saveProject } = useProject()
  const [log, setLog] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [lastOutputPath, setLastOutputPath] = useState<string | null>(null)
  const [ocrPreview, setOcrPreview] = useState<string>('')
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

    const compiledYAML = hierarchyToYAML(project.hierarchy, project.metadata)
    const markdownPath = `${project.projectDir}/ocr_output.md`
    const outputPath = await window.api.selectSaveFile(`${project.name}.xml`, 'xml')
    if (!outputPath) { setGenerating(false); return }

    const yamlPath = `${project.projectDir}/structure.yaml`
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
  }, [project, saveProject])

  if (!project) return <div className="p-8">No project open.</div>

  const hasHierarchy = project.hierarchy.length > 0

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--paper-2)' }}>
        {/* Header */}
        <div className="px-10 pt-7 pb-4 border-b flex items-end justify-between shrink-0" style={{ borderColor: 'var(--line)' }}>
          <div>
            <div className="font-mono text-[10px] tracking-[.18em] uppercase" style={{ color: 'var(--mute)' }}>
              Step 06 of 06
            </div>
            <h2 className="font-serif text-[28px] leading-tight mt-1">TEI Export</h2>
            <div className="text-[12.5px] mt-1" style={{ color: 'var(--mute)' }}>
              CLLG concatenates the OCR'd markdown and emits a single TEI P5 XML file.
            </div>
          </div>
          <div className="text-[11.5px] font-mono text-right" style={{ color: 'var(--mute)' }}>
            schema · <span style={{ color: 'var(--ink)' }}>tei_all.rng</span><br />
            encoding · <span style={{ color: 'var(--ink)' }}>UTF-8 (NFC)</span>
          </div>
        </div>

        {/* OCR output preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-10 pt-5 pb-0 border-b flex items-end gap-1 shrink-0" style={{ borderColor: 'var(--line)' }}>
            <span className="px-3 py-2 text-[12.5px] font-medium border-b-2" style={{ borderColor: 'var(--oxblood)', color: 'var(--ink)' }}>
              ocr_output.md
            </span>
            <div className="ml-auto pb-1 text-[11.5px] font-mono" style={{ color: 'var(--mute)' }}>
              {(ocrPreview.match(/<pb n="/g) ?? []).length} pages done
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-10 py-6">
            <div className="code text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: ocrPreview ? 'var(--ink)' : 'var(--mute)' }}>
              {ocrPreview || '(OCR output will appear here after running OCR)'}
            </div>
          </div>

          {log.length > 0 && (
            <div className="px-10 py-4 border-t shrink-0" style={{ borderColor: 'var(--line)' }}>
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

        {/* Bottom bar */}
        <div className="border-t px-6 h-14 flex items-center gap-4 shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
          <button
            className="btn btn-primary"
            onClick={generate}
            disabled={generating || !hasHierarchy}
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

          {!hasHierarchy && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border" style={{ background: '#fbf2dc', borderColor: '#d9c688' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a6a18" strokeWidth="2">
                <path d="M12 2 2 21h20z" /><path d="M12 9v5M12 17h.01" />
              </svg>
              <span className="text-[11.5px]" style={{ color: '#8a6a18' }}>
                No hierarchy defined — go back to Structure configuration.
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
