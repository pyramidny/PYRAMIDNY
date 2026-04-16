import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

const TABS = ['Profile', 'Notifications', 'System']

export default function Settings() {
    const { session } = useAuth()
    const [activeTab, setActiveTab] = useState('Profile')
    const [profile, setProfile] = useState(null)
    const [notifSettings, setNotifSettings] = useState(null)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

  useEffect(() => {
        if (!session?.user?.id) return
        supabase.from('profiles').select('*').eq('id', session.user.id).single()
          .then(({ data }) => setProfile(data))
        supabase.from('notification_settings').select('*').eq('user_id', session.user.id).single()
          .then(({ data }) => {
                    if (data) { setNotifSettings(data) } else {
                                setNotifSettings({
                                              user_id: session.user.id,
                                              in_app: true, email: true, sms: false, phone: '',
                                              notify_task_complete: true, notify_milestone_reached: true,
                                              notify_new_assignment: true, notify_new_project: true,
                                              notify_document_uploaded: false, frequency: 'immediate',
                                })
                    }
          })
  }, [session])

  const saveNotifSettings = async () => {
        if (!notifSettings) return
        setSaving(true)
        const { error } = await supabase.from('notification_settings')
          .upsert({ ...notifSettings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        setSaving(false)
        if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  const toggle = (key) => setNotifSettings((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
        <div className="max-w-3xl mx-auto px-4 py-8">
              <h1 className="font-condensed font-bold text-2xl text-ink-800 tracking-wide mb-6">Settings</h1>h1>
              <div className="flex gap-1 border-b border-white/10 mb-8">
                {TABS.map((t) => (
                    <button key={t} onClick={() => setActiveTab(t)}
                                  className={`px-5 py-2 text-sm font-medium rounded-t transition-colors ${activeTab === t ? 'bg-pyramid-500 text-white' : 'text-ink-400 hover:text-ink-200'}`}>
                      {t}
                    </button>button>
                  ))}
              </div>div>
        
          {activeTab === 'Profile' && profile && (
                  <div className="space-y-4">
                            <Field label="Full Name" value={profile.full_name} />
                            <Field label="Display Name" value={profile.display_name || '--'} />
                            <Field label="Email" value={profile.email} />
                            <Field label="Role" value={profile.role} />
                            <Field label="Division" value={profile.division || '--'} />
                            <Field label="Phone" value={profile.phone || '--'} />
                            <p className="text-ink-500 text-xs mt-4">To update your profile, contact your system administrator.</p>p>
                  </div>div>
              )}
        
          {activeTab === 'Notifications' && notifSettings && (
                  <div className="space-y-8">
                            <section>
                                        <h2 className="text-sm font-semibold text-ink-400 uppercase tracking-widest mb-3">Channels</h2>h2>
                                        <div className="space-y-3">
                                                      <CheckRow label="In-App notifications" checked={notifSettings.in_app} onChange={() => toggle('in_app')} />
                                                      <CheckRow label="Email notifications" checked={notifSettings.email} onChange={() => toggle('email')} />
                                                      <div>
                                                                      <CheckRow label="SMS notifications" checked={notifSettings.sms} onChange={() => toggle('sms')} />
                                                        {notifSettings.sms && (
                                      <input type="tel" placeholder="Mobile phone number" value={notifSettings.phone || ''}
                                                            onChange={(e) => setNotifSettings((p) => ({ ...p, phone: e.target.value }))}
                                                            className="mt-2 ml-7 w-64 bg-ink-900 border border-white/10 rounded px-3 py-1.5 text-sm text-ink-100 placeholder-ink-600 focus:outline-none focus:border-pyramid-500" />
                                    )}
                                                      </div>div>
                                        </div>div>
                            </section>section>
                            <section>
                                        <h2 className="text-sm font-semibold text-ink-400 uppercase tracking-widest mb-3">Notify me when</h2>h2>
                                        <div className="space-y-3">
                                                      <CheckRow label="A task is completed" checked={notifSettings.notify_task_complete} onChange={() => toggle('notify_task_complete')} />
                                                      <CheckRow label="A milestone is reached" checked={notifSettings.notify_milestone_reached} onChange={() => toggle('notify_milestone_reached')} />
                                                      <CheckRow label="I am assigned to a project or task" checked={notifSettings.notify_new_assignment} onChange={() => toggle('notify_new_assignment')} />
                                                      <CheckRow label="A new project is created" checked={notifSettings.notify_new_project} onChange={() => toggle('notify_new_project')} />
                                                      <CheckRow label="A document is uploaded" checked={notifSettings.notify_document_uploaded} onChange={() => toggle('notify_document_uploaded')} />
                                        </div>div>
                            </section>section>
                            <section>
                                        <h2 className="text-sm font-semibold text-ink-400 uppercase tracking-widest mb-3">Frequency</h2>h2>
                                        <div className="flex gap-4">
                                          {['immediate', 'daily', 'weekly'].map((f) => (
                                    <label key={f} className="flex items-center gap-2 cursor-pointer">
                                                      <input type="radio" name="frequency" value={f} checked={notifSettings.frequency === f}
                                                                            onChange={() => setNotifSettings((p) => ({ ...p, frequency: f }))} className="accent-pyramid-500" />
                                                      <span className="text-sm text-ink-200">{f === 'immediate' ? 'Immediate' : f === 'daily' ? 'Daily Digest' : 'Weekly Digest'}</span>span>
                                    </label>label>
                                  ))}
                                        </div>div>
                            </section>section>
                            <button onClick={saveNotifSettings} disabled={saving}
                                          className="px-6 py-2 bg-pyramid-500 hover:bg-pyramid-600 text-white text-sm font-medium rounded transition-colors disabled:opacity-50">
                              {saving ? 'Saving...' : saved ? 'Saved' : 'Save Preferences'}
                            </button>button>
                  </div>div>
              )}
        
          {activeTab === 'System' && (
                  <div className="space-y-4 text-ink-400 text-sm">
                            <p>Organization and system configuration options will appear here.</p>p>
                            <div className="mt-6 p-4 rounded-lg border border-white/10 bg-ink-900 text-xs text-ink-500">Under Construction</div>div>
                  </div>div>
              )}
        </div>div>
      )
}

function Field({ label, value }) {
    return (
          <div className="flex flex-col gap-1">
                <span className="text-xs text-ink-500 uppercase tracking-widest">{label}</span>span>
                <span className="text-ink-100 text-sm">{value}</span>span>
          </div>div>
        )
}

function CheckRow({ label, checked, onChange }) {
    return (
          <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 rounded accent-pyramid-500" />
                <span className="text-sm text-ink-200">{label}</span>span>
          </label>label>
        )
}</div>
