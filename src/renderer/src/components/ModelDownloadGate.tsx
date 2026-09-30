import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelDownloadEvent, ModelStatus } from '@shared/types'

type Phase = 'checking' | 'downloading' | 'error' | 'done' | 'hidden'

const mb = (bytes: number): string => (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)

/**
 * First run: the built-in Kraken models aren't shipped with the app; they are
 * downloaded from the GitHub release into the user-data folder. This overlay checks
 * for them at start-up and, if any is missing, downloads them with progress. It can be
 * hidden while the download goes on (Kraken OCR needs the models; importing and
 * masking don't), and offers a retry if the download fails.
 */
export default function ModelDownloadGate(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('checking')
  const [models, setModels] = useState<ModelStatus[]>([])
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    setPhase('downloading')
    setError(null)
    try {
      const status = await window.api.downloadModels()
      setModels(status)
      setPhase((p) => (p === 'hidden' ? 'hidden' : 'done'))
    } catch (err) {
      setError(String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    const unsub = window.api.onModelDownload((e: ModelDownloadEvent) => {
      setProgress((p) => ({ ...p, [e.file]: e.status === 'error' ? p[e.file] ?? 0 : e.received }))
      if (e.status === 'done') setModels((ms) => ms.map((m) => (m.file === e.file ? { ...m, present: true } : m)))
    })
    window.api.getModelStatus().then((status) => {
      setModels(status)
      if (status.every((m) => m.present)) setPhase('done')
      else void start()
    })
    return unsub
  }, [start])

  // Close by itself once everything is there.
  useEffect(() => {
    if (phase !== 'done') return
    const timer = setTimeout(() => setPhase('hidden'), 800)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === 'hidden' || phase === 'checking' || (phase === 'done' && models.every((m) => m.present) && !Object.keys(progress).length)) {
    return null
  }

  const missing = models.filter((m) => !m.present || progress[m.file] !== undefined)
  const total = missing.reduce((s, m) => s + m.size, 0)
  const received = missing.reduce((s, m) => s + (m.present ? m.size : progress[m.file] ?? 0), 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div
        className="rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6"
        style={{ background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line)' }}
      >
        <h2 className="font-serif text-[20px] leading-tight">{t('models.title')}</h2>
        <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--mute)' }}>
          {t('models.intro', { size: mb(total) })}
        </p>

        <div className="mt-4 space-y-2.5">
          {missing.map((m) => {
            const got = m.present ? m.size : progress[m.file] ?? 0
            const pct = Math.min(100, Math.round((got / m.size) * 100))
            return (
              <div key={m.file}>
                <div className="flex items-baseline gap-2 text-[12px]">
                  <span>{m.description}</span>
                  <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color: 'var(--mute)' }}>
                    {m.present ? '✓' : `${mb(got)} / ${mb(m.size)} MB`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--paper-3)' }}>
                  <div className="h-full" style={{ width: `${pct}%`, background: m.present ? 'var(--moss, #5a8c3f)' : '#0369a1', transition: 'width .2s' }} />
                </div>
              </div>
            )
          })}
        </div>

        {phase === 'error' && (
          <p className="text-[12px] mt-4 leading-relaxed" style={{ color: '#b04a3a' }}>
            {t('models.error')} {error}
          </p>
        )}
        {phase === 'done' && <p className="text-[12px] mt-4" style={{ color: 'var(--moss, #5a8c3f)' }}>{t('models.done')}</p>}

        <div className="flex items-center gap-2 mt-5">
          <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--mute)' }}>
            {total ? `${Math.round((received / total) * 100)}%` : ''}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {phase === 'error' && (
              <>
                <button className="btn btn-ghost" onClick={() => setPhase('hidden')}>{t('models.continueWithout')}</button>
                <button className="btn btn-primary" onClick={() => void start()}>{t('models.retry')}</button>
              </>
            )}
            {phase === 'downloading' && (
              <button className="btn btn-ghost" onClick={() => setPhase('hidden')} title={t('models.backgroundHint')}>
                {t('models.background')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
