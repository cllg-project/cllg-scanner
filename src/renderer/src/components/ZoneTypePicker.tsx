import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { zoneColor } from '../utils/zoneColors'
import { filterZoneTypes, type ZoneTypeOption } from '../utils/zoneTypeFilter'

export type { ZoneTypeOption }

// A keyboard key, styled like the tag-shortcut badges of Review's toolbar.
function Kbd({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <kbd
      style={{
        fontFamily: 'ui-monospace, monospace', fontSize: 9.5, padding: '0 4px', borderRadius: 3, lineHeight: '14px',
        background: 'rgba(0,0,0,.06)', border: '1px solid rgba(0,0,0,.15)', color: 'var(--mute)', flexShrink: 0, ...style,
      }}
    >
      {children}
    </kbd>
  )
}

export interface ZoneTypePickerHandle {
  /** Opens the list with the filter focused (the picker's own keyboard shortcut). */
  open: () => void
}

interface ZoneTypePickerProps {
  value: string
  options: ZoneTypeOption[]
  onChange: (type: string) => void
  openKey?: string      // shown on the closed picker, e.g. "T"
  title?: string
  hiddenTypes?: Set<string>   // types that may not be picked, not even typed in full
}

/**
 * Zone type selector with type-ahead filtering: typing narrows the list (see
 * filterZoneTypes — "head", "mzh", or a shortcut letter all work), ↑/↓ move, Enter
 * picks, Escape closes. A query matching no type can still be used as a type of its own.
 * Each option shows its colour, its group and its keyboard shortcut.
 */
const ZoneTypePicker = forwardRef<ZoneTypePickerHandle, ZoneTypePickerProps>(function ZoneTypePicker(
  { value, options, onChange, openKey, title, hiddenTypes },
  ref
) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // Where the list goes on screen. It is rendered in document.body (a portal), not
  // inside the picker: the toolbar's panes clip their overflow, which hid the list.
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null)

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
      setQuery('')
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    },
  }))

  const matches = useMemo(() => filterZoneTypes(options, query), [options, query])
  // A typed type no option has (another model's class, a custom zone) can be used as is.
  const typed = query.trim()
  const custom =
    typed &&
    !options.some((o) => o.type.toLowerCase() === typed.toLowerCase()) &&
    ![...(hiddenTypes ?? [])].some((h) => h.toLowerCase() === typed.toLowerCase())
      ? typed
      : null
  const count = matches.length + (custom ? 1 : 0)

  useEffect(() => setActive(0), [query, open])

  // Place the list under the picker, or above it when there's more room there; follow
  // the picker when anything scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = (): void => {
      const r = boxRef.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - 8
      const above = r.top - 8
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 340))
      setPos(
        below >= 200 || below >= above
          ? { left, top: r.bottom + 4, maxHeight: Math.min(320, below) }
          : { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(320, above) }
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  // Keep the highlighted option in view — scrolling the list only (scrollIntoView would
  // also scroll the panes around the picker).
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    if (!list || !el) return
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight
    }
  }, [active, pos])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const pick = (type: string): void => {
    onChange(type)
    close()
  }

  const pickActive = (): void => {
    if (active < matches.length) pick(matches[active].type)
    else if (custom) pick(custom)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Keys typed here must not reach the page's own shortcuts (G, P, Delete…).
    e.stopPropagation()
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (count ? (i + 1) % count : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (count ? (i - 1 + count) % count : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (open) pickActive(); else setOpen(true) }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'Tab' && open) { if (count) { e.preventDefault(); pickActive() } }
  }

  const { fg } = zoneColor(value)

  return (
    <div className="relative shrink-0" title={title}>
      <div
        ref={boxRef}
        className="flex items-center rounded border"
        style={{ borderColor: open ? '#7a4fae' : 'var(--line-2)', background: 'var(--paper)', boxShadow: open ? '0 0 0 1px #7a4fae' : undefined }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: fg, marginLeft: 6, flexShrink: 0 }} />
        <input
          ref={inputRef}
          className="font-mono text-[11px] bg-transparent outline-none"
          style={{ width: 170, padding: '2px 6px' }}
          value={open ? query : value}
          placeholder={value}
          spellCheck={false}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => { setOpen(false); setQuery('') }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onMouseDown={(e) => {
            // Focus without letting the browser scroll the (clipped) toolbar sideways.
            if (document.activeElement !== e.currentTarget) { e.preventDefault(); e.currentTarget.focus({ preventScroll: true }) }
          }}
          onKeyDown={onKeyDown}
          aria-expanded={open}
          role="combobox"
        />
        {openKey && !open && <Kbd style={{ marginRight: 4 }}>{openKey}</Kbd>}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 6, color: 'var(--mute)' }}><path d="m6 9 6 6 6-6" /></svg>
      </div>

      {open && pos && createPortal(
        <div
          ref={listRef}
          role="listbox"
          className="fixed rounded border shadow-lg overflow-y-auto text-[11.5px]"
          style={{
            zIndex: 1000, minWidth: 320, left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight,
            background: 'var(--paper)', borderColor: 'var(--line-2)', color: 'var(--ink)',
          }}
          // Keep focus in the input while clicking an option.
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((o, i) => {
            const c = zoneColor(o.type)
            return (
              <div
                key={o.type}
                data-idx={i}
                role="option"
                aria-selected={i === active}
                className="flex items-center gap-2 px-2 py-1 cursor-pointer"
                style={{ background: i === active ? 'var(--paper-3)' : undefined }}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.type)}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c.fg, flexShrink: 0 }} />
                <span className="font-mono" style={{ fontWeight: o.type === value ? 700 : 400 }}>{o.type}</span>
                {o.note && <span className="text-[10.5px] truncate" style={{ color: 'var(--mute)' }}>{o.note}</span>}
                {o.shortcut && <Kbd style={{ marginLeft: 'auto' }}>{o.shortcut}</Kbd>}
              </div>
            )
          })}
          {custom && (
            <div
              data-idx={matches.length}
              role="option"
              aria-selected={active === matches.length}
              className="flex items-center gap-2 px-2 py-1 cursor-pointer border-t"
              style={{ borderColor: 'var(--line-2)', background: active === matches.length ? 'var(--paper-3)' : undefined }}
              onMouseEnter={() => setActive(matches.length)}
              onClick={() => pick(custom)}
            >
              <span style={{ color: 'var(--mute)' }}>{t('review.zoneTypeUse')}</span>
              <span className="font-mono">{custom}</span>
            </div>
          )}
          {!count && <div className="px-2 py-1.5" style={{ color: 'var(--mute)' }}>{t('review.zoneTypeNoMatch')}</div>}
          <div className="px-2 py-1 border-t text-[10px]" style={{ borderColor: 'var(--line-2)', color: 'var(--mute)' }}>
            {t('review.zoneTypeKeysHint')}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
})

export default ZoneTypePicker
