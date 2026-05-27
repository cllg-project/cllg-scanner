import React, { useState } from 'react'
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
    path: '/config',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    label: 'Structure'
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
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </svg>
    ),
    label: 'TEI Export'
  }
]

const CREDITS: { name: string; author: string; license: string }[] = [
  { name: 'Electron',       author: 'OpenJS Foundation',  license: 'MIT' },
  { name: 'React',          author: 'Meta Platforms',     license: 'MIT' },
  { name: 'PDF.js',         author: 'Mozilla Foundation', license: 'Apache 2.0' },
  { name: 'Konva',          author: 'Anton Lavrenov',     license: 'MIT' },
  { name: '@xmldom/xmldom', author: 'xmldom contributors', license: 'MIT' },
  { name: 'yaml',           author: 'Eemeli Aro',         license: 'ISC' },
  { name: 'react-router',   author: 'Remix Software',     license: 'MIT' },
  { name: 'Tailwind CSS',   author: 'Tailwind Labs',      license: 'MIT' },
  { name: 'electron-vite',  author: 'Alex Wei',           license: 'MIT' },
]

function AboutModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-2xl max-w-lg w-full mx-4 p-7 overflow-y-auto"
        style={{ background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="font-serif text-[22px] leading-tight">CLLG Desktop</h2>
            <div className="font-mono text-[10px] tracking-[.14em] uppercase mt-0.5" style={{ color: 'var(--mute)' }}>
              Apache License 2.0
            </div>
          </div>
          <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
            <a
              href="https://github.com/cllg-project/cllg-scanner"
              target="_blank"
              rel="noreferrer"
              title="GitHub repository"
              className="tool-btn flex items-center justify-center"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </a>
            <button className="tool-btn" onClick={onClose} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="text-[12.5px] leading-relaxed space-y-5" style={{ color: 'var(--ink)' }}>

          <div>
            <div className="font-mono text-[10px] tracking-[.14em] uppercase mb-2" style={{ color: 'var(--mute)' }}>
              Acknowledgments
            </div>
            <p>
              The project <em>« Corpus Liberatum Linguae Graecae »</em> was supported by the French
              National Research Agency (ANR) under the France 2030 grant reference number{' '}
              <span className="font-mono">« ANR-24-RRII-0002 »</span> operated by the Inria Quadrant
              Program.
            </p>
          </div>

          <div className="space-y-1 pt-1" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="font-mono text-[10px] tracking-[.14em] uppercase mb-2" style={{ color: 'var(--mute)' }}>
              Team
            </div>
            <div className="mb-2" style={{ color: 'var(--mute)', fontSize: 12 }}>
              Built at the public French research institute{' '}
              <strong style={{ color: 'var(--ink)' }}>Inria</strong> in the{' '}
              <strong style={{ color: 'var(--ink)' }}>ALMAnaCH</strong> team.
            </div>
            <div>
              <span className="text-[11px] font-medium" style={{ color: 'var(--mute)' }}>Project Leader</span>
              <span className="ml-2">Thibault Clérice</span>
            </div>
            <div>
              <span className="text-[11px] font-medium" style={{ color: 'var(--mute)' }}>Members</span>
              <span className="ml-2">Nicolas Angleraud, Antonia Karamolegkou, Benoît Sagot</span>
            </div>
          </div>

          <div className="pt-1" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="font-mono text-[10px] tracking-[.14em] uppercase mb-2" style={{ color: 'var(--mute)' }}>
              Open-source dependencies
            </div>
            <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--mute)' }}>
                  <th className="text-left font-mono font-normal pb-1.5 pr-4">Library</th>
                  <th className="text-left font-mono font-normal pb-1.5 pr-4">Author</th>
                  <th className="text-left font-mono font-normal pb-1.5">License</th>
                </tr>
              </thead>
              <tbody>
                {CREDITS.map(c => (
                  <tr key={c.name} style={{ borderTop: '1px solid var(--line-2)' }}>
                    <td className="py-1 pr-4 font-mono">{c.name}</td>
                    <td className="py-1 pr-4">{c.author}</td>
                    <td className="py-1 font-mono text-[10.5px]" style={{ color: 'var(--mute)' }}>{c.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  )
}

export default function Sidebar({ collapsed = false }: SidebarProps): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const { project } = useProject()
  const [showAbout, setShowAbout] = useState(false)

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
            Corpus Liberatum Linguæ Græcæ
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
          <div className="text-[11.5px] leading-tight flex-1 min-w-0">
            <div style={{ color: '#e9e3d3' }}>Local workspace</div>
            <div className="font-mono text-[10px]" style={{ color: '#8e8472' }}>
              offline
            </div>
          </div>
        )}
        <button
          onClick={() => setShowAbout(true)}
          title="About / Acknowledgments"
          className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: '#e9e3d9' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </aside>
  )
}
