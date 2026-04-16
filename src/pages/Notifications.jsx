import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Bell, CheckCheck, X } from 'lucide-react'

const TYPE_COLOR = {
    task: 'bg-green-500',
    milestone: 'bg-blue-500',
    assignment: 'bg-purple-500',
    document: 'bg-yellow-500',
    info: 'bg-gray-500',
}

export default function Notifications() {
    const { session } = useAuth()
    const navigate = useNavigate()
    const [notifications, setNotifications] = useState([])
    const [loading, setLoading] = useState(true)

  const fetchNotifications = async () => {
        if (!session?.user?.id) return
        setLoading(true)
        const { data } = await supabase
          .from('notifications')
          .select('*')
          .eq('recipient_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(50)
        setNotifications(data || [])
        setLoading(false)
  }

  useEffect(() => { fetchNotifications() }, [session])

  const markRead = async (id) => {
        await supabase.from('notifications').update({ is_read: true }).eq('id', id)
        setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n))
  }

  const markAllRead = async () => {
        if (!session?.user?.id) return
        await supabase.from('notifications').update({ is_read: true })
          .eq('recipient_id', session.user.id).eq('is_read', false)
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  const dismiss = async (id) => {
        await supabase.from('notifications').delete().eq('id', id)
        setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const timeAgo = (ts) => {
        const diff = Date.now() - new Date(ts).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 1) return 'just now'
        if (mins < 60) return mins + 'm ago'
        const hrs = Math.floor(mins / 60)
        if (hrs < 24) return hrs + 'h ago'
        return Math.floor(hrs / 24) + 'd ago'
  }

  return (
        <div className="max-w-2xl mx-auto px-4 py-8">
              <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                                <Bell size={20} className="text-pyramid-500" />
                                <h1 className="font-condensed font-bold text-2xl text-ink-800 tracking-wide">Notifications</h1>h1>
                        {unreadCount > 0 && (
                      <span className="px-2 py-0.5 bg-pyramid-500 text-white text-xs font-bold rounded-full">{unreadCount}</span>span>
                                )}
                      </div>div>
                {unreadCount > 0 && (
                    <button onClick={markAllRead}
                                  className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200 transition-colors">
                                <CheckCheck size={14} /> Mark all read
                    </button>button>
                      )}
              </div>div>
        
          {loading && (
                  <div className="text-ink-500 text-sm py-12 text-center">Loading...</div>div>
              )}
        
          {!loading && notifications.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-ink-500">
                            <Bell size={40} className="mb-4 opacity-20" />
                            <p className="text-sm">You are all caught up</p>p>
                  </div>div>
              )}
        
          {!loading && notifications.length > 0 && (
                  <div className="space-y-2">
                    {notifications.map((n) => (
                                <div key={n.id}
                                                className={'flex items-start gap-3 p-4 rounded-lg border transition-colors cursor-pointer ' +
                                                                  (n.is_read ? 'bg-ink-900 border-white/5 opacity-60' : 'bg-ink-800 border-white/10 hover:border-pyramid-500/30')}
                                                onClick={() => { markRead(n.id); if (n.project_id) navigate('/projects/' + n.project_id) }}>
                                              <span className={'w-2 h-2 rounded-full mt-2 flex-shrink-0 ' + (TYPE_COLOR[n.type] || 'bg-gray-500')} />
                                              <div className="flex-1 min-w-0">
                                                              <p className={'text-sm font-medium ' + (n.is_read ? 'text-ink-400' : 'text-ink-100')}>{n.title}</p>p>
                                                {n.body && <p className="text-xs text-ink-500 mt-0.5 truncate">{n.body}</p>p>}
                                                              <p className="text-xs text-ink-600 mt-1">{timeAgo(n.created_at)}</p>p>
                                              </div>div>
                                              <div className="flex items-center gap-2 flex-shrink-0">
                                                {!n.is_read && <span className="w-2 h-2 rounded-full bg-pyramid-500" />}
                                                              <button onClick={(e) => { e.stopPropagation(); dismiss(n.id) }}
                                                                                  className="text-ink-600 hover:text-ink-300 transition-colors p-1">
                                                                                <X size={14} />
                                                              </button>button>
                                              </div>div>
                                </div>div>
                              ))}
                  </div>div>
              )}
        </div>div>
      )
}</div>
