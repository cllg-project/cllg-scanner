import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { applySuggestions, tagPageText, type Suggestion, type SuggestionKind } from '@shared/lightTag'

const KIND_COLOR: Record<SuggestionKind, string> = {
  REF: '#0369a1', BIBL: '#7b2d8b', NOTE: '#b45309', NOTEBIBL: '#b45309', NOTEREF: '#b45309',
}

interface Props {
  /** The page markdown the suggestions are computed on. */
  content: string
  /** Receives the markdown with the accepted tags written in. */
  onApply: (next: string) => void
  onClose: () => void
}

/**
 * Review panel for the light-tagger: lists the refs, bibliographic citations and notes
 * it finds in the page text, lets the user keep or drop each one, and writes the kept
 * ones into the markdown as `<ref>` / `<bibl>` / `<note>`. Suggestions are tied to the
 * markdown they were computed on, so editing the page invalidates them (re-run).
 */
export default function LightTagPanel({ content, onApply, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [snapshot] = useState(content)
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    tagPageText(snapshot).then(
      (s) => { if (live) setItems(s) },
      (e) => { if (live) setError(String(e)) }
    )
    return () => { live = false }
  }, [snapshot])

  const stale = content !== snapshot
  const kept = (items ?? []).filter((s) => !rejected.has(s.id))
  const toggle = (id: string): void =>
    setRejected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="px-6 py-2.5 border-b shrink-0 text-[11.5px]" style={{ borderColor: 'var(--line)', background: '#fffbeb' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono font-semibold shrink-0" style={{ color: '#b45309' }}>
          {items === null && !error ? t('review.lightTagRunning') : t('review.lightTagFound', { count: items?.length ?? 0 })}
        </span>
        {error && <span style={{ color: '#b04a3a' }}>{error}</span>}
        {stale && <span style={{ color: '#b04a3a' }}>{t('review.lightTagStale')}</span>}
        {items && items.length > 0 && !stale && (
          <button
            className="btn btn-quiet text-[11px] shrink-0"
            style={{ background: '#b45309', color: '#fff', borderColor: '#b45309', padding: '3px 10px' }}
            disabled={kept.length === 0}
            onClick={() => { onApply(applySuggestions(snapshot, kept)); onClose() }}
          >
            {t('review.lightTagApply', { count: kept.length })}
          </button>
        )}
        <button className="tool-btn ml-auto shrink-0" style={{ width: 20, height: 20 }} onClick={onClose}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {items && items.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 overflow-auto" style={{ maxHeight: 150 }}>
          {items.map((s) => (
            <label key={s.id} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!rejected.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="font-mono font-semibold shrink-0" style={{ color: KIND_COLOR[s.kind], width: 64 }}>{s.kind}</span>
              <span className="font-mono truncate" style={{ color: 'var(--ink)' }}>{s.text}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
