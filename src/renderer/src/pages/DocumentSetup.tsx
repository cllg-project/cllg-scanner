import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { DocumentType, KrakenConfig, ZoneAction } from '@shared/types'
import { blockTagForType, defaultZoneAction, regionKind, zoneAction, type RegionKind } from '@shared/zones'
import Sidebar from '../components/Sidebar'
import { useProject } from '../App'

const CURRENT_STEP = 2

const ACTIONS: ZoneAction[] = ['annotate', 'keep', 'drop']

// Region kinds in the order the zone table lists them.
const GROUPS: { kind: RegionKind; key: string }[] = [
  { kind: 'main', key: 'main' },
  { kind: 'margin', key: 'margin' },
  { kind: 'dropcap', key: 'dropcap' },
  { kind: 'other', key: 'other' },
  { kind: 'skip', key: 'skip' },
]

const ACTION_STYLE: Record<ZoneAction, React.CSSProperties> = {
  annotate: { background: '#5a8c3f', color: '#fff', borderColor: '#5a8c3f' },
  keep: { background: '#0369a1', color: '#fff', borderColor: '#0369a1' },
  drop: { background: '#8a8272', color: '#fff', borderColor: '#8a8272' },
}

/**
 * What a region type becomes in the page text under an action (TEI element names are
 * not translated).
 */
function outcome(type: string, action: ZoneAction, documentType: DocumentType, t: (k: string) => string): string {
  if (action === 'drop') return t('document.outcomeDropped')
  const kind = regionKind(type)
  if (kind === 'dropcap') return t('document.outcomeDropcap')
  if (kind === 'margin') return documentType === 'cllg' ? t('document.outcomeMarginCllg') : action === 'annotate' ? '<note zone="…">' : '<note>'
  const tag = blockTagForType(type)
  if (action === 'annotate' && tag) return `<${tag} zone="…">`
  return action === 'annotate' ? t('document.outcomeLinesZone') : t('document.outcomeLines')
}

