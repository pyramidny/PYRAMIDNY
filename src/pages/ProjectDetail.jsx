import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useSharePoint } from '@/hooks/useSharePoint'

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-proxy`

const STATUS_COLORS = {
  active:    'bg-green-100 text-green-800',
  pending:   'bg-yellow-100 text-yellow-800',
  complete:  'bg-blue-100 text-blue-800',
  on_hold:   'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
}

function fileIcon(name = '') {
  const ext = name.split('.').pop()?.toLowerCase()
  return { pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊',
           ppt:'📋', pptx:'📋', jpg:'🖼️', jpeg:'🖼️', png:'🖼️',
           zip:'🗜️', mp4:'🎬' }[ext] ?? '📎'
}

function fmtBytes(b = 0) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

export default function ProjectDetail() {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const { session } = useAuth()
  const sp          = useSharePoint()

  const [project,    setProject]    = useState(null)
  const [milestones, setMilestones] = useState([])
  const [tasks,      setTasks]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('overview')
  const [uploading,  setUploading]  = useState(false)

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
    if (!id || !session) return
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
          .select('*, milestone_definitions(name, description, phase, sort_order)')
          .eq('project_id', id).order('created_at')
        if (mse) throw mse
        setMilestones(ms ?? [])

        const { data: tsk, error: te } = await supabase
          .from('project_tasks')
          .select('*, workflow_task_templates(title, phase, sort_order)')
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
  }, [id, session])

  async function toggleTask(task) {
    const status = task.status === 'complete' ? 'pending' : 'complete'
    const completed_at = status === 'complete' ? new Date().toISOString() : null
    try {
      await proxy({ action: 'update_task', taskId: task.id, updates: { status, completed_at } })
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status } : t))
    } catch (e) {
      console.error('Task toggle failed:', e.message)
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !project?.sharepoint_folder_id) return
    setUploading(true)
    try {
      await sp.uploadFile(project.sharepoint_folder_id, file)
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  )
  if (error)    return <div className="p-8 text-red-600 text-sm">Error: {error}</div>
  if (!project) return <div className="p-8 text-gray-500 text-sm">Project not found.</div>

  const doneTasks = tasks.filter((t) => t.status === 'complete').length
  const doneMs    = milestones.filter((m) => m.status === 'complete').length
  const tabs      = ['overview', 'milestones', 'tasks', 'documents']

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <button onClick={() => navigate('/projects')}
          className="text-sm text-gray-400 hover:text-gray-600 mb-4 flex items-center gap-1">
          ← All Projects
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {project.project_number} — {project.address}
            </h1>
            <p className="text-gray-500 mt-1">{project.client_name}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${STATUS_COLORS[project.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {project.status}
            </span>
            {project.sharepoint_folder_url && (
              <a href={project.sharepoint_folder_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                </svg>
                SharePoint
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-5 mt-3 text-sm text-gray-500">
          <span>{doneMs}/{milestones.length} milestones</span>
          <span>{doneTasks}/{tasks.length} tasks</span>
          {project.division && <span className="capitalize">{project.division}</span>}
        </div>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`py-3 text-sm font-medium capitalize border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tab}
              {tab === 'documents' && sp.files.length > 0 && (
                <span className="ml-1.5 bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                  {sp.files.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            ['Project Number',    project.project_number],
            ['Address',           project.address],
            ['Client',            project.client_name],
            ['Status',            project.status],
            ['Division',          project.division],
            ['Contract Value',    project.contract_value ? `$${Number(project.contract_value).toLocaleString()}` : null],
            ['Start Date',        project.start_date ? new Date(project.start_date).toLocaleDateString() : null],
            ['Target Completion', project.target_completion ? new Date(project.target_completion).toLocaleDateString() : null],
          ].map(([label, value]) => (
            <div key={label} className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-sm font-medium text-gray-900">{value ?? '—'}</p>
            </div>
          ))}
          {project.notes && (
            <div className="sm:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{project.notes}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'milestones' && (
        <div className="space-y-3">
          {milestones.length === 0 && <p className="text-sm text-gray-500">No milestones yet.</p>}
          {milestones.map((ms) => (
            <div key={ms.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-3">
              <div className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${
                ms.status === 'complete' ? 'bg-green-500' :
                ms.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {ms.milestone_definitions?.name ?? ms.name ?? 'Milestone'}
                </p>
                {ms.milestone_definitions?.description && (
                  <p className="text-xs text-gray-400 mt-0.5">{ms.milestone_definitions.description}</p>
                )}
                {ms.target_date && (
                  <p className="text-xs text-gray-400 mt-1">Target: {new Date(ms.target_date).toLocaleDateString()}</p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                ms.status === 'complete' ? 'bg-green-100 text-green-700' :
                ms.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
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
            <label key={task.id}
              className="flex items-start gap-3 bg-white rounded-lg border border-gray-200 p-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
              <input type="checkbox"
                checked={task.status === 'complete'}
                onChange={() => toggleTask(task)}
                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${task.status === 'complete' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                  {task.workflow_task_templates?.title ?? task.title ?? 'Task'}
                </p>
                {task.workflow_task_templates?.phase && (
                  <p className="text-xs text-gray-400 mt-0.5">{task.workflow_task_templates.phase}</p>
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      {activeTab === 'documents' && (
        <div>
          {!project.sharepoint_folder_url ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-2xl mb-2">📁</p>
              <p className="text-sm font-medium text-gray-600">No SharePoint folder linked</p>
              <p className="text-xs mt-1">Folders are created automatically on new projects.</p>
              {!sp.configured && (
                <p className="text-xs mt-2 text-amber-600">VITE_SP_SITE_ID not configured.</p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <a href={project.sharepoint_folder_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline">
                  Open in SharePoint ↗
                </a>
                <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  uploading ? 'bg-gray-200 text-gray-500 cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                  {uploading ? 'Uploading…' : '+ Upload File'}
                  <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
              </div>
              {sp.error && <p className="text-sm text-red-500 mb-3">SharePoint error: {sp.error}</p>}
              {sp.loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                </div>
              ) : sp.files.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">Folder is empty. Upload a file to get started.</p>
              ) : (
                <div className="space-y-1.5">
                  {sp.files.map((file) => (
                    <a key={file.id} href={file.webUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                      <span className="text-xl flex-shrink-0">
                        {file.isFolder ? '📁' : fileIcon(file.name)}
                      </span>
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
      )}
    </div>
  )
}
