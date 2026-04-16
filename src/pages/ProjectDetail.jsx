import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useSharePoint } from '@/hooks/useSharePoint'

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-proxy`
const SP_TOKEN_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  complete: 'bg-blue-100 text-blue-800',
  on_hold: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
}

function fileIcon(name = '') {
  const ext = name.split('.').pop()?.toLowerCase()
  return { pdf:'PDF', doc:'DOC', docx:'DOCX', xls:'XLS', xlsx:'XLSX', ppt:'PPT', pptx:'PPTX', jpg:'IMG', jpeg:'IMG', png:'IMG', zip:'ZIP', mp4:'VID' }[ext] ?? 'FILE'
}

function fmtBytes(b = 0) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const sp = useSharePoint()

  const [project, setProject] = useState(null)
  const [milestones, setMilestones] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [uploading, setUploading] = useState(false)
  const [staffPool, setStaffPool] = useState([])
  const [editingTeam, setEditingTeam] = useState(false)
  const [teamDraft, setTeamDraft] = useState({ pm_id: null, assistant_pm_id: null })

  // Read Azure AD token directly from localStorage — session.access_token is null
  // for Microsoft-signed JWTs that Supabase cannot verify.
  const getAccessToken = useCallback(() => {
    try {
      const raw = localStorage.getItem(SP_TOKEN_KEY)
      return raw ? JSON.parse(raw)?.access_token : null
    } catch {
      return null
    }
  }, [])

  const proxy = useCallback(async (body) => {
    const accessToken = getAccessToken()
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Proxy error ${res.status}`)
    return json.data
  }, [getAccessToken])

  useEffect(() => {
    if (!id) return
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: proj, error: pe } = await supabase
          .from('projects').select('*').eq('id', id).single()
        if (pe) throw pe
        setProject(proj)

        const { data: ms, error: mse } = await supabase
          .from('project_milestones')
          .select('*, milestone_definitions(label, key, sort_order, active_from_stage)')
          .eq('project_id', id).order('updated_at')
        if (mse) throw mse
        setMilestones(ms ?? [])

        const { data: tsk, error: te } = await supabase
          .from('project_tasks')
          .select('*')
          .eq('project_id', id).order('created_at')
        if (te) throw te
        setTasks(tsk ?? [])

        if (proj?.sharepoint_folder_id) {
          sp.loadFolder(proj.sharepoint_folder_id)
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Load seeded staff for team assignment
  useEffect(() => {
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
      .then(({ data }) => setStaffPool(data || []))
  }, [])

  const saveTeamAssignment = async () => {
    try {
      await proxy({ action: 'update_project', id, ...teamDraft })
      setProject(p => ({ ...p, ...teamDraft }))
      setEditingTeam(false)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    }
  }

  const toggleTask = async (task) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed'
    // Optimistic update
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    try {
      await proxy({ action: 'update_task', taskId: task.id, updates: { status: newStatus } })
    } catch (e) {
      // Revert on failure
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: task.status } : t))
      alert('Failed to save task: ' + e.message)
    }
  }

  const uploadFile = async (e) => {
    if (!project?.sharepoint_folder_id) return
    setUploading(true)
    try {
      const file = e.target.files[0]
      if (!file) return
      const buf = await file.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      await proxy({
        action: 'upload_file',
        folderId: project.sharepoint_folder_id,
        fileName: file.name,
        fileContent: b64,
      })
      await sp.loadFolder(project.sharepoint_folder_id)
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-ink-500">Loading project...</div>
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>
  if (!project) return <div className="p-8 text-center text-ink-400">Project not found.</div>

  const TABS = ['overview', 'milestones', 'tasks', 'files']

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/projects')}
            className="text-sm text-ink-400 hover:text-ink-700 mb-2 flex items-center gap-1"
          >
            Back to Projects
          </button>
          <h1 className="text-2xl font-bold text-ink-900">
            {project.project_address ?? 'Untitled Project'}
          </h1>
          <p className="text-ink-500 text-sm mt-1">#{project.project_number}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[project.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {project.status ?? 'unknown'}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-ink-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-pyramid-500 text-pyramid-700'
                : 'border-transparent text-ink-500 hover:text-ink-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Status</p>
            <p className="text-sm font-medium text-gray-900 capitalize">{project.status ?? '-'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Division</p>
            <p className="text-sm font-medium text-gray-900 capitalize">{project.division ?? '-'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Current Stage</p>
            <p className="text-sm font-medium text-gray-900">{project.current_stage ?? '-'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Project Number</p>
            <p className="text-sm font-medium text-gray-900">{project.project_number ?? '-'}</p>
          </div>
          {project.notes && (
            <div className="sm:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{project.notes}</p>
            </div>
          )}
          <div className="sm:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Team</p>
              {!editingTeam ? (
                <button
                  onClick={() => {
                    setTeamDraft({ pm_id: project.pm_id, assistant_pm_id: project.assistant_pm_id })
                    setEditingTeam(true)
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={saveTeamAssignment} className="text-xs text-green-600 hover:text-green-800">Save</button>
                  <button onClick={() => setEditingTeam(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                </div>
              )}
            </div>
            {!editingTeam ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400">Project Manager</p>
                  <p className="text-sm font-medium text-gray-900">{staffPool.find((s) => s.id === project.pm_id)?.full_name ?? '--'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Assistant PM</p>
                  <p className="text-sm font-medium text-gray-900">{staffPool.find((s) => s.id === project.assistant_pm_id)?.full_name ?? '--'}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Project Manager</label>
                  <select
                    value={teamDraft.pm_id || ''}
                    onChange={(e) => setTeamDraft((d) => ({ ...d, pm_id: e.target.value || null }))}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900"
                  >
                    <option value="">-- None --</option>
                    {staffPool.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Assistant PM</label>
                  <select
                    value={teamDraft.assistant_pm_id || ''}
                    onChange={(e) => setTeamDraft((d) => ({ ...d, assistant_pm_id: e.target.value || null }))}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900"
                  >
                    <option value="">-- None --</option>
                    {staffPool.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'milestones' && (
        <div className="space-y-3">
          {milestones.length === 0 && <p className="text-sm text-gray-500">No milestones yet.</p>}
          {milestones.map((ms) => (
            <div key={ms.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-3">
              <div className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${
                ms.status === 'complete' ? 'bg-green-500' : ms.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {ms.milestone_definitions?.label ?? ms.milestone_definitions?.key ?? 'Milestone'}
                </p>
                {ms.milestone_definitions?.key && (
                  <p className="text-xs text-gray-400 mt-0.5">{ms.milestone_definitions.key}</p>
                )}
                {ms.target_date && (
                  <p className="text-xs text-gray-400 mt-1">Target: {new Date(ms.target_date).toLocaleDateString()}</p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                ms.status === 'complete' ? 'bg-green-100 text-green-700'
                : ms.status === 'in_progress' ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600'}`}>
                {ms.status ?? 'pending'}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-2">
          {tasks.length === 0 && <p className="text-sm text-gray-500">No tasks yet.</p>}
          {tasks.map((task) => (
            <label key={task.id} className="flex items-start gap-3 bg-white rounded-lg border border-gray-200 p-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                checked={task.status === 'completed'}
                onChange={() => toggleTask(task)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-pyramid-500"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                  {task.task_name}
                </p>
                {task.due_date && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Due: {new Date(task.due_date).toLocaleDateString()}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {activeTab === 'files' && (
        <>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">
              {sp.files.length > 0 ? `${sp.files.length} file${sp.files.length !== 1 ? 's' : ''}` : 'No files yet'}
            </p>
            {project?.sharepoint_folder_id && (
              <label className="cursor-pointer">
                <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
                <span className="text-xs bg-pyramid-500 text-white px-3 py-1.5 rounded-lg hover:bg-pyramid-600 transition-colors">
                  {uploading ? 'Uploading...' : 'Upload File'}
                </span>
              </label>
            )}
          </div>
          {sp.loading && <p className="text-sm text-gray-400">Loading files...</p>}
          {sp.error && <p className="text-sm text-red-500">Error: {sp.error}</p>}
          {sp.files.length > 0 && (
            <div className="space-y-2">
              {sp.files.map((file) => (
                <a
                  key={file.id}
                  href={file.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded bg-pyramid-50 flex items-center justify-center text-xs font-bold text-pyramid-600 flex-shrink-0">
                    {fileIcon(file.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                    <p className="text-xs text-gray-400">
                      {file.lastModified ? new Date(file.lastModified).toLocaleDateString() : ''}
                      {file.size ? ` · ${fmtBytes(file.size)}` : ''}
                      {file.createdBy ? ` · ${file.createdBy}` : ''}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