export default function DocumentSetup(): React.JSX.Element {
  const { t } = useTranslation()
  const STEP_LABELS = [t('steps.import'), t('steps.document'), t('steps.mask'), t('steps.ocr'), t('steps.config'), t('steps.review'), t('steps.tei')]
  const { project, saveProject } = useProject()
  const navigate = useNavigate()

  const [config, setConfig] = useState<KrakenConfig | null>(project?.krakenConfig ?? null)
  const [classes, setClasses] = useState<string[]>([])
  const [classError, setClassError] = useState<string | null>(null)
  const [builtinRegionPaths, setBuiltinRegionPaths] = useState<Record<DocumentType, string> | null>(null)

  // A project without Kraken settings yet starts from the built-in models, with zone
  // detection on (as the OCR step would).
  useEffect(() => {
    window.api.getKrakenBuiltinPaths().then((paths) => {
      setBuiltinRegionPaths(paths.regionModelPaths)
      if (project?.krakenConfig) return
      setConfig({
        segModelPath: paths.segModelPath,
        recModelPath: paths.recModelPath,
        builtinModels: true,
        documentType: 'cllg',
        regionModelPath: paths.regionModelPaths.cllg,
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.projectDir])

  const documentType: DocumentType = config?.documentType ?? 'cllg'
  const regionModelPath = config?.regionModelPath ?? ''
  const policy = config?.zonePolicy ?? {}

  useEffect(() => {
    setClassError(null)
    if (!regionModelPath) { setClasses([]); return }
    window.api.getRegionClasses(regionModelPath)
      .then(setClasses)
      .catch((err: unknown) => { setClasses([]); setClassError(String(err)) })
  }, [regionModelPath])

  const update = useCallback(
    (next: KrakenConfig) => {
      setConfig(next)
      if (project) void saveProject({ ...project, krakenConfig: next })
    },
    [project, saveProject]
  )

  // With built-in models, the region model follows the document type.
  const chooseDocumentType = (type: DocumentType): void => {
    if (!config) return
    const regionPath = config.builtinModels && config.regionModelPath && builtinRegionPaths ? builtinRegionPaths[type] : config.regionModelPath
    update({ ...config, documentType: type, regionModelPath: regionPath })
  }

  const toggleRegions = async (on: boolean): Promise<void> => {
    if (!config) return
    if (!on) { update({ ...config, regionModelPath: '' }); return }
    if (config.builtinModels && builtinRegionPaths) {
      update({ ...config, regionModelPath: builtinRegionPaths[documentType] })
      return
    }
    const picked = await window.api.selectKrakenModel('region')
    if (picked) update({ ...config, regionModelPath: picked })
  }

  const setAction = (type: string, action: ZoneAction): void => {
    if (!config) return
    const next = { ...policy }
    // Only choices that differ from the default are stored.
    if (action === defaultZoneAction(type)) delete next[type]
    else next[type] = action
    update({ ...config, zonePolicy: next })
  }

  const setAll = (types: string[], action: ZoneAction): void => {
    if (!config) return
    const next = { ...policy }
    for (const type of types) {
      if (action === defaultZoneAction(type)) delete next[type]
      else next[type] = action
    }
    update({ ...config, zonePolicy: next })
  }

  const resetDefaults = (): void => {
    if (config) update({ ...config, zonePolicy: {} })
  }

  // The model's classes, plus any type the policy mentions that this model lacks.
  const types = useMemo(() => {
    const all = [...classes]
    for (const type of Object.keys(policy)) if (!all.includes(type)) all.push(type)
    return all
  }, [classes, policy])

  const counts = useMemo(() => {
    const c: Record<ZoneAction, number> = { annotate: 0, keep: 0, drop: 0 }
    for (const type of types) c[zoneAction(type, policy)]++
    return c
  }, [types, policy])

  if (!project) return <div className="p-8">{t('common.noProjectOpen')}</div>

  return (
    <div className="flex h-full">
      <Sidebar collapsed />

      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--paper-2)' }}>
        {/* ── Header ── */}
        <div className="px-8 pt-5 pb-4 border-b shrink-0" style={{ borderColor: 'var(--line)', boxShadow: '0 1px 0 var(--line)' }}>
          <div className="flex items-center gap-1.5 mb-3" style={{ fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 10, letterSpacing: '.04em', color: 'var(--mute)' }}>
            <span className="text-[10px] tracking-[.18em] uppercase mr-1" style={{ color: 'var(--mute-2)' }}>Step</span>
            {STEP_LABELS.map((_label, i) => {
              const n = i + 1
              const isDone = n < CURRENT_STEP
              const isCurrent = n === CURRENT_STEP
              return (
                <span
                  key={n}
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
              <h2 className="font-serif text-[26px] leading-none">{t('document.title')}</h2>
              <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--mute)' }}>{t('document.subtitle')}</div>
            </div>
            <button className="btn btn-primary shrink-0" onClick={() => navigate('/masker')}>
              {t('document.continue')}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-8 pt-5 pb-8 space-y-5">

          {/* Document type */}
          <section data-tour="document-type">
            <h3 className="font-serif text-[16px] mb-2">{t('document.typeTitle')}</h3>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {(['cllg', 'ladas'] as const).map((type) => {
                const selected = documentType === type
                return (
                  <button
                    key={type}
                    type="button"
                    className="panel text-left px-4 py-3"
                    style={{ borderColor: selected ? '#0369a1' : undefined, boxShadow: selected ? '0 0 0 2px #0369a1' : undefined, cursor: 'pointer' }}
                    onClick={() => chooseDocumentType(type)}
                    disabled={!config}
                  >
                    <div className="flex items-center gap-2">
                      <input type="radio" readOnly checked={selected} />
                      <span className="font-serif text-[15px]">{t(`krakenModel.documentTypes.${type}`)}</span>
                    </div>
                    <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--mute)' }}>{t(`document.typeDescription.${type}`)}</p>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Zones */}
          <section data-tour="document-zones">
            <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
              <div>
                <h3 className="font-serif text-[16px]">{t('document.zonesTitle')}</h3>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--mute)' }}>{t('document.zonesSubtitle')}</p>
              </div>
              <div className="flex items-center gap-3 text-[12px]">
                <label className="flex items-center gap-1.5 cursor-pointer" title={t('krakenModel.regionsHint')}>
                  <input type="checkbox" checked={!!regionModelPath} disabled={!config} onChange={(e) => void toggleRegions(e.target.checked)} />
                  {t('krakenModel.detectRegions')}
                </label>
                {!!regionModelPath && (
                  <button className="btn btn-quiet text-[11px]" style={{ padding: '2px 8px' }} onClick={resetDefaults}>
                    {t('document.resetDefaults')}
                  </button>
                )}
              </div>
            </div>

            {!regionModelPath ? (
              <div className="panel px-4 py-3 text-[12px]" style={{ color: 'var(--mute)' }}>{t('document.noRegionModel')}</div>
            ) : classError ? (
              <div className="panel px-4 py-3 text-[12px]" style={{ color: '#b04a3a' }}>{classError}</div>
            ) : (
              <div className="panel overflow-hidden">
                <div className="px-4 py-2 border-b flex items-center gap-3 text-[11px] font-mono" style={{ borderColor: 'var(--line)', color: 'var(--mute)' }}>
                  <span className="truncate" title={regionModelPath}>{regionModelPath.split(/[\\/]/).pop()}</span>
                  <span className="ml-auto shrink-0">
                    {ACTIONS.map((a) => `${t(`document.action.${a}`)} ${counts[a]}`).join(' · ')}
                  </span>
                </div>
                {GROUPS.map(({ kind, key }) => {
                  const groupTypes = types.filter((type) => regionKind(type) === kind)
                  if (!groupTypes.length) return null
                  return (
                    <div key={kind}>
                      <div className="px-4 py-1.5 flex items-center gap-2 border-b" style={{ borderColor: 'var(--line)', background: 'var(--paper-3)' }}>
                        <span className="text-[10px] uppercase tracking-[.12em] font-semibold" style={{ color: 'var(--mute)' }}>{t(`document.groups.${key}`)}</span>
                        <span className="ml-auto flex items-center gap-1">
                          {ACTIONS.map((a) => (
                            <button key={a} className="btn btn-quiet text-[10.5px]" style={{ padding: '1px 6px' }} onClick={() => setAll(groupTypes, a)} title={t('document.setAll')}>
                              {t(`document.action.${a}`)}
                            </button>
                          ))}
                        </span>
                      </div>
                      {groupTypes.map((type) => {
                        const action = zoneAction(type, policy)
                        return (
                          <div key={type} className="px-4 py-1.5 flex items-center gap-3 border-b text-[12px]" style={{ borderColor: 'var(--line-2)' }}>
                            {/* Zone type names are not translated. */}
                            <span className="font-mono" style={{ minWidth: 240 }}>{type}</span>
                            <span className="font-mono text-[11px] truncate" style={{ color: 'var(--mute)' }}>
                              {outcome(type, action, documentType, t)}
                            </span>
                            <span className="ml-auto flex items-center gap-0.5 shrink-0">
                              {ACTIONS.map((a) => (
                                <button
                                  key={a}
                                  className="btn btn-quiet text-[11px]"
                                  style={{ padding: '2px 9px', ...(action === a ? ACTION_STYLE[a] : {}) }}
                                  title={t(`document.actionHint.${a}`)}
                                  onClick={() => setAction(type, a)}
                                >
                                  {t(`document.action.${a}`)}
                                </button>
                              ))}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--mute)' }}>{t('document.policyNote')}</p>
          </section>
        </div>
      </main>
    </div>
  )
}

