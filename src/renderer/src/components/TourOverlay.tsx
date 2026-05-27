import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { TOUR_STEPS } from '../data/tourSteps'
import { buildTourDemoProject } from '../data/tourDemoProject'
import { useProject } from '../App'
import type { TourState } from '../hooks/useTour'
import type { Project } from '@shared/types'

interface Rect { top: number; left: number; width: number; height: number }

const PADDING = 8   // px around the spotlight highlight
const PANEL_W = 340 // tooltip panel width

function getSpotlightRect(selector: string): Rect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    top:    r.top    - PADDING,
    left:   r.left   - PADDING,
    width:  r.width  + PADDING * 2,
    height: r.height + PADDING * 2,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function panelPosition(
  spotlight: Rect | null,
  preferred: 'top' | 'bottom' | 'left' | 'right' | 'center'
): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const panelH = 440 // rough max height

  if (!spotlight || preferred === 'center') {
    return {
      position: 'fixed',
      top:  '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: PANEL_W,
    }
  }

  const gap = 14
  const { top, left, width, height } = spotlight

  if (preferred === 'bottom' || (preferred === 'top' && top < panelH + gap)) {
    const panelTop = top + height + gap
    if (panelTop + panelH < vh) {
      return {
        position: 'fixed',
        top:  clamp(panelTop, 8, vh - panelH - 8),
        left: clamp(left + width / 2 - PANEL_W / 2, 8, vw - PANEL_W - 8),
        width: PANEL_W,
      }
    }
  }

  if (preferred === 'top') {
    return {
      position: 'fixed',
      top:  clamp(top - panelH - gap, 8, vh - panelH - 8),
      left: clamp(left + width / 2 - PANEL_W / 2, 8, vw - PANEL_W - 8),
      width: PANEL_W,
    }
  }

  if (preferred === 'right' || (preferred === 'left' && left < PANEL_W + gap)) {
    const panelLeft = left + width + gap
    if (panelLeft + PANEL_W < vw) {
      return {
        position: 'fixed',
        top:  clamp(top + height / 2 - panelH / 2, 8, vh - panelH - 8),
        left: panelLeft,
        width: PANEL_W,
      }
    }
  }

  // left
  return {
    position: 'fixed',
    top:  clamp(top + height / 2 - panelH / 2, 8, vh - panelH - 8),
    left: clamp(left - PANEL_W - gap, 8, vw - PANEL_W - 8),
    width: PANEL_W,
  }
}

