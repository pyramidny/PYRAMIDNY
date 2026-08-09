import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useCanDo, useIsAdmin } from '@/lib/permissions'

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-proxy`
const SP_TOKEN_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  complete: 'bg-blue-100 text-blue-800',
  on_hold: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
}

// milestone_value enum in DB: Yes | No | Missing | N/A
const MILESTONE_VALUES = ['Yes', 'No', 'Missing', 'N/A']

const MILESTONE_VALUE_STYLE = {
  'Yes':     { dot: 'bg-green-500', pill: 'bg-green-100 text-green-700' },
  'No':      { dot: 'bg-red-500',   pill: 'bg-red-100 text-red-700' },
  'Missing': { dot: 'bg-amber-400', pill: 'bg-amber-100 text-amber-700' },
  'N/A':     { dot: 'bg-gray-300',  pill: 'bg-gray-100 text-gray-600' },
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

// Normalize milestone date (stored as DATE in PG) for <input type="date">
function toDateInput(d) {
  if (!d) return ''
  // Already ISO date (YYYY-MM-DD) or full ISO timestamp — trim to first 10 chars
  return String(d).slice(0, 10)
}

function sortMilestones(list) {
  return [...list].sort((a, b) => {
    const sa = a.milestone_definitions?.sort_order ?? 999
    const sb = b.milestone_definitions?.sort_order ?? 999
    return sa - sb
  })
}

// Document categories — match the SharePoint subfolder tree
// (1. Estimating Phase + 2. Production). Values are the SP path used on upload.
const DOCUMENT_CATEGORIES = [
  { value: '1. Estimating Phase/Bid Invite & Emails',              label: 'Bid Invite & Emails' },
  { value: '1. Estimating Phase/Bid Submission & Pricing Template', label: 'Bid Submission & Pricing' },
  { value: '1. Estimating Phase/Drawings',                         label: 'Drawings (Estimating)' },
  { value: '1. Estimating Phase/Interview Package',                label: 'Interview Package' },
  { value: '1. Estimating Phase/Specifications & Notice to Bidders', label: 'Specs & Notice to Bidders' },
  { value: '1. Estimating Phase/Vendor Quotes',                    label: 'Vendor Quotes' },
  { value: '1. Estimating Phase/Walkthrough Photos & Notes',       label: 'Walkthrough Photos & Notes' },
  { value: '2. Production/CCI or Tax Exempt',                      label: 'CCI or Tax Exempt' },
  { value: '2. Production/Change Orders & Proposal',               label: 'Change Orders & Proposal' },
  { value: '2. Production/Close Outs',                             label: 'Close Outs' },
  { value: '2. Production/Contract & Riders',                      label: 'Contract & Riders' },
  { value: '2. Production/Drawings',                               label: 'Drawings (Production)' },
  { value: '2. Production/Equipment & Material Orders',            label: 'Equipment & Material Orders' },
  { value: '2. Production/Field Reports & Meeting Minutes',        label: 'Field Reports & Minutes' },
  { value: '2. Production/Incident Reports',                       label: 'Incident Reports' },
  { value: '2. Production/Informational Packet',                   label: 'Informational Packet' },
  { value: '2. Production/Insurance & Indemnity',                  label: 'Insurance & Indemnity' },
  { value: '2. Production/Job Cost',                               label: 'Job Cost' },
  { value: '2. Production/Job Site Binder',                        label: 'Job Site Binder' },
  { value: '2. Production/Pay Reqs',                               label: 'Pay Reqs' },
  { value: '2. Production/Permits',                                label: 'Permits' },
  { value: '2. Production/Subcontractors',                         label: 'Subcontractors' },
  { value: '2. Production/Submittals',                             label: 'Submittals' },
  { value: '2. Production/Timelines & Schedules',                  label: 'Timelines & Schedules' },
  { value: '2. Production/Transfer Package',                       label: 'Transfer Package' },
  { value: '2. Production/Vendor & Invoices',                      label: 'Vendor & Invoices' },
]

const PHOTO_CATEGORIES = [
  { value: '3. Photos/Before',         label: 'Before' },
  { value: '3. Photos/Progress',       label: 'Progress' },
  { value: '3. Photos/After',          label: 'After' },
  { value: '3. Photos/Permits Posted', label: 'Permits Posted' },
  { value: '3. Photos/Damage',         label: 'Damage' },
  { value: '3. Photos/Other',          label: 'Other' },
]

// Which top-level parents count as documents vs. photos.
const isDocCategory   = (c) => !!c && (c.startsWith('1. Estimating Phase/') || c.startsWith('2. Production/'))
const isPhotoCategory = (c) => !!c && c.startsWith('3. Photos/')

function isImageMime(mime = '') {
  return mime.startsWith('image/')
}

// Derive the project's SharePoint *root folder* URL from any uploaded file's
// webUrl. File URLs look like:  .../<ProjectFolder>/<top parent>/<subfolder>/<file>
// where <top parent> is one of the three known parents. We cut the URL right
// before that parent so the link opens the project root (showing Estimating /
// Production / Photos) in SharePoint. Returns null if no file exists yet
// (nothing to derive from — and an empty project has nothing to open anyway).
function deriveProjectFolderUrl(docs = []) {
  const markers = [
    '/1.%20Estimating%20Phase', '/2.%20Production', '/3.%20Photos',
    '/1. Estimating Phase',     '/2. Production',    '/3. Photos',
  ]
  for (const d of docs) {
    const url = d?.sharepoint_url
    if (!url) continue
    let cut = -1
    for (const mk of markers) {
      const i = url.indexOf(mk)
      if (i !== -1 && (cut === -1 || i < cut)) cut = i
    }
    if (cut > 0) return url.slice(0, cut)
  }
  return null
}

// Activity feed display helpers
function activityDot(type) {
  return type === 'task_complete' ? '#10b981'
       : type === 'stage_advance' ? '#E65100'
       : '#9ca3af'
}
function fmtActivityDate(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
         ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtLongDate(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const canDo = useCanDo()
  const isAdmin = useIsAdmin()

  const [project, setProject] = useState(null)
  const [milestones, setMilestones] = useState([])
  const [tasks, setTasks] = useState([])
  const [documents, setDocuments] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [uploading, setUploading] = useState(false)
  const [uploadCategory, setUploadCategory] = useState('2. Production/Job Site Binder')
  const [photoFilter, setPhotoFilter] = useState('all')
  const [lightboxDoc, setLightboxDoc] = useState(null)
  const [staffPool, setStaffPool] = useState([])
  const [editingTeam, setEditingTeam] = useState(false)
  const [teamDraft, setTeamDraft] = useState({ pm_id: null, assistant_pm_id: null })
  const [editingDates, setEditingDates] = useState(false)
  const [dateDraft, setDateDraft] = useState({ due_date: '', start_date: '', reminder_date: '' })

  // Workflow stage control (bar reads DB `stages`; writes go through project-proxy)
  const [stages, setStages] = useState([])
  const [stageBusy, setStageBusy] = useState(false)
  const [stageError, setStageError] = useState(null)
  const [showStageModal, setShowStageModal] = useState(false)
  const [stageTarget, setStageTarget] = useState(null)

  // Milestone inline edit state: { [milestoneId]: { value, milestone_date, notes } }
  const [msDraft, setMsDraft] = useState({})
  const [msSaving, setMsSaving] = useState({}) // { [milestoneId]: bool }

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

  // Project root folder link for the "Open in SharePoint" buttons (Feature 2).
  // Derived from existing files; null until at least one file is uploaded.
  const projectFolderUrl = useMemo(() => deriveProjectFolderUrl(documents), [documents])

  // Client / job site / project contacts. The hierarchy is Client -> Site ->
  // Project, so this is the project's view back up the tree.
  const [clientInfo, setClientInfo] = useState(null)
  const [siteInfo, setSiteInfo]     = useState(null)
  const [projContacts, setProjContacts] = useState([])

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

        // Walk up the hierarchy. Both are nullable — a bid can exist before
        // anyone knows the billing entity.
        if (proj.client_id) {
          const { data: cl } = await supabase.from('clients')
            .select('id, name, client_type, relationship_status, phone, email')
            .eq('id', proj.client_id).maybeSingle()
          setClientInfo(cl ?? null)
        } else setClientInfo(null)

        if (proj.site_id) {
          const { data: st } = await supabase.from('sites')
            .select('id, name, address_line1, borough, bin_number, phone')
            .eq('id', proj.site_id).maybeSingle()
          setSiteInfo(st ?? null)

          // People on this building, via the many-to-many link.
          const { data: links } = await supabase.from('site_contacts')
            .select('contact_id').eq('site_id', proj.site_id)
          const cids = (links ?? []).map(l => l.contact_id)
          if (cids.length) {
            const { data: cts } = await supabase.from('contacts')
              .select('id, full_name, title, email, phone, mobile, is_billing_contact')
              .in('id', cids).eq('is_active', true)
            setProjContacts(cts ?? [])
          } else setProjContacts([])
        } else { setSiteInfo(null); setProjContacts([]) }

        const { data: ms, error: mse } = await supabase
          .from('project_milestones')
          .select('*, milestone_definitions(label, key, sort_order, active_from_stage)')
          .eq('project_id', id)
        if (mse) throw mse
        setMilestones(sortMilestones(ms ?? []))

        const { data: tsk, error: te } = await supabase
          .from('project_tasks')
          .select('*')
          .eq('project_id', id).order('created_at')
        if (te) throw te
        setTasks(tsk ?? [])

        // Load documents from project_documents (excluding soft-deleted)
        const { data: docs, error: de } = await supabase
          .from('project_documents')
          .select('*, uploader:profiles!uploaded_by(full_name, display_name)')
          .eq('project_id', id)
          .eq('is_deleted', false)
          .order('uploaded_at', { ascending: false })
        if (de) throw de
        setDocuments(docs ?? [])

        // Activity feed (non-blocking — never fail the page over it)
        const { data: acts, error: ae } = await supabase
          .from('project_activity')
          .select('id, activity_type, body, author_id, created_at')
          .eq('project_id', id)
          .order('created_at', { ascending: false })
          .limit(25)
        if (!ae) setActivity(acts ?? [])
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

  // Stage label table — DB-driven so wording changes need no deploy. RLS allows
  // authenticated SELECT, so read it directly like the other lookups.
  useEffect(() => {
    supabase.from('stages').select('*').eq('is_active', true).order('stage_number')
      .then(({ data }) => setStages(data || []))
  }, [])

  const maxStage = stages.length ? Math.max(...stages.map(s => s.stage_number)) : 6
  const stageLabelOf = (n) => stages.find(s => s.stage_number === n)?.label ?? null

  const openStageModal = (target) => {
    setStageError(null)
    setStageTarget(target)
    setShowStageModal(true)
  }

  // ONE path for Advance / Back / Set-stage so the DB award gate (Stage 3+
  // requires a linked client + site) fires identically and its 400 surfaces on
  // the control. Not optimistic — the gate can legitimately reject a jump.
  const changeStage = async (target) => {
    if (target == null || target < 1 || target > maxStage) return
    setStageBusy(true)
    setStageError(null)
    try {
      const updated = await proxy({ action: 'update', projectId: id, updates: { current_stage: target } })
      setProject(p => ({ ...p, current_stage: updated?.current_stage ?? target }))
      // Advancing provisions the new stage's tasks server-side (insert-only,
      // idempotent). Retreating inserts nothing and never reopens work. Reload
      // so any newly provisioned tasks appear.
      const { data: tsk } = await supabase.from('project_tasks')
        .select('*').eq('project_id', id).order('created_at')
      if (tsk) setTasks(tsk)
      setShowStageModal(false)
    } catch (e) {
      setStageError(e.message)
    } finally {
      setStageBusy(false)
    }
  }

  const saveTeamAssignment = async () => {
    try {
      await proxy({ action: 'update_project', id, ...teamDraft })
      setProject(p => ({ ...p, ...teamDraft }))
      setEditingTeam(false)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    }
  }

  const saveDates = async () => {
    try {
      const updates = {
        due_date:      dateDraft.due_date || null,
        start_date:    dateDraft.start_date || null,
        reminder_date: dateDraft.reminder_date || null,
      }
      await proxy({ action: 'update', projectId: id, updates })
      setProject(p => ({ ...p, ...updates }))
      setEditingDates(false)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    }
  }

  const setTaskStatus = async (task, newStatus) => {
    if (task.status === newStatus) return
    const prev = task.status
    // Optimistic update
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    try {
      await proxy({ action: 'update_task', taskId: task.id, updates: { status: newStatus } })
    } catch (e) {
      // Revert on failure
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: prev } : t))
      alert('Failed to save task: ' + e.message)
    }
  }

  // -- Milestone editing --------------------------------------------------
  const startEditMilestone = (ms) => {
    setMsDraft(d => ({
      ...d,
      [ms.id]: {
        value: ms.value ?? 'Missing',
        milestone_date: toDateInput(ms.milestone_date),
        notes: ms.notes ?? '',
      },
    }))
  }

  const cancelEditMilestone = (msId) => {
    setMsDraft(d => {
      const next = { ...d }
      delete next[msId]
      return next
    })
  }

  const updateMsDraft = (msId, patch) => {
    setMsDraft(d => ({ ...d, [msId]: { ...d[msId], ...patch } }))
  }

  const saveMilestone = async (ms) => {
    const draft = msDraft[ms.id]
    if (!draft) return

    const updates = {
      value: draft.value,
      milestone_date: draft.milestone_date || null,
      notes: draft.notes?.trim() || null,
    }

    // Optimistic update
    const prev = ms
    setMilestones(list => list.map(m => m.id === ms.id ? { ...m, ...updates } : m))
    setMsSaving(s => ({ ...s, [ms.id]: true }))

    try {
      const saved = await proxy({ action: 'update_milestone', milestoneId: ms.id, updates })
      // Merge server response (keeps milestone_definitions join intact)
      if (saved) {
        setMilestones(list => sortMilestones(list.map(m => m.id === ms.id ? saved : m)))
      }
      cancelEditMilestone(ms.id)
    } catch (e) {
      // Revert
      setMilestones(list => list.map(m => m.id === ms.id ? prev : m))
      alert('Failed to save milestone: ' + e.message)
    } finally {
      setMsSaving(s => {
        const next = { ...s }
        delete next[ms.id]
        return next
      })
    }
  }

  const uploadFile = async (e, categoryOverride) => {
    if (!project?.id) return
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      // Chunked base64 encoding — avoids stack overflow on files over ~100KB
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      const CHUNK = 0x8000
      let binary = ''
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
      }
      const b64 = btoa(binary)

      // Microsoft Graph provider token for SharePoint upload
      let providerToken = null
      try {
        const raw = localStorage.getItem(SP_TOKEN_KEY)
        providerToken = raw ? JSON.parse(raw)?.provider_token : null
      } catch { /* ignore */ }

      const chosenCategory = categoryOverride ?? uploadCategory

      const newDoc = await proxy({
        action: 'upload_file',
        projectId: project.id,
        category: chosenCategory,
        fileName: file.name,
        fileContent: b64,
        document_type: null,
        providerToken,
      })

      // Prepend to list for immediate feedback
      if (newDoc) setDocuments(prev => [newDoc, ...prev])

      // Clear the file input so the same file can be uploaded again
      e.target.value = ''
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  const deleteDocument = async (doc) => {
    if (!confirm(`Delete "${doc.name}"? This will also remove it from SharePoint.`)) return

    const prev = documents
    setDocuments(ds => ds.filter(d => d.id !== doc.id))

    let providerToken = null
    try {
      const raw = localStorage.getItem(SP_TOKEN_KEY)
      providerToken = raw ? JSON.parse(raw)?.provider_token : null
    } catch { /* ignore */ }

    try {
      await proxy({ action: 'delete_file', documentId: doc.id, providerToken })
    } catch (err) {
      setDocuments(prev)
      alert('Delete failed: ' + err.message)
    }
  }

  if (loading) return <div className="p-8 text-center text-ink-500">Loading project...</div>
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>
  if (!project) return <div className="p-8 text-center text-ink-400">Project not found.</div>

  const TABS = ['overview', 'milestones', 'tasks', 'documents', 'photos']

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
          {/* Workflow stage — DB-driven bar + admin Advance / Back / Set-stage */}
          <div className="sm:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Workflow Stage</p>
              <p className="text-xs font-medium text-gray-500">
                {stageLabelOf(project.current_stage)
                  ? `${stageLabelOf(project.current_stage)} \u00b7 Stage ${project.current_stage} of ${maxStage}`
                  : `Stage ${project.current_stage ?? '-'}`}
              </p>
            </div>

            {stages.length > 0 && (
              <div className="flex gap-1">
                {stages.map(s => {
                  const cur = project.current_stage ?? 1
                  const state = s.stage_number < cur ? 'done' : s.stage_number === cur ? 'current' : 'future'
                  return (
                    <div key={s.stage_number} className="flex-1 min-w-0">
                      <div className={`h-1.5 rounded-full ${
                        state === 'done' ? 'bg-pyramid-600'
                        : state === 'current' ? 'bg-orange-500'
                        : 'bg-gray-200'
                      }`} />
                      <p
                        title={s.label}
                        className={`mt-1 text-[10px] text-center truncate ${
                          state === 'current' ? 'font-semibold text-orange-700' : 'text-gray-500'
                        }`}
                      >
                        {s.label}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}

            {isAdmin && (
              <>
                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <button
                    onClick={() => changeStage((project.current_stage ?? 1) - 1)}
                    disabled={stageBusy || (project.current_stage ?? 1) <= 1}
                    title="Go back a stage. This moves the stage marker only — it does not undo or reopen completed tasks."
                    className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    \u2190 Back
                  </button>
                  <button
                    onClick={() => changeStage((project.current_stage ?? 1) + 1)}
                    disabled={stageBusy || (project.current_stage ?? 1) >= maxStage}
                    className="px-3 py-1.5 text-sm rounded bg-pyramid-600 text-white hover:bg-pyramid-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Advance \u2192
                  </button>
                  <button
                    onClick={() => openStageModal(project.current_stage ?? 1)}
                    disabled={stageBusy}
                    className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40"
                  >
                    Set stage\u2026
                  </button>
                  {stageBusy && <span className="text-xs text-gray-400">Saving\u2026</span>}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  Back moves the stage marker only — it never reopens or deletes completed tasks. Stage 3 (Awarded) and later require a linked client and job site.
                </p>
              </>
            )}

            {stageError && (
              <p className="text-sm text-red-700 mt-3">{stageError}</p>
            )}

            {showStageModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                onClick={() => !stageBusy && setShowStageModal(false)}
              >
                <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Change workflow stage</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {project.project_number ?? 'This project'} is at{' '}
                    <span className="font-medium text-gray-900">
                      {stageLabelOf(project.current_stage) ?? `Stage ${project.current_stage ?? '-'}`}
                    </span>. Move it to:
                  </p>

                  <select
                    value={stageTarget ?? ''}
                    onChange={e => setStageTarget(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 bg-white mb-3"
                  >
                    {stages.map(s => (
                      <option key={s.stage_number} value={s.stage_number}>
                        Stage {s.stage_number} — {s.label}
                      </option>
                    ))}
                  </select>

                  {stageTarget != null && project.current_stage != null && stageTarget < project.current_stage && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
                      Going back leaves completed and higher-stage tasks in place. It does not undo or reopen finished work.
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mb-3">
                    Stage 3 (Awarded) and later require a linked client and job site, or the change is blocked.
                  </p>

                  {stageError && <p className="text-sm text-red-700 mb-3">{stageError}</p>}

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowStageModal(false)}
                      disabled={stageBusy}
                      className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => changeStage(stageTarget)}
                      disabled={stageBusy || stageTarget == null || stageTarget === project.current_stage}
                      className="px-3 py-1.5 text-sm rounded bg-pyramid-600 text-white hover:bg-pyramid-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {stageBusy ? 'Saving\u2026' : 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

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
            <p className="text-sm font-medium text-gray-900">
              {stageLabelOf(project.current_stage)
                ? `Stage ${project.current_stage} — ${stageLabelOf(project.current_stage)}`
                : (project.current_stage ?? '-')}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Project Number</p>
            <p className="text-sm font-medium text-gray-900">{project.project_number ?? '-'}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Created</p>
            <p className="text-sm font-medium text-gray-900">{fmtLongDate(project.created_at)}</p>
          </div>
          <div className="sm:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Client &amp; Job Site</p>
            {!project.client_id && !project.site_id ? (
              <p className="text-sm text-gray-500">
                No client or job site linked yet.{' '}
                <a href="/clients" className="text-blue-600 hover:text-blue-800">Add one under Clients</a>
                {' '}\u2014 required before this job can be marked awarded.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-400 block mb-1">Client</p>
                    {clientInfo ? (
                      <a href={`/clients/${clientInfo.id}`}
                         className="text-sm font-medium text-blue-600 hover:text-blue-800">
                        {clientInfo.name}
                        {clientInfo.relationship_status === 'prospect' && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 align-middle">
                            PROSPECT
                          </span>
                        )}
                      </a>
                    ) : <p className="text-sm text-gray-500">\u2014</p>}
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 block mb-1">Job Site</p>
                    {siteInfo ? (
                      <>
                        <a href={`/sites/${siteInfo.id}`}
                           className="text-sm font-medium text-blue-600 hover:text-blue-800">
                          {siteInfo.name}
                        </a>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {[siteInfo.address_line1, siteInfo.borough,
                            siteInfo.bin_number && `BIN ${siteInfo.bin_number}`]
                            .filter(Boolean).join(' \u00b7 ')}
                        </p>
                      </>
                    ) : <p className="text-sm text-gray-500">\u2014</p>}
                  </div>
                </div>

                {projContacts.length > 0 && (
                  <div className="pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Site contacts</p>
                    <div className="space-y-2">
                      {projContacts.map(ct => (
                        <div key={ct.id} className="text-sm">
                          <span className="font-medium text-gray-900">{ct.full_name}</span>
                          {ct.is_billing_contact && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                              RECEIVES INVOICES
                            </span>
                          )}
                          <p className="text-xs text-gray-400">
                            {[ct.title, ct.email, ct.phone, ct.mobile && `Cell ${ct.mobile}`]
                              .filter(Boolean).join(' \u00b7 ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sm:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Timeline</p>
              {!editingDates ? (
                canDo('update_project_fields') && (
                  <button
                    onClick={() => {
                      setDateDraft({
                        due_date: project.due_date ?? '',
                        start_date: project.start_date ?? '',
                        reminder_date: project.reminder_date ?? '',
                      })
                      setEditingDates(true)
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                )
              ) : (
                <div className="flex gap-2">
                  <button onClick={saveDates} className="text-xs text-green-600 hover:text-green-800">Save</button>
                  <button onClick={() => setEditingDates(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                </div>
              )}
            </div>
            {!editingDates ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-gray-400">Due Date</p>
                  <p className="text-sm font-medium text-gray-900">{fmtLongDate(project.due_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Start Date</p>
                  <p className="text-sm font-medium text-gray-900">{fmtLongDate(project.start_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Reminder</p>
                  <p className="text-sm font-medium text-gray-900">{fmtLongDate(project.reminder_date)}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Due Date</label>
                  <input type="date" value={dateDraft.due_date || ''} onChange={(e) => setDateDraft((d) => ({ ...d, due_date: e.target.value }))} className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Start Date</label>
                  <input type="date" value={dateDraft.start_date || ''} onChange={(e) => setDateDraft((d) => ({ ...d, start_date: e.target.value }))} className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Reminder</label>
                  <input type="date" value={dateDraft.reminder_date || ''} onChange={(e) => setDateDraft((d) => ({ ...d, reminder_date: e.target.value }))} className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900" />
                </div>
              </div>
            )}
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
                canDo('assign_team') && (
                  <button
                    onClick={() => {
                      setTeamDraft({ pm_id: project.pm_id, assistant_pm_id: project.assistant_pm_id })
                      setEditingTeam(true)
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                )
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
          <div className="sm:col-span-2 bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Activity</p>
            {activity.length === 0 ? (
              <p className="text-sm text-gray-400">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {activity.map((a) => {
                  const who = staffPool.find((s) => s.id === a.author_id)?.full_name
                  return (
                    <div key={a.id} className="flex gap-3">
                      <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: activityDot(a.activity_type) }} />
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800">{a.body}</p>
                        <p className="text-xs text-gray-400">{who ? who + ' · ' : ''}{fmtActivityDate(a.created_at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'milestones' && (
        <div className="space-y-3">
          {milestones.length === 0 && <p className="text-sm text-gray-500">No milestones yet.</p>}
          {milestones.map((ms) => {
            const isEditing = !!msDraft[ms.id]
            const isSaving = !!msSaving[ms.id]
            const value = ms.value ?? 'Missing'
            const style = MILESTONE_VALUE_STYLE[value] ?? MILESTONE_VALUE_STYLE['Missing']
            const isFutureStage =
              ms.milestone_definitions?.active_from_stage != null &&
              project.current_stage != null &&
              ms.milestone_definitions.active_from_stage > project.current_stage

            return (
              <div
                key={ms.id}
                className={`bg-white rounded-lg border p-4 transition ${
                  isEditing ? 'border-pyramid-400 ring-2 ring-pyramid-100' : 'border-gray-200'
                } ${isFutureStage && !isEditing ? 'opacity-60' : ''}`}
              >
                {!isEditing ? (
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${style.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">
                          {ms.milestone_definitions?.label ?? ms.milestone_definitions?.key ?? 'Milestone'}
                        </p>
                        {isFutureStage && (
                          <span className="text-[10px] uppercase tracking-wide text-gray-400">
                            Stage {ms.milestone_definitions.active_from_stage}
                          </span>
                        )}
                      </div>
                      {ms.milestone_definitions?.key && (
                        <p className="text-xs text-gray-400 mt-0.5">{ms.milestone_definitions.key}</p>
                      )}
                      {ms.milestone_date && (
                        <p className="text-xs text-gray-500 mt-1">
                          Date: {new Date(ms.milestone_date).toLocaleDateString()}
                        </p>
                      )}
                      {ms.notes && (
                        <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{ms.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${style.pill}`}>
                        {value}
                      </span>
                      {canDo('edit_milestones') && (
                        <button
                          onClick={() => startEditMilestone(ms)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {ms.milestone_definitions?.label ?? ms.milestone_definitions?.key ?? 'Milestone'}
                        </p>
                        {ms.milestone_definitions?.key && (
                          <p className="text-xs text-gray-400 mt-0.5">{ms.milestone_definitions.key}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveMilestone(ms)}
                          disabled={isSaving}
                          className="text-xs text-green-600 hover:text-green-800 disabled:text-gray-400"
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => cancelEditMilestone(ms.id)}
                          disabled={isSaving}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Value</label>
                        <select
                          value={msDraft[ms.id].value}
                          onChange={(e) => updateMsDraft(ms.id, { value: e.target.value })}
                          disabled={isSaving}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900"
                        >
                          {MILESTONE_VALUES.map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Date</label>
                        <input
                          type="date"
                          value={msDraft[ms.id].milestone_date}
                          onChange={(e) => updateMsDraft(ms.id, { milestone_date: e.target.value })}
                          disabled={isSaving}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Notes</label>
                      <textarea
                        value={msDraft[ms.id].notes}
                        onChange={(e) => updateMsDraft(ms.id, { notes: e.target.value })}
                        disabled={isSaving}
                        rows={2}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm text-gray-900 resize-y"
                        placeholder="Optional notes..."
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-2">
          {tasks.length === 0 && <p className="text-sm text-gray-500">No tasks yet.</p>}
          {tasks.map((task) => {
            const isOwnTask = task.assigned_to_id && profile?.id && task.assigned_to_id === profile.id
            const canToggle = canDo('edit_any_task') || isOwnTask
            const assignee = staffPool.find(s => s.id === task.assigned_to_id)
            const assigneeName = assignee?.display_name ?? assignee?.full_name ?? null

            return (
              <div
                key={task.id}
                className="flex items-start gap-3 bg-white rounded-lg border border-gray-200 p-3.5"
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={task.status === 'completed'}
                  onChange={(e) => canToggle && setTaskStatus(task, e.target.checked ? 'completed' : 'pending')}
                  disabled={!canToggle}
                  className={`mt-0.5 w-4 h-4 rounded border-gray-300 text-pyramid-500 flex-shrink-0 ${
                    canToggle ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                  }`}
                />

                {/* Task info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${
                    task.status === 'completed' || task.status === 'na'
                      ? 'line-through text-gray-400'
                      : 'text-gray-900'
                  }`}>
                    {task.task_name}
                    {task.status === 'na' && (
                      <span className="ml-2 align-middle text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">N/A</span>
                    )}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 mt-1">
                    {/* Stage badge */}
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                      Stage {task.stage_number}
                    </span>

                    {/* Due date */}
                    {task.due_date && (
                      <span className="text-xs text-gray-400">
                        Due: {new Date(task.due_date).toLocaleDateString()}
                      </span>
                    )}

                    {/* Assignee display or "unassigned" */}
                    {canDo('assign_task') ? (
                      <select
                        value={task.assigned_to_id ?? ''}
                        onChange={async (e) => {
                          const newId = e.target.value || null
                          // Optimistic update
                          setTasks(ts => ts.map(t =>
                            t.id === task.id ? { ...t, assigned_to_id: newId } : t
                          ))
                          try {
                            await proxy({ action: 'assign_task', taskId: task.id, assigneeId: newId })
                          } catch (err) {
                            // Revert on failure
                            setTasks(ts => ts.map(t =>
                              t.id === task.id ? { ...t, assigned_to_id: task.assigned_to_id } : t
                            ))
                            alert('Failed to assign task: ' + err.message)
                          }
                        }}
                        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 bg-white focus:outline-none focus:border-pyramid-400"
                      >
                        <option value="">— Unassigned —</option>
                        {staffPool.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.display_name ?? s.full_name}
                          </option>
                        ))}
                      </select>
                    ) : assigneeName ? (
                      <span className="text-xs text-pyramid-600 font-medium">
                        {assigneeName}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">Unassigned</span>
                    )}
                  </div>

                  {!canToggle && !canDo('edit_any_task') && (
                    <p className="text-[10px] text-gray-400 mt-1 italic">Not assigned to you</p>
                  )}
                </div>

                {/* Complete / N/A / Reopen — same gate as the checkbox */}
                {canToggle && (
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {task.status !== 'na' && (
                      <button
                        onClick={() => setTaskStatus(task, 'na')}
                        className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
                      >
                        N/A
                      </button>
                    )}
                    {(task.status === 'na' || task.status === 'completed') && (
                      <button
                        onClick={() => setTaskStatus(task, 'pending')}
                        className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'documents' && (
        <>
          {/* Upload bar — admin only */}
          {canDo('upload_file') ? (
            <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-gray-200">
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                disabled={uploading}
                className="text-sm border border-gray-200 rounded px-2 py-1.5 text-gray-900 bg-white"
              >
                {DOCUMENT_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>

              <label className={`cursor-pointer ${uploading ? 'opacity-60 cursor-wait' : ''}`}>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => uploadFile(e)}
                  disabled={uploading}
                />
                <span className="inline-block text-xs bg-pyramid-500 text-white px-3 py-1.5 rounded-lg hover:bg-pyramid-600 transition-colors">
                  {uploading ? 'Uploading...' : 'Upload to ' + (DOCUMENT_CATEGORIES.find(c => c.value === uploadCategory)?.label ?? 'Other')}
                </span>
              </label>

              <span className="text-xs text-gray-400 ml-auto">
                {documents.filter(d => isDocCategory(d.category)).length} document{documents.filter(d => isDocCategory(d.category)).length !== 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 mb-4 pb-4 border-b border-gray-200">
              <p className="text-xs text-gray-400">View only — uploads managed by admins.</p>
              <span className="text-xs text-gray-400">
                {documents.filter(d => isDocCategory(d.category)).length} document{documents.filter(d => isDocCategory(d.category)).length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Open the whole project folder in SharePoint (Feature 2) */}
          {projectFolderUrl && (
            <div className="mb-4">
              <a
                href={projectFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-pyramid-300 text-pyramid-700 px-3 py-1.5 rounded-lg hover:bg-pyramid-50 transition-colors"
              >
                Open folder in SharePoint ↗
              </a>
            </div>
          )}

          {/* Grouped by category */}
          {(() => {
            const docs = documents.filter(d => isDocCategory(d.category))
            if (docs.length === 0) {
              return <p className="text-sm text-gray-500">No documents yet. Pick a category above and upload.</p>
            }
            return (
              <div className="space-y-5">
                {DOCUMENT_CATEGORIES.map(cat => {
                  const group = docs.filter(d => d.category === cat.value)
                  if (group.length === 0) return null
                  return (
                    <div key={cat.value}>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        {cat.label} <span className="text-gray-400 font-normal">({group.length})</span>
                      </h3>
                      <div className="space-y-2">
                        {group.map(doc => (
                          <div
                            key={doc.id}
                            className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors"
                          >
                            <div className="w-8 h-8 rounded bg-pyramid-50 flex items-center justify-center text-[10px] font-bold text-pyramid-600 flex-shrink-0">
                              {fileIcon(doc.name)}
                            </div>
                            <a
                              href={doc.sharepoint_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 min-w-0"
                            >
                              <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                              <p className="text-xs text-gray-400">
                                {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : ''}
                                {doc.file_size_bytes ? ` · ${fmtBytes(doc.file_size_bytes)}` : ''}
                                {(doc.uploader?.display_name ?? doc.uploader?.full_name)
                                  ? ` · ${doc.uploader.display_name ?? doc.uploader.full_name}`
                                  : ''}
                              </p>
                            </a>
                            {canDo('delete_file') && (
                              <button
                                onClick={() => deleteDocument(doc)}
                                className="text-xs text-red-500 hover:text-red-700 flex-shrink-0"
                                title="Delete"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </>
      )}

      {activeTab === 'photos' && (
        <>
          {/* Upload bar — admin only */}
          {canDo('upload_file') ? (
            <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-gray-200">
              <select
                value={isPhotoCategory(uploadCategory) ? uploadCategory : '3. Photos/Progress'}
                onChange={(e) => setUploadCategory(e.target.value)}
                disabled={uploading}
                className="text-sm border border-gray-200 rounded px-2 py-1.5 text-gray-900 bg-white"
              >
                {PHOTO_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>

              <label className={`cursor-pointer ${uploading ? 'opacity-60 cursor-wait' : ''}`}>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => uploadFile(e, isPhotoCategory(uploadCategory) ? uploadCategory : '3. Photos/Progress')}
                  disabled={uploading}
                />
                <span className="inline-block text-xs bg-pyramid-500 text-white px-3 py-1.5 rounded-lg hover:bg-pyramid-600 transition-colors">
                  {uploading ? 'Uploading...' : '📷 Take / Upload Photo'}
                </span>
              </label>

              <span className="text-xs text-gray-400 ml-auto">
                {documents.filter(d => isPhotoCategory(d.category)).length} photo{documents.filter(d => isPhotoCategory(d.category)).length !== 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 mb-4 pb-4 border-b border-gray-200">
              <p className="text-xs text-gray-400">View only — photo uploads managed by admins.</p>
              <span className="text-xs text-gray-400">
                {documents.filter(d => isPhotoCategory(d.category)).length} photo{documents.filter(d => isPhotoCategory(d.category)).length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Open the whole project folder in SharePoint (Feature 2) */}
          {projectFolderUrl && (
            <div className="mb-4">
              <a
                href={projectFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-pyramid-300 text-pyramid-700 px-3 py-1.5 rounded-lg hover:bg-pyramid-50 transition-colors"
              >
                Open folder in SharePoint ↗
              </a>
            </div>
          )}

          {/* Category filter buttons */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            <button
              onClick={() => setPhotoFilter('all')}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                photoFilter === 'all'
                  ? 'bg-pyramid-500 text-white border-pyramid-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              All
            </button>
            {PHOTO_CATEGORIES.map(cat => (
              <button
                key={cat.value}
                onClick={() => setPhotoFilter(cat.value)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  photoFilter === cat.value
                    ? 'bg-pyramid-500 text-white border-pyramid-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Thumbnail grid */}
          {(() => {
            const photos = documents.filter(d =>
              isPhotoCategory(d.category) &&
              (photoFilter === 'all' || d.category === photoFilter),
            )
            if (photos.length === 0) {
              return (
                <p className="text-sm text-gray-500">
                  {photoFilter === 'all' ? 'No photos yet.' : 'No photos in this category.'}
                </p>
              )
            }
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {photos.map(doc => (
                  <div
                    key={doc.id}
                    className="relative group aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200"
                  >
                    {isImageMime(doc.mime_type) ? (
                      // Clickable thumbnail (SharePoint webUrl opens in SP viewer)
                      <button
                        onClick={() => setLightboxDoc(doc)}
                        className="absolute inset-0 w-full h-full flex items-center justify-center hover:opacity-90"
                      >
                        <div className="flex flex-col items-center gap-1 text-gray-500">
                          <span className="text-2xl">🖼</span>
                          <span className="text-[10px] text-gray-400">Click to view</span>
                        </div>
                      </button>
                    ) : (
                      <a
                        href={doc.sharepoint_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute inset-0 w-full h-full flex items-center justify-center"
                      >
                        <div className="w-10 h-10 rounded bg-pyramid-50 flex items-center justify-center text-xs font-bold text-pyramid-600">
                          {fileIcon(doc.name)}
                        </div>
                      </a>
                    )}

                    {/* Hover overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] text-white truncate" title={doc.name}>{doc.name}</p>
                      <p className="text-[9px] text-white/70">
                        {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : ''}
                      </p>
                    </div>

                    {/* Delete button — admin only */}
                    {canDo('delete_file') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteDocument(doc) }}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/80 text-red-500 hover:bg-white hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                        title="Delete"
                      >
                        ×
                      </button>
                    )}

                    {/* Category badge */}
                    <span className="absolute top-1 left-1 text-[9px] bg-white/80 text-gray-700 px-1.5 py-0.5 rounded-full">
                      {PHOTO_CATEGORIES.find(c => c.value === doc.category)?.label ?? '?'}
                    </span>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Lightbox — opens SharePoint in a new tab since we can't proxy image bytes */}
          {lightboxDoc && (
            <div
              onClick={() => setLightboxDoc(null)}
              className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 cursor-pointer"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-lg max-w-md w-full p-6 cursor-default"
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{lightboxDoc.name}</h3>
                <p className="text-xs text-gray-500 mb-4">
                  {PHOTO_CATEGORIES.find(c => c.value === lightboxDoc.category)?.label ?? 'Photo'}
                  {lightboxDoc.uploaded_at && ` · ${new Date(lightboxDoc.uploaded_at).toLocaleString()}`}
                  {lightboxDoc.file_size_bytes && ` · ${fmtBytes(lightboxDoc.file_size_bytes)}`}
                </p>
                <div className="flex gap-2">
                  <a
                    href={lightboxDoc.sharepoint_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-sm text-center bg-pyramid-500 text-white px-3 py-2 rounded-lg hover:bg-pyramid-600 transition-colors"
                  >
                    Open in SharePoint
                  </a>
                  <button
                    onClick={() => setLightboxDoc(null)}
                    className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}