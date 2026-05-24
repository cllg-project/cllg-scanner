import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProject } from '../App'

interface SidebarProps {
  collapsed?: boolean
}

const NAV = [
  {
    path: '/',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12 12 4l9 8" /><path d="M5 10v10h14V10" />
      </svg>
    ),
    label: 'Home'
  },
  {
    path: '/masker',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="4" width="16" height="16" rx="1" />
        <rect x="8" y="8" width="6" height="5" fill="currentColor" opacity=".5" />
      </svg>
    ),
    label: 'Masker'
  },
  {
    path: '/ocr',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
    ),
    label: 'OCR Run'
  },
  {
    path: '/review',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    label: 'Review'
  },
  {
    path: '/export',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 4h16v16H4z" /><path d="m9 9 6 6m0-6-6 6" />
      </svg>
    ),
    label: 'TEI Export'
  }
]

export default function Sidebar({ collapsed = false }: SidebarProps): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const { project } = useProject()

  return (
    <aside
      className="sidebar shrink-0 flex flex-col"
      style={{ width: collapsed ? 56 : 240 }}
    >
      <div className={`${collapsed ? 'px-0 items-center' : 'px-4'} pt-5 pb-4 flex flex-col`}>
        <div className="font-serif italic text-[28px] leading-none" style={{ color: '#f3ecda' }}>
          {collapsed ? 'C' : 'CLLG'}
        </div>
        {!collapsed && (
          <div className="font-mono text-[10px] tracking-[.18em] uppercase mt-1" style={{ color: '#8e8472' }}>
            Codex Loci Linguæ Græcæ
          </div>
        )}
      </div>

      <nav className="px-2 flex flex-col gap-0.5">
        {NAV.map((item) => {
          const isActive = location.pathname === item.path
          const disabled = item.path !== '/' && !project
          return (
            <button
              key={item.path}
              onClick={() => !disabled && navigate(item.path)}
              className={`nav-item w-full ${isActive ? 'active' : ''} ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {!collapsed && project && (
        <>
          <div className="nav-section">Current project</div>
          <div className="px-3 pb-1">
            <div className="text-[12px] font-medium truncate" style={{ color: '#e9e3d3' }}>
              {project.name}
            </div>
            <div className="font-mono text-[10px] mt-0.5" style={{ color: '#8e8472' }}>
              {project.pages.length} pages ·{' '}
              {project.pages.filter((p) => p.status === 'ocr_done').length} done
            </div>
          </div>
        </>
      )}

      <div className="mt-auto px-3 py-3 border-t border-black/30 flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center font-serif text-[14px]"
          style={{ background: '#5a4a36', color: '#f3ecda' }}
        >
          C
        </div>
        {!collapsed && (
          <div className="text-[11.5px] leading-tight">
            <div style={{ color: '#e9e3d3' }}>Local workspace</div>
            <div className="font-mono text-[10px]" style={{ color: '#8e8472' }}>
              offline
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