export default function TourOverlay({ tour }: { tour: TourState }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { active, stepIndex, next, prev, skip, total } = tour
  const step = TOUR_STEPS[stepIndex]
  const navigate = useNavigate()
  const location = useLocation()
  const { project, setProjectSilent } = useProject()

  const [spotlight, setSpotlight] = useState<Rect | null>(null)
  const [settling, setSettling] = useState(false)
  const rafRef       = useRef<number | null>(null)
  const settleRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevProjectRef = useRef<Project | null>(null)

  // Inject / restore the demo project when the tour opens or closes
  useEffect(() => {
    if (active) {
      prevProjectRef.current = project
      let alive = true
      buildTourDemoProject().then((demo) => { if (alive) setProjectSilent(demo) })
      return () => { alive = false }
    } else {
      setProjectSilent(prevProjectRef.current)
      prevProjectRef.current = null
      // Return to home so no page is left stranded without a project
      navigate('/')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Navigate to the step's route when it changes
  useEffect(() => {
    if (!active || !step) return
    const target = step.route ?? '/'
    if (target !== location.pathname) {
      setSettling(true)
      setSpotlight(null)
      navigate(target)
      // Give the new page 300 ms to mount before querying the DOM
      settleRef.current = setTimeout(() => setSettling(false), 300)
    } else {
      setSettling(false)
    }
    return () => {
      if (settleRef.current != null) clearTimeout(settleRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex])

  const updateSpotlight = useCallback(() => {
    if (settling || !step?.selector) {
      setSpotlight(null)
      return
    }
    const r = getSpotlightRect(step.selector)
    setSpotlight(r)
    if (r) {
      document.querySelector(step.selector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [step, settling])

  useEffect(() => {
    if (!active) return
    updateSpotlight()

    const ro = new ResizeObserver(updateSpotlight)
    ro.observe(document.body)

    const tick = (): void => {
      updateSpotlight()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      ro.disconnect()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [active, updateSpotlight])

  useEffect(() => {
    if (!active) return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft')  prev()
      if (e.key === 'Escape')     skip()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, next, prev, skip])

  if (!active || !step) return null

  const isModal  = step.position === 'center' || !spotlight
  const panelStyle = panelPosition(spotlight, step.position)
  const isFirst  = stepIndex === 0
  const isLast   = stepIndex === total - 1

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9900 }}
      onClick={isModal ? undefined : undefined}
    >
      {/* Dark overlay — two halves around the spotlight so the element is not clickable */}
      {spotlight && !isModal ? (
        <>
          {/* top strip */}
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: spotlight.top, background: 'rgba(0,0,0,0.65)' }} />
          {/* bottom strip */}
          <div style={{ position: 'fixed', top: spotlight.top + spotlight.height, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)' }} />
          {/* left strip */}
          <div style={{ position: 'fixed', top: spotlight.top, left: 0, width: spotlight.left, height: spotlight.height, background: 'rgba(0,0,0,0.65)' }} />
          {/* right strip */}
          <div style={{ position: 'fixed', top: spotlight.top, left: spotlight.left + spotlight.width, right: 0, height: spotlight.height, background: 'rgba(0,0,0,0.65)' }} />
          {/* spotlight border ring */}
          <div style={{
            position: 'fixed',
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: 6,
            boxShadow: '0 0 0 2px var(--oxblood, #8b3a2a)',
            pointerEvents: 'none',
            transition: 'top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease',
          }} />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)' }} onClick={skip} />
      )}

      {/* Tooltip panel */}
      <div
        style={{
          ...panelStyle,
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          overflow: 'hidden',
          maxHeight: '90vh',
          zIndex: 9901,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Illustration */}
        {step.illustration && (
          <div style={{ background: 'var(--paper-3)', borderBottom: '1px solid var(--line-2)', maxHeight: 180, overflow: 'hidden', flexShrink: 0 }}>
            <img
              src={step.illustration}
              alt=""
              style={{ width: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
            />
          </div>
        )}

        {/* Body */}
        <div style={{ padding: '1rem 1.1rem', flex: 1, overflowY: 'auto' }}>
          {/* Step counter */}
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--mute)', marginBottom: 6 }}>
            {t('tour.stepOf', { current: stepIndex + 1, total })}
          </div>

          <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 8, lineHeight: 1.3 }}>
            {t(`tour.steps.${step.id}.title`)}
          </h3>

          <p style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.65, margin: 0 }}>
            {t(`tour.steps.${step.id}.body`)}
          </p>

          {/* OCR demo snippet */}
          {step.demo && (
            <pre style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'var(--paper-3)',
              border: '1px solid var(--line-2)',
              borderRadius: 5,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 10.5,
              color: 'var(--ink)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
              maxHeight: 110,
              overflowY: 'auto',
            }}>
              {step.demo}
            </pre>
          )}
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, paddingBottom: 6, paddingTop: 2 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === stepIndex ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background: i === stepIndex ? 'var(--oxblood, #8b3a2a)' : i < stepIndex ? 'var(--mute)' : 'var(--line)',
                transition: 'width 0.2s ease, background 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Footer buttons */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderTop: '1px solid var(--line-2)',
          background: 'var(--paper-2)',
          gap: 8,
        }}>
          <button
            className="btn btn-ghost"
            onClick={skip}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {t('tour.skipTour')}
          </button>

          <div style={{ display: 'flex', gap: 6 }}>
            {!isFirst && (
              <button
                className="btn btn-ghost"
                onClick={prev}
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                ← {t('tour.prev')}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={next}
              style={{ fontSize: 12, padding: '4px 12px' }}
            >
              {isLast ? t('tour.finish') : `${t('tour.next')} →`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
