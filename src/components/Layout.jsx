import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Bell } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

const PAGE_TITLES = {
    '/dashboard': 'Dashboard',
    '/projects': 'Projects',
    '/tasks': 'My Tasks',
    '/team': 'Team',
    '/settings': 'Settings',
    '/notifications': 'Notifications',
}

export function Layout() {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [unreadCount, setUnreadCount] = useState(0)
    const location = useLocation()
    const navigate = useNavigate()
    const { session } = useAuth()

  const title = Object.entries(PAGE_TITLES).find(
        ([path]) => location.pathname.startsWith(path)
      )?.[1] ?? 'Pyramid Portal'

  useEffect(() => {
        if (!session?.user?.id) return
        const fetchUnread = async () => {
                const { count } = await supabase
                  .from('notifications')
                  .select('*', { count: 'exact', head: true })
                  .eq('recipient_id', session.user.id)
                  .eq('is_read', false)
                setUnreadCount(count || 0)
        }
        fetchUnread()
        const channel = supabase
          .channel('notif-badge')
          .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: 'recipient_id=eq.' + session.user.id,
          }, () => fetchUnread())
          .subscribe()
        return () => { supabase.removeChannel(channel) }
  }, [session])

  return (
        <div className="flex h-screen bg-ink-100 overflow-hidden">
        
          {/* Desktop Sidebar */}
              <div className="hidden lg:flex flex-shrink-0 shadow-sidebar">
                      <Sidebar />
              </div>div>
        
          {/* Mobile Sidebar Drawer */}
          {sidebarOpen && (
                  <>
                            <div
                                          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
                                          onClick={() => setSidebarOpen(false)}
                                        />
                            <div className="fixed inset-y-0 left-0 z-50 lg:hidden animate-[slideIn_200ms_ease]">
                                        <Sidebar onClose={() => setSidebarOpen(false)} />
                            </div>div>
                  </>>
                )}
        
          {/* Main Content */}
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              
                {/* Top bar - mobile only */}
                      <header className="flex items-center gap-3 px-4 py-3 bg-ink-950 border-b border-white/6 lg:hidden">
                                <button
                                              onClick={() => setSidebarOpen(true)}
                                              className="p-1.5 text-ink-400 hover:text-white transition-colors"
                                            >
                                            <Menu size={22} />
                                </button>button>
                                <PyraMidMark />
                                <span className="font-condensed font-semibold text-white text-base tracking-wide flex-1">
                                  {title}
                                </span>span>
                                <button
                                              onClick={() => navigate('/notifications')}
                                              className="relative p-1.5 text-ink-400 hover:text-white transition-colors"
                                            >
                                            <Bell size={20} />
                                  {unreadCount > 0 && (
                                                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-pyramid-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                                                              {unreadCount > 9 ? '9+' : unreadCount}
                                                            </span>span>
                                            )}
                                </button>button>
                      </header>header>
              
                {/* Page content */}
                      <main className="flex-1 overflow-y-auto bg-ink-50">
                                <Outlet />
                      </main>main>
              </div>div>
        </div>div>
      )
}

function PyraMidMark() {
    return (
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                <polygon points="16,2 31,30 1,30" fill="#ea580c" />
                <polygon points="16,11 26,30 6,30" fill="#80f192" opacity="0.5" />
          </svg>svg>
        )
}</></div>
