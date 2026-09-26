import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Per-machine CPU threads for Kraken OCR, stored by the main process in settings.json
// (not in the project). Applies from the next page recognized.
export default function KrakenThreadsSetting(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [info, setInfo] = useState<{ threads: number; isDefault: boolean; defaultThreads: number; maxThreads: number } | null>(null)
  const [draft, setDraft] = useState<number | null>(null)

  useEffect(() => {
    window.api.getKrakenThreads().then(setInfo).catch(() => setInfo(null))
  }, [])

  if (!info) return null
  const value = draft ?? info.threads

  const commit = async (n: number | null): Promise<void> => {
    setDraft(null)
    await window.api.setKrakenThreads(n)
    setInfo(await window.api.getKrakenThreads())
  }

  return (
    <div className="flex items-center gap-3 text-[11.5px] mt-2.5 pt-2.5 border-t" style={{ borderColor: 'var(--line)' }}>
      <span className="shrink-0" style={{ color: 'var(--mute)', minWidth: 130 }} title={t('krakenModel.threadsHint')}>
        {t('krakenModel.threads')}
      </span>
      <input
        type="range"
        min={1}
        max={info.maxThreads}
        step={1}
        value={value}
        className="flex-1 max-w-[260px]"
        style={{ accentColor: 'var(--oxblood)' }}
        aria-label={t('krakenModel.threads')}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => { if (draft !== null && draft !== info.threads) void commit(draft) }}
        onKeyUp={() => { if (draft !== null && draft !== info.threads) void commit(draft) }}
        onBlur={() => { if (draft !== null && draft !== info.threads) void commit(draft) }}
      />
      <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--ink)', minWidth: 64 }}>
        {value} / {info.maxThreads}
      </span>
      {info.isDefault && draft === null ? (
        <span className="shrink-0" style={{ color: 'var(--mute)' }}>{t('krakenModel.threadsAuto')}</span>
      ) : (
        <button
          type="button"
          className="btn btn-quiet text-[11px] shrink-0"
          style={{ padding: '2px 8px' }}
          onClick={() => void commit(null)}
        >
          {t('krakenModel.threadsReset', { n: info.defaultThreads })}
        </button>
      )}
      <span className="text-[10.5px]" style={{ color: 'var(--mute)' }}>{t('krakenModel.threadsHint')}</span>
    </div>
  )
}
