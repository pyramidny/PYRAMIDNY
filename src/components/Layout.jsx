import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Sidebar } from './Sidebar'

const PAGE_TITLES = {
  '/dashboard':  'Dashboard',
  '/projects':   'Projects',
  '/tasks':      'My Tasks',
  '/team':       'Team',
  '/settings':   'Settings',
}

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  const title = Object.entries(PAGE_TITLES).find(
    ([path]) => location.pathname.startsWith(path)
  )?.[1] ?? 'Pyramid Portal'

  return (
    <div className="flex h-screen bg-ink-100 overflow-hidden">

      {/* ── Desktop Sidebar ─────────────────────────── */}
      <div className="hidden lg:flex flex-shrink-0 shadow-sidebar">
        <Sidebar />
      </div>

      {/* ── Mobile Sidebar Drawer ───────────────────── */}
      {sidebarOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden animate-[slideIn_200ms_ease]">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </>
      )}

      {/* ── Main Content ────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar — mobile only */}
        <header className="flex items-center gap-3 px-4 py-3 bg-ink-950 border-b border-white/6 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 text-ink-400 hover:text-white transition-colors"
          >
            <Menu size={22} />
          </button>
          <PyramidMark />
          <span className="font-condensed font-semibold text-white text-base tracking-wide">
            {title}
          </span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-ink-50">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function PyramidMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
      <polygon points="16,2 31,30 1,30" fill="#ea580c" />
      <polygon points="16,11 26,30 6,30" fill="#0F1923" opacity="0.5" />
    </svg>
  )
}
