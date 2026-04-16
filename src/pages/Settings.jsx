import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

const TABS = ['Profile', 'Notifications', 'System']

const EVENT_TYPES = [
  { key: 'notify_task_complete', label: 'Task Completed' },
  { key: 'notify_milestone_reached', label: 'Milestone Reached' },
  { key: 'notify_new_assignment', label: 'New Assignment' },
  { key: 'notify_new_project', label: 'New Project' },
  { key: 'notify_document_uploaded', label: 'Document Uploaded' },
]

const FREQUENCIES = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'daily', label: 'Daily Digest' },
  { value: 'weekly', label: 'Weekly Digest' },
]

export default function Settings() {
  const { session } = useAuth()
  const [activeTab, setActiveTab] = useState('Profile')
  const [profile, setProfile] = useState(null)
  const [prefs, setPrefs] = useState({
    in_app: true,
    email: true,
    sms: false,
    phone: '',
    notify_task_complete: true,
    notify_milestone_reached: true,
    notify_new_assignment: true,
    notify_new_project: true,
    notify_document_uploaded: false,
    frequency: 'immediate',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!session?.user?.id) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => { if (data) setProfile(data) })

    supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setPrefs(p => ({ ...p, ...data })) })
  }, [session])

  const savePrefs = async () => {
    setSaving(true)
    await supabase
      .from('notification_settings')
      .upsert({ user_id: session.user.id, ...prefs }, { onConflict: 'user_id' })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggle = (key) => setPrefs(p => ({ ...p, [key]: !p[key] }))

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-ink-900 mb-6">Settings</h1>

      <div className="flex gap-1 mb-6 bg-ink-100 rounded-lg p-1">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={"flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors " +
              (activeTab === tab
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-700")}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Profile' && (
        <section className="bg-white rounded-xl border border-ink-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-ink-900">Profile Information</h2>
          {profile ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">Full Name</p>
                <p className="text-ink-900 font-medium">{profile.full_name || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">Email</p>
                <p className="text-ink-900">{profile.email || session?.user?.email || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">Title</p>
                <p className="text-ink-900">{profile.title || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">Division</p>
                <p className="text-ink-900 capitalize">{profile.division || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">Role</p>
                <p className="text-ink-900 capitalize">{profile.role || '-'}</p>
              </div>
              <p className="text-ink-500 text-xs mt-4">To update your profile, contact your system administrator.</p>
            </div>
          ) : (
            <p className="text-ink-500 text-sm">Loading profile...</p>
          )}
        </section>
      )}

      {activeTab === 'Notifications' && (
        <section className="space-y-4">
          <div className="bg-white rounded-xl border border-ink-200 p-6">
            <h2 className="text-lg font-semibold text-ink-900 mb-4">Notification Channels</h2>
            <div className="space-y-3">
              {[
                { key: 'in_app', label: 'In-App Notifications' },
                { key: 'email', label: 'Email Notifications' },
                { key: 'sms', label: 'SMS Notifications' },
              ].map(ch => (
                <div key={ch.key}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs[ch.key]}
                      onChange={() => toggle(ch.key)}
                      className="w-4 h-4 rounded border-ink-300 text-pyramid-500"
                    />
                    <span className="text-ink-900 font-medium">{ch.label}</span>
                  </label>
                  {ch.key === 'sms' && prefs.sms && (
                    <div className="mt-2 ml-7">
                      <input
                        type="tel"
                        value={prefs.phone}
                        onChange={e => setPrefs(p => ({ ...p, phone: e.target.value }))}
                        placeholder="+1 (555) 000-0000"
                        className="w-full border border-ink-300 rounded-lg px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-pyramid-300"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-ink-200 p-6">
            <h2 className="text-lg font-semibold text-ink-900 mb-4">Notification Events</h2>
            <div className="space-y-3">
              {EVENT_TYPES.map(ev => (
                <label key={ev.key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs[ev.key]}
                    onChange={() => toggle(ev.key)}
                    className="w-4 h-4 rounded border-ink-300 text-pyramid-500"
                  />
                  <span className="text-ink-900">{ev.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-ink-200 p-6">
            <h2 className="text-lg font-semibold text-ink-900 mb-4">Frequency</h2>
            <div className="space-y-2">
              {FREQUENCIES.map(f => (
                <label key={f.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="frequency"
                    value={f.value}
                    checked={prefs.frequency === f.value}
                    onChange={() => setPrefs(p => ({ ...p, frequency: f.value }))}
                    className="w-4 h-4 border-ink-300 text-pyramid-500"
                  />
                  <span className="text-ink-900">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={savePrefs}
            disabled={saving}
            className="w-full py-3 px-6 bg-pyramid-500 text-white font-semibold rounded-xl hover:bg-pyramid-600 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Preferences'}
          </button>
        </section>
      )}

      {activeTab === 'System' && (
        <section className="bg-white rounded-xl border border-ink-200 p-6">
          <h2 className="text-lg font-semibold text-ink-900 mb-2">System Settings</h2>
          <p className="text-ink-500 text-sm">System configuration options will appear here in a future update.</p>
        </section>
      )}
    </div>
  )
}
