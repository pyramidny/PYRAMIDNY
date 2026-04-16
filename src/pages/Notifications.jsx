import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

const TYPE_COLORS = {
  task_complete: 'bg-green-500',
  milestone: 'bg-blue-500',
  assignment: 'bg-yellow-500',
  document: 'bg-purple-500',
  project: 'bg-orange-500',
}

export default function Notifications() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!session?.user?.id) return
    fetchNotifications()
    const channel = supabase
      .channel('notifications-page')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: 'recipient_id=eq.' + session.user.id,
      }, fetchNotifications)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session])

  const fetchNotifications = async () => {
    setLoading(true)
    const query = supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (filter === 'unread') query.eq('is_read', false)
    if (filter === 'read') query.eq('is_read', true)
    const { data } = await query
    setNotifications(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchNotifications() }, [filter])

  const markRead = async (id) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  const markAllRead = async () => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', session.user.id)
      .eq('is_read', false)
    setNotifications(ns => ns.map(n => ({ ...n, is_read: true })))
  }

  const dismiss = async (id) => {
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications(ns => ns.filter(n => n.id !== id))
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink-900">Notifications</h1>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 bg-pyramid-500 text-white text-xs font-bold rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-pyramid-600 hover:text-pyramid-800 font-medium"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4 bg-ink-100 rounded-lg p-1">
        {['all', 'unread', 'read'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={"flex-1 py-1.5 px-3 rounded-md text-sm font-medium capitalize transition-colors " +
              (filter === f ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-ink-500 text-sm py-12 text-center">Loading...</div>
      ) : notifications.length === 0 ? (
        <div className="text-ink-400 text-sm py-12 text-center">
          {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              className={"bg-white rounded-xl border p-4 flex items-start gap-3 " +
                (n.is_read ? "border-ink-200" : "border-pyramid-200 bg-pyramid-50/30")}
            >
              <div className={"w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 " +
                (TYPE_COLORS[n.type] || 'bg-ink-400')} />
              <div className="flex-1 min-w-0">
                <p className={"text-sm " + (n.is_read ? "text-ink-600" : "text-ink-900 font-medium")}>
                  {n.message}
                </p>
                <p className="text-xs text-ink-400 mt-1">
                  {new Date(n.created_at).toLocaleString()}
                </p>
                {n.project_id && (
                  <button
                    onClick={() => navigate('/projects/' + n.project_id)}
                    className="text-xs text-pyramid-600 hover:underline mt-1"
                  >
                    View project
                  </button>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {!n.is_read && (
                  <button
                    onClick={() => markRead(n.id)}
                    className="text-xs text-ink-400 hover:text-ink-600"
                    title="Mark as read"
                  >
                    Mark read
                  </button>
                )}
                <button
                  onClick={() => dismiss(n.id)}
                  className="text-xs text-ink-400 hover:text-red-500"
                  title="Dismiss"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
