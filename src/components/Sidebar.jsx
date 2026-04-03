import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, ClipboardList,
  Users, Settings, LogOut, ChevronRight,
  HardHat, Anchor, Bell
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

const DIVISION_LABELS = {
  regular: { label: 'Regular',     color: 'text-regular', dot: 'bg-regular' },
  ira:     { label: 'IRA / Rope',  color: 'text-ira',     dot: 'bg-ira'     },
  null:    { label: 'All Divisions', color: 'text-ink-400', dot: 'bg-ink-500' },
}

const NAV_SECTIONS = [
  {
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/tasks',     icon: ClipboardList,   label: 'My Tasks' },
    ],
  },
  {
    heading: 'Projects',
    items: [
      {
        to:    '/projects?division=regular',
        icon:  HardHat,
        label: 'Regular',
        badge: 'P-',
        badgeClass: 'bg-regular/15 text-regular border-regular/25',
      },
      {
        to:    '/projects?division=ira',
        icon:  Anchor,
        label: 'IRA / Rope Access',
        badge: 'A-',
        badgeClass: 'bg-ira/15 text-ira border-ira/25',
      },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { to: '/team',     icon: Users,    label: 'Team',     elevated: true },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

export function Sidebar({ onClose }) {
  const { profile, signOut, isElevated } = useAuth()
  const navigate = useNavigate()

  const divInfo = DIVISION_LABELS[profile?.division] ?? DIVISION_LABELS[null]

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside className="flex flex-col h-full bg-ink-950 w-64">

      {/* ── Logo ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/6">
        <PyramidMark />
        <div>
          <div className="font-condensed font-700 text-white text-lg leading-tight tracking-wide">
            PYRAMID
          </div>
          <div className="text-ink-500 text-xs tracking-wider">
            RESTORATION SPECIALISTS
          </div>
        </div>
      </div>

      {/* ── Nav ──────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAV_SECTIONS.map((section, si) => {
          const visibleItems = section.items.filter(
            item => !item.elevated || isElevated
          )
          if (!visibleItems.length) return null

          return (
            <div key={si}>
              {section.heading && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-widest uppercase text-ink-600">
                  {section.heading}
                </div>
              )}
              <ul className="space-y-0.5">
                {visibleItems.map(item => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `nav-item ${isActive ? 'nav-item-active' : ''}`
                      }
                    >
                      <item.icon
                        size={17}
                        className="nav-icon flex-shrink-0 transition-colors"
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${item.badgeClass}`}>
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* ── User Footer ──────────────────────────────── */}
      <div className="border-t border-white/6 p-3">
        {/* Notifications stub */}
        <button className="nav-item w-full mb-1">
          <Bell size={17} className="flex-shrink-0" />
          <span className="flex-1">Notifications</span>
          <span className="bg-pyramid-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            0
          </span>
        </button>

        {/* User info */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white/3 mt-1">
          <Avatar name={profile?.full_name} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink-100 truncate">
              {profile?.display_name ?? profile?.full_name ?? 'Loading…'}
            </div>
            <div className={`flex items-center gap-1 text-xs ${divInfo.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${divInfo.dot}`} />
              {divInfo.label}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="p-1.5 text-ink-600 hover:text-ink-300 transition-colors rounded"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function Avatar({ name }) {
  const initials = name
    ? name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'
  return (
    <div className="w-8 h-8 rounded-lg bg-pyramid-700 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-pyramid-100 font-condensed tracking-wide">
        {initials}
      </span>
    </div>
  )
}

function PyramidMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="flex-shrink-0">
      <polygon points="16,2 31,30 1,30" fill="#ea580c" />
      <polygon points="16,11 26,30 6,30" fill="#0F1923" opacity="0.5" />
    </svg>
  )
}
