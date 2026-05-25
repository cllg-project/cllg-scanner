import React from 'react'
import { LETTER_PAIRS, MODIFIER_DESCRIPTIONS, EXAMPLE_PAIRS } from '../utils/betaCode'

export default function BetaCodeHelper(): React.JSX.Element {
  return (
    <div
      className="rounded border text-[11.5px] px-4 py-3 mt-2 select-none"
      style={{ background: 'var(--paper-3)', borderColor: 'var(--line)', color: 'var(--mute)' }}
    >
      {/* Letter map */}
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--mute)' }}>
        Beta Code Reference
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
