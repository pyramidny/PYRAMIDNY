import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import {
  Bell, Settings, Users, LogOut,
  LayoutDashboard, ClipboardList, HardHat, Anchor, ScanLine,
  LayoutGrid, Plus
} from 'lucide-react'
import { Sidebar } from './Sidebar'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { canTool } from '@/lib/permissions'

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/projects': 'Projects',
  '/tasks': 'My Tasks',
  '/tools': 'Tool Control',
  '/team': 'Team',
  '/settings': 'Settings',
  '/notifications': 'Notifications',
}

// Mobile bottom-bar tabs. Regular/Rope are the two project divisions; both
// live under /projects, so their active state is query-aware (?division=).
const TABS = [
  { to: '/dashboard',                 label: 'Dashboard', icon: LayoutDashboard, match: (p)    => p.startsWith('/dashboard') },
  { to: '/tasks',                     label: 'Tasks',     icon: ClipboardList,   match: (p)    => p.startsWith('/tasks') },
  { to: '/projects?division=regular', label: 'Regular',   icon: HardHat,         match: (p, d) => p.startsWith('/projects') && d !== 'ira' },
  { to: '/projects?division=ira',     label: 'Rope',      icon: Anchor,          match: (p, d) => p.startsWith('/projects') && d === 'ira' },
  { to: '/tools',                     label: 'Tools',     icon: ScanLine,        match: (p)    => p.startsWith('/tools') },
]

export function Layout() {
  const [menuOpen, setMenuOpen]       = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, isAdmin, signOut } = useAuth()

  const title = Object.entries(PAGE_TITLES).find(
    ([path]) => location.pathname.startsWith(path)
  )?.[1] ?? 'Pyramid Portal'

  const division = new URLSearchParams(location.search).get('division')

  // Tool Control gets its own mobile bottom bar (the "device menu" swap).
  // Desktop sidebar is intentionally left unchanged.
  const onTools = location.pathname.startsWith('/tools')
  const toolTab = new URLSearchParams(location.search).get('tab') || 'scan'
  // Enroll/edit/retire is the Tool ADMIN tier per Jorge's matrix; Tool Tech gets
  // checkout, maintenance, QR tags and reports but cannot change the catalog.
  const canManageTools = canTool(profile, 'admin')
  const TOOL_TABS = [
    { key: 'dashboard', to: '/dashboard',        label: 'Dashboard', icon: LayoutDashboard, back: true },
    { key: 'scan',      to: '/tools?tab=scan',     label: 'Scan',      icon: ScanLine },
    { key: 'tools',     to: '/tools?tab=tools',    label: 'Tools',     icon: LayoutGrid },
    { key: 'activity',  to: '/tools?tab=activity', label: 'Activity',  icon: ClipboardList },
    ...(canManageTools ? [{ key: 'enroll', to: '/tools?tab=enroll', label: 'Add', icon: Plus }] : []),
  ]

  // Close the top menu whenever we navigate.
  useEffect(() => { setMenuOpen(false) }, [location.pathname, location.search])

  // Unread notification badge. Uses profile.id (session.user is unreliable for
  // Azure AD tokens — same reason the task pages read profile.id).
  useEffect(() => {
    const uid = profile?.id
    if (!uid) return
    const fetchUnread = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', uid)
        .eq('is_read', false)
      setUnreadCount(count || 0)
    }
    fetchUnread()
    const channel = supabase
      .channel('notif-badge')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: 'recipient_id=eq.' + uid,
      }, () => fetchUnread())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-ink-100 overflow-hidden">

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex flex-shrink-0 shadow-sidebar">
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar — mobile only */}
        <header className="flex items-center gap-3 px-4 py-3 bg-ink-950 border-b border-white/6 lg:hidden">
          <PyramidMark />
          <span className="font-condensed font-semibold text-white text-base tracking-wide flex-1 truncate">
            {title}
          </span>

          {/* Notifications bell + count */}
          <button
            onClick={() => navigate('/notifications')}
            className="relative p-1.5 text-ink-400 hover:text-white transition-colors"
            aria-label="Notifications"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-pyramid-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Settings / Team menu */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="p-1.5 text-ink-400 hover:text-white transition-colors"
            aria-label="Settings and team"
          >
            <Settings size={20} />
          </button>
        </header>

        {/* Top menu dropdown (mobile) */}
        {menuOpen && (
          <div className="lg:hidden">
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="fixed right-3 top-14 z-50 w-48 bg-white rounded-xl shadow-xl border border-ink-200 overflow-hidden py-1">
              <MenuItem icon={Settings} label="Settings" onClick={() => navigate('/settings')} />
              {isAdmin && <MenuItem icon={Users} label="Team" onClick={() => navigate('/team')} />}
              <div className="my-1 border-t border-ink-100" />
              <MenuItem icon={LogOut} label="Sign out" onClick={handleSignOut} />
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-ink-50 pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* Bottom tab bar — mobile only. Tool Control swaps in its own menu. */}
        {onTools ? (
          <nav
            className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-ink-200 grid pb-[env(safe-area-inset-bottom)]"
            style={{ gridTemplateColumns: `repeat(${TOOL_TABS.length}, minmax(0, 1fr))` }}
          >
            {TOOL_TABS.map(tab => {
              const active = !tab.back && toolTab === tab.key
              return (
                <Link
                  key={tab.key}
                  to={tab.to}
                  className={`flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors
                    ${active ? 'text-ink-900' : 'text-ink-400'}`}
                >
                  <tab.icon size={22} className={active ? 'text-pyramid-500' : ''} />
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        ) : (
          <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-ink-200 grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
            {TABS.map(tab => {
              const active = tab.match(location.pathname, division)
              return (
                <Link
                  key={tab.label}
                  to={tab.to}
                  className={`flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors
                    ${active ? 'text-ink-900' : 'text-ink-400'}`}
                >
                  <tab.icon size={22} className={active ? 'text-pyramid-500' : ''} />
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        )}
      </div>
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-ink-700 hover:bg-ink-50 transition-colors"
    >
      <Icon size={16} className="text-ink-400" />
      {label}
    </button>
  )
}

function PyramidMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="16,4 30,28 2,28" fill="#C8A96E" opacity="0.9" />
    </svg>
  )
}
