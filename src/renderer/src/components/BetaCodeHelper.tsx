import React from 'react'
import { useTranslation } from 'react-i18next'
import { LETTER_PAIRS, MODIFIER_DESCRIPTIONS, PUNCTUATION_PAIRS, EXAMPLE_PAIRS } from '../utils/betaCode'

export default function BetaCodeHelper({ onClose }: { onClose?: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="rounded border text-[11.5px] px-4 py-3 mt-2 select-none"
      style={{ background: 'var(--paper-3)', borderColor: 'var(--line)', color: 'var(--mute)' }}
    >
      {/* Letter map */}
      <div className="flex items-center mb-1.5">
        <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--mute)' }}>
          Beta Code Reference
        </div>
        {onClose && (
          <button
            type="button"
            className="btn btn-quiet text-[11px] ml-auto"
            style={{ padding: '1px 7px', gap: 4 }}
            onClick={onClose}
            title={t('review.betacodeHideHelp')}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12" /></svg>
            {t('review.betacodeHideHelp')}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
        {LETTER_PAIRS.map(([beta, greek]) => (
          <span key={beta} className="inline-flex items-center gap-0.5">
            <span className="font-mono" style={{ color: 'var(--ink)' }}>{beta}</span>
            <span style={{ color: 'var(--mute)' }}>→</span>
            <span style={{ color: 'var(--oxblood)' }}>{greek}</span>
          </span>
        ))}
      </div>

      {/* Modifier row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
        <span className="font-mono text-[10px] uppercase tracking-wider w-full mb-0.5" style={{ color: 'var(--mute)' }}>
          Modifiers (type before vowel)
        </span>
        {MODIFIER_DESCRIPTIONS.map(([key, desc]) => (
          <span key={key} className="inline-flex items-center gap-1">
            <kbd
              className="font-mono px-1 py-0.5 rounded text-[10px]"
              style={{ background: 'var(--paper-2)', border: '1px solid var(--line-2)', color: 'var(--ink)' }}
            >
              {key === '\\' ? '\\' : key}
            </kbd>
            <span>{desc}</span>
          </span>
        ))}
      </div>

      {/* Punctuation */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
        <span className="font-mono text-[10px] uppercase tracking-wider w-full mb-0.5" style={{ color: 'var(--mute)' }}>
          Punctuation
        </span>
        {PUNCTUATION_PAIRS.map(([key, greek, name]) => (
          <span key={key} className="inline-flex items-center gap-0.5">
            <span className="font-mono" style={{ color: 'var(--ink)' }}>{key}</span>
            <span style={{ color: 'var(--mute)' }}>→</span>
            <span className="font-serif text-[13px]" style={{ color: 'var(--oxblood)' }}>{greek}</span>
            <span className="text-[10px]" style={{ color: 'var(--mute)' }}>{name}</span>
          </span>
        ))}
      </div>

      {/* Examples */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
        <span className="font-mono text-[10px] uppercase tracking-wider w-full mb-0.5" style={{ color: 'var(--mute)' }}>
          Examples
        </span>
        {EXAMPLE_PAIRS.map(([seq, result]) => (
          <span key={seq} className="inline-flex items-center gap-0.5">
            <span className="font-mono" style={{ color: 'var(--ink)' }}>{seq}</span>
            <span style={{ color: 'var(--mute)' }}>→</span>
            <span className="font-serif text-[13px]" style={{ color: 'var(--oxblood)' }}>{result}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
