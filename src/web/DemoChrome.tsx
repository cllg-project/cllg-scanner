import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEMO_NOTICE_EVENT, type DemoNotice } from './demoApi'

const REPO = 'https://github.com/cllg-project/cllg-scanner'
const DOWNLOAD = `${REPO}/releases/latest`
const TOAST_MS = 5000
// Below this width the app's side-by-side panels no longer fit (phones, small tablets).
const SMALL_SCREEN = '(max-width: 900px)'
const SMALL_SCREEN_OK_KEY = 'cllg:demoSmallScreenOk'

interface Toast { id: number; kind: DemoNotice; detail?: string }

function smallScreenDismissed(): boolean {
  try { return sessionStorage.getItem(SMALL_SCREEN_OK_KEY) === '1' } catch { return false }
}

/** Blocking notice on phones: the demo is usable there, but barely. */
function SmallScreenWarning(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [small, setSmall] = useState(() => window.matchMedia(SMALL_SCREEN).matches)
  const [dismissed, setDismissed] = useState(smallScreenDismissed)

  useEffect(() => {
    const mq = window.matchMedia(SMALL_SCREEN)
    const onChange = (): void => setSmall(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  if (!small || dismissed) return null

  const dismiss = (): void => {
    try { sessionStorage.setItem(SMALL_SCREEN_OK_KEY, '1') } catch { /* keep it for this page only */ }
    setDismissed(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-small-screen-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,   // above the tour (9900), which starts on every visit
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
          padding: '1.25rem 1.25rem 1rem',
          maxWidth: 380,
          width: '100%',
        }}
      >
        <h2 id="demo-small-screen-title" style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
          {t('demo.smallScreenTitle')}
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink)', margin: '0 0 1rem' }}>
          {t('demo.smallScreenBody')}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 13 }}>
            {t('demo.source')}
          </a>
          <button className="btn btn-primary" onClick={dismiss} style={{ fontSize: 13 }}>
            {t('demo.smallScreenContinue')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Web demo badge (download / source links) and the notices sent by demoApi. */
export default function DemoChrome(): React.JSX.Element {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let nextId = 0
    const onNotice = (e: Event): void => {
      const { kind, detail } = (e as CustomEvent<{ kind: DemoNotice; detail?: string }>).detail
      const id = nextId++
      // One toast per kind: a repeated click restarts it instead of stacking copies.
      setToasts((prev) => [...prev.filter((x) => x.kind !== kind), { id, kind, detail }])
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), TOAST_MS)
    }
    window.addEventListener(DEMO_NOTICE_EVENT, onNotice)
    return () => window.removeEventListener(DEMO_NOTICE_EVENT, onNotice)
  }, [])

  return (
    <>
    <SmallScreenWarning />
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        maxWidth: 'min(360px, calc(100vw - 24px))',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          style={{
            pointerEvents: 'auto',
            background: 'var(--ink)',
            color: 'var(--paper)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12.5,
            lineHeight: 1.5,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          {t(`demo.${toast.kind}`, { file: toast.detail })}
          {toast.kind === 'desktopOnly' && (
            <>
              {' '}
              <a href={DOWNLOAD} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                {t('demo.download')}
              </a>
            </>
          )}
        </div>
      ))}

      <div
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          padding: '5px 6px 5px 12px',
          fontSize: 12,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        }}
        title={t('demo.hint')}
      >
        <span
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 10,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: 'var(--oxblood)',
            whiteSpace: 'nowrap',
          }}
        >
          {t('demo.badge')}
        </span>
        {!collapsed && (
          <>
            <a href={DOWNLOAD} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999 }}>
              {t('demo.download')}
            </a>
            <a href={REPO} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', whiteSpace: 'nowrap' }}>
              {t('demo.source')}
            </a>
          </>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          style={{ color: 'var(--mute)', padding: '0 6px', fontSize: 14, lineHeight: 1 }}
        >
          {collapsed ? '‹' : '›'}
        </button>
      </div>
    </div>
    </>
  )
}
