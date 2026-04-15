// src/pages/TeamManagement.jsx
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const PROXY_URL = `${SUPABASE_URL}/functions/v1/project-proxy`

const ROLE_STYLES = {
  owner: 'bg-yellow-600 text-yellow-100',
  admin: 'bg-blue-700 text-blue-100',
  pm: 'bg-green-700 text-green-100',
  staff: 'bg-gray-700 text-gray-300',
}

function StaffCard({ profile }) {
  const initials = (profile.full_name ?? profile.email ?? '?')
    .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-sm truncate">{profile.full_name ?? '—'}</p>
        <p className="text-gray-400 text-xs truncate">{profile.email}</p>
        {profile.title && (
          <p className="text-gray-500 text-xs truncate">{profile.title}</p>
        )}
      </div>
      <span className={[
        'px-2 py-0.5 rounded-full text-xs font-semibold capitalize flex-shrink-0',
        ROLE_STYLES[profile.role] ?? ROLE_STYLES.staff,
      ].join(' ')}>{profile.role}</span>
    </div>
  )
}

function AssignModal({ project, profiles, onClose, onSave, saving }) {
  const [pmId, setPmId] = useState(project.pm_id ?? '')
  const [apmId, setApmId] = useState(project.assistant_pm_id ?? '')
  const dirty =
    pmId !== (project.pm_id ?? '') || apmId !== (project.assistant_pm_id ?? '')
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-white mb-1">Assign Team</h2>
        <p className="text-gray-400 text-sm mb-5 truncate">{project.project_address}</p>
        {[
          { label: 'Project Manager', value: pmId, onChange: setPmId },
          { label: 'Assistant PM', value: apmId, onChange: setApmId },
        ].map(({ label, value, onChange }) => (
          <label key={label} className="block mb-4">
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
              {label}
            </span>
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="mt-1 w-full bg-gray-700 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Unassigned —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
              ))}
            </select>
          </label>
        ))}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm transition-all"
          >Cancel</button>
          <button
            disabled={!dirty || saving}
            onClick={() => onSave(project.id, pmId || null, apmId || null)}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function ProjectRow({ project, profiles, onAssign }) {
  const find = (id) => profiles.find((p) => p.id === id)
  const pm = find(project.pm_id)
  const apm = find(project.assistant_pm_id)
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{project.project_address}</p>
        <p className="text-gray-400 text-xs mt-0.5">
          PM: {pm?.full_name ?? 'Unassigned'} · Asst: {apm?.full_name ?? 'Unassigned'}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={[
          'px-2 py-0.5 rounded-full text-xs font-semibold uppercase',
          project.division === 'ira'
            ? 'bg-purple-700 text-purple-200'
            : 'bg-blue-700 text-blue-200',
        ].join(' ')}>{project.division}</span>
        <button
          onClick={() => onAssign(project)}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg transition-all"
        >Assign</button>
      </div>
    </div>
  )
}

export default function TeamManagement() {
  const { session } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('roster')
  const [selectedProject, setSelectedProject] = useState(null)
  const [toast, setToast] = useState(null)
  const [search, setSearch] = useState('')

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const proxy = useCallback(async (body) => {
    if (!session?.access_token) throw new Error('No session')
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Proxy error ${res.status}`)
    return json.data
  }, [session])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: profs }, { data: projs }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, display_name, email, role, title, is_active')
          .eq('is_active', true)
          .order('full_name'),
        supabase
          .from('projects')
          .select('id, project_address, division, status, pm_id, assistant_pm_id, current_stage')
          .order('project_address'),
      ])
      setProfiles(profs ?? [])
      setProjects(projs ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function handleSaveAssignment(projectId, pmId, apmId) {
    setSaving(true)
    try {
      await proxy({
        action: 'update',
        projectId,
        updates: { pm_id: pmId, assistant_pm_id: apmId },
      })
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, pm_id: pmId, assistant_pm_id: apmId } : p
        )
      )
      setSelectedProject(null)
      showToast('Assignment saved')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const q = search.toLowerCase()
  const filteredProfiles = profiles.filter(
    (p) =>
      !q ||
      (p.full_name ?? '').toLowerCase().includes(q) ||
      (p.email ?? '').toLowerCase().includes(q)
  )
  const filteredProjects = projects.filter(
    (p) => !q || (p.project_address ?? '').toLowerCase().includes(q)
  )

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      {toast && (
        <div className={[
          'fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg',
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white',
        ].join(' ')}>{toast.msg}</div>
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Team</h1>
        <p className="text-gray-400 text-sm mt-1">Staff roster and project assignments</p>
      </div>
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div className="flex gap-1 bg-gray-800 rounded-xl p-1">
          {[
            { key: 'roster', label: 'Staff Roster' },
            { key: 'assign', label: 'Project Assignments' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSearch('') }}
              className={[
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
                tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white',
              ].join(' ')}
            >{t.label}</button>
          ))}
        </div>
        <input
          type="text"
          placeholder={tab === 'roster' ? 'Search staff…' : 'Search projects…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-800 text-gray-200 text-sm rounded-xl px-4 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === 'roster' ? (
        <div>
          <p className="text-xs text-gray-500 mb-3">{filteredProfiles.length} active staff</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredProfiles.map((p) => <StaffCard key={p.id} profile={p} />)}
            {filteredProfiles.length === 0 && (
              <p className="text-gray-500 text-sm col-span-2 py-8 text-center">No staff found</p>
            )}
          </div>
          <div className="mt-6 p-4 bg-gray-800 rounded-xl border border-dashed border-gray-600">
            <p className="text-sm text-gray-400">
              <span className="text-yellow-400 font-semibold">16 staff pending</span> — awaiting
              Jorge's approval on role doc before bulk-loading into{' '}
              <code className="text-xs bg-gray-700 px-1 rounded">staff_whitelist</code>.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-xs text-gray-500 mb-3">{filteredProjects.length} projects</p>
          <div className="flex flex-col gap-3">
            {filteredProjects.map((p) => (
              <ProjectRow key={p.id} project={p} profiles={profiles} onAssign={setSelectedProject} />
            ))}
            {filteredProjects.length === 0 && (
              <p className="text-gray-500 text-sm py-8 text-center">No projects found</p>
            )}
          </div>
        </div>
      )}
      {selectedProject && (
        <AssignModal
          project={selectedProject}
          profiles={profiles}
          onClose={() => setSelectedProject(null)}
          onSave={handleSaveAssignment}
          saving={saving}
        />
      )}
    </div>
  )
}
