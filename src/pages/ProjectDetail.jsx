// src/pages/ProjectDetail.jsx
// Route: /projects/:id
// Reads: projects (pm, estimator, assistant_pm joins) + project_production
// Writes: status, stage, checklist, team via Edge Functions

import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES = [
  { n: 1, label: 'Bidding' },
  { n: 2, label: 'Interview' },
  { n: 3, label: 'Awarded' },
  { n: 4, label: 'Transfer' },
  { n: 5, label: 'Active' },
  { n: 6, label: 'Closeout' },
]

const STATUSES = [
  'New Bid', 'Active Bid', 'No Bid',
  'Bid Not Awarded', 'Job Awarded', 'Active Job', 'Job Closed',
]

const STATUS_STYLES = {
  'New Bid':         'bg-ink-100 text-ink-600 border-ink-300',
  'Active Bid':      'bg-blue-50 text-blue-700 border-blue-200',
  'No Bid':          'bg-red-50 text-red-600 border-red-200',
  'Bid Not Awarded': 'bg-orange-50 text-orange-600 border-orange-200',
  'Job Awarded':     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Active Job':      'bg-emerald-100 text-emerald-800 border-emerald-300',
  'Job Closed':      'bg-ink-100 text-ink-500 border-ink-200',
}

const CHECKLIST_FIELDS = [
  { key: 'project_transfer',      label: 'Project Transfer' },
  { key: 'coi_requested',         label: 'COI Requested' },
  { key: 'cci_requested',         label: 'CCI Requested' },
  { key: 'submittals',            label: 'Submittals' },
  { key: 'informational_package', label: 'Informational Package' },
  { key: 'logistical_plan',       label: 'Logistical Plan' },
  { key: 'dob_permits',           label: 'DOB Permits' },
  { key: 'dot_permits',           label: 'DOT Permits' },
  { key: 'cd5',                   label: 'CD-5' },
  { key: 'retainage_closeout',    label: 'Retainage & Close Out', regularOnly: true },
]

const CHECKLIST_CYCLE = [null, 'Yes', 'N/A', 'No']

const CHECKLIST_PILL = {
  Yes:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  No:   'bg-red-100 text-red-600 border-red-200',
  'N/A':'bg-ink-100 text-ink-500 border-ink-200',
  null: 'bg-transparent text-ink-300 border-ink-200',
}

const PRODUCTION_STATUSES = ['Job Awarded', 'Active Job', 'Job Closed']

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const fmtMoney = (v) => {
  if (!v) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v)
}

const profileName = (p) => p?.display_name ?? p?.full_name ?? '—'

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }) {
  return (
    <div className="py-3 border-b border-ink-100 last:border-0">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-ink-400 mb-0.5">
        {label}
      </div>
      <div className="text-sm text-ink-800">{value || '—'}</div>
    </div>
  )
}

function Card({ title, children, action }) {
  return (
    <div className="bg-white border border-ink-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-ink-100">
        <h3 className="text-xs font-semibold tracking-widest uppercase text-ink-500">{title}</h3>
        {action}
      </div>
      <div className="px-5 py-1">{children}</div>
    </div>
  )
}

function StageTracker({ current, isPM, onAdvance }) {
  return (
    <div className="bg-white border border-ink-200 rounded-xl shadow-sm px-6 py-5">
      <div className="flex items-center">
        {STAGES.map((s, i) => {
          const done   = s.n < current
          const active = s.n === current
          const future = s.n > current
          return (
            <div key={s.n} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={`
                  w-8 h-8 rounded-full border-2 flex items-center justify-center
                  text-xs font-bold transition-all
                  ${done   ? 'bg-emerald-500 border-emerald-500 text-white' : ''}
                  ${active ? 'bg-white border-pyramid-500 text-pyramid-600' : ''}
                  ${future ? 'bg-ink-50 border-ink-200 text-ink-400' : ''}
                `}>
                  {done ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : s.n}
                </div>
                <span className={`
                  mt-1.5 text-[10px] font-semibold tracking-wide hidden sm:block
                  ${active ? 'text-pyramid-600' : done ? 'text-emerald-600' : 'text-ink-400'}
                `}>
                  {s.label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded ${done ? 'bg-emerald-400' : 'bg-ink-100'}`} />
              )}
            </div>
          )
        })}
      </div>
      {isPM && current < 6 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onAdvance}
            className="text-xs font-semibold text-pyramid-600 hover:text-pyramid-500
                       border border-pyramid-200 hover:border-pyramid-400
                       px-3 py-1.5 rounded-lg transition-colors"
          >
            Advance to {STAGES[current]?.label} →
          </button>
        </div>
      )}
    </div>
  )
}

function ProductionChecklist({ project, production, isPM, onChecklistChange }) {
  const fields   = CHECKLIST_FIELDS.filter(f => !f.regularOnly || project.division === 'regular')
  const total    = fields.length
  const complete = fields.filter(f => production?.[f.key] === 'Yes' || production?.[f.key] === 'N/A').length
  const pct      = total > 0 ? Math.round(complete / total * 100) : 0

  const cycle = (cur) => {
    const idx = CHECKLIST_CYCLE.indexOf(cur ?? null)
    return CHECKLIST_CYCLE[(idx + 1) % CHECKLIST_CYCLE.length]
  }

  return (
    <Card
      title="Production Checklist"
      action={
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono font-semibold text-ink-500">{pct}%</span>
        </div>
      }
    >
      <div className="py-2 space-y-0.5">
        {fields.map((f) => {
          const val = production?.[f.key] ?? null
          return (
            <div
              key={f.key}
              onClick={() => isPM && onChecklistChange(f.key, cycle(val))}
              className={`
                flex items-center justify-between py-2.5 px-1 rounded-lg
                ${isPM ? 'hover:bg-ink-50 cursor-pointer' : ''}
                transition-colors
              `}
            >
              <span className={`text-sm ${val ? 'text-ink-800' : 'text-ink-400'}`}>
                {f.label}
              </span>
              <span className={`
                text-xs font-semibold px-2.5 py-0.5 rounded-full border
                min-w-[44px] text-center transition-colors
                ${CHECKLIST_PILL[val] ?? CHECKLIST_PILL[null]}
              `}>
                {val ?? '—'}
              </span>
            </div>
          )
        })}
      </div>
      {isPM && (
        <p className="text-[10px] text-ink-400 pb-3 pt-1">
          Click any row to cycle: — → Yes → N/A → No
        </p>
      )}
    </Card>
  )
}

// ── Team Card ─────────────────────────────────────────────────────────────────

function TeamCard({ project, isPM, profiles, onSave, saving }) {
  const [editing,   setEditing]   = useState(false)
  const [draft,     setDraft]     = useState({})

  const pms         = profiles.filter(p => p.role === 'pm')
  const estimators  = profiles.filter(p => p.role === 'estimator')

  function startEdit() {
    setDraft({
      pm_id:            project.pm_id ?? '',
      assistant_pm_id:  project.assistant_pm_id ?? '',
      estimator_id:     project.estimator_id ?? '',
    })
    setEditing(true)
  }

  function cancel() { setEditing(false) }

  async function save() {
    await onSave({
      pm_id:           draft.pm_id           || null,
      assistant_pm_id: draft.assistant_pm_id || null,
      estimator_id:    draft.estimator_id    || null,
    })
    setEditing(false)
  }

  // ── Edit mode ──
  if (editing) {
    return (
      <Card
        title="Team"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={cancel}
              className="text-xs text-ink-400 hover:text-ink-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-xs font-semibold text-white bg-pyramid-500 hover:bg-pyramid-400
                         disabled:opacity-60 px-3 py-1 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="py-2 space-y-1">
          <TeamSelect
            label="Project Manager"
            value={draft.pm_id}
            options={pms}
            onChange={v => setDraft(d => ({ ...d, pm_id: v }))}
          />
          <TeamSelect
            label="Assistant PM"
            value={draft.assistant_pm_id}
            options={pms}
            onChange={v => setDraft(d => ({ ...d, assistant_pm_id: v }))}
          />
          <TeamSelect
            label="Estimator"
            value={draft.estimator_id}
            options={estimators}
            onChange={v => setDraft(d => ({ ...d, estimator_id: v }))}
          />
        </div>
      </Card>
    )
  }

  // ── Read mode ──
  return (
    <Card
      title="Team"
      action={
        isPM ? (
          <button
            onClick={startEdit}
            className="text-xs font-semibold text-pyramid-600 hover:text-pyramid-500
                       border border-pyramid-200 hover:border-pyramid-400
                       px-2.5 py-1 rounded-lg transition-colors"
          >
            Edit
          </button>
        ) : null
      }
    >
      <InfoRow label="Project Manager" value={profileName(project.pm)} />
      <InfoRow label="Assistant PM"    value={profileName(project.assistant_pm)} />
      <InfoRow label="Estimator"       value={profileName(project.estimator)} />
    </Card>
  )
}

function TeamSelect({ label, value, options, onChange }) {
  return (
    <div className="py-2.5 border-b border-ink-100 last:border-0">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-ink-400 mb-1.5">
        {label}
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm bg-ink-50 border border-ink-200 rounded-lg px-2.5 py-1.5
                   text-ink-800 outline-none focus:border-pyramid-400 transition-colors"
      >
        <option value="">— Unassigned —</option>
        {options.map(p => (
          <option key={p.id} value={p.id}>
            {p.display_name ?? p.full_name}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id }         = useParams()
  const { isPM, user } = useAuth()

  const [project,    setProject]    = useState(null)
  const [production, setProduction] = useState(null)
  const [profiles,   setProfiles]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [notFound,   setNotFound]   = useState(false)
  const [editStatus, setEditStatus] = useState(false)
  const [saving,     setSaving]     = useState(false)

  // ── Fetch project + production ─────────────────────────────────────────────
  const fetchProject = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        pm:profiles!pm_id(id, display_name, full_name),
        estimator:profiles!estimator_id(id, display_name, full_name),
        assistant_pm:profiles!assistant_pm_id(id, display_name, full_name)
      `)
      .eq('id', id)
      .single()

    if (error || !data) { setNotFound(true); setLoading(false); return }
    setProject(data)

    const { data: prod } = await supabase
      .from('project_production')
      .select('*')
      .eq('project_id', id)
      .maybeSingle()

    setProduction(prod ?? null)
    setLoading(false)
  }, [id])

  useEffect(() => { fetchProject() }, [fetchProject])

  // ── Fetch profiles for team dropdowns (PMs + estimators) ──────────────────
  useEffect(() => {
    async function fetchProfiles() {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, full_name, role')
        .in('role', ['pm', 'estimator'])
        .eq('is_active', true)
        .order('full_name')
      if (data) setProfiles(data)
    }
    fetchProfiles()
  }, [])

  // ── Helper: call update-project Edge Function ──────────────────────────────
  async function callUpdateProject(fields) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    // Read the stored Azure AD token as fallback
    const storedRaw   = localStorage.getItem('sb-izjaxmcdlsdkdliqjlei-auth-token')
    const storedToken = storedRaw ? JSON.parse(storedRaw)?.access_token : null
    const authToken   = token ?? storedToken ?? ''

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-project`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ id, ...fields }),
      }
    )
    return res
  }

  // ── Status update ──────────────────────────────────────────────────────────
  const handleStatusChange = async (newStatus) => {
    setSaving(true)
    const res = await callUpdateProject({ status: newStatus })
    if (res.ok) setProject((p) => ({ ...p, status: newStatus }))
    setEditStatus(false)
    setSaving(false)
  }

  // ── Stage advance ──────────────────────────────────────────────────────────
  const handleAdvanceStage = async () => {
    if (!project || project.current_stage >= 6) return
    const next = project.current_stage + 1
    setSaving(true)
    const res = await callUpdateProject({ current_stage: next })
    if (res.ok) setProject((p) => ({ ...p, current_stage: next }))
    setSaving(false)
  }

  // ── Team save ──────────────────────────────────────────────────────────────
  const handleTeamSave = async (teamFields) => {
    setSaving(true)
    const res = await callUpdateProject(teamFields)
    if (res.ok) {
      // Re-fetch to get the updated joined profile names
      await fetchProject()
    }
    setSaving(false)
  }

  // ── Checklist update ───────────────────────────────────────────────────────
  const handleChecklistChange = async (key, value) => {
    const optimistic = { ...(production ?? { project_id: id }), [key]: value }
    setProduction(optimistic)

    const { data: { session } } = await supabase.auth.getSession()
    const storedRaw   = localStorage.getItem('sb-izjaxmcdlsdkdliqjlei-auth-token')
    const storedToken = storedRaw ? JSON.parse(storedRaw)?.access_token : null
    const authToken   = session?.access_token ?? storedToken ?? ''

    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upsert-production`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ project_id: id, [key]: value }),
      }
    )
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) return <DetailSkeleton />

  if (notFound) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
      <p className="text-lg font-semibold text-ink-700 mb-2">Project not found</p>
      <Link to="/projects" className="text-pyramid-600 hover:text-pyramid-500 text-sm font-medium">
        ← Back to projects
      </Link>
    </div>
  )

  const isProduction = PRODUCTION_STATUSES.includes(project.status)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-ink-50">

      {/* ── Sticky header ── */}
      <div className="bg-white border-b border-ink-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link to="/projects" className="text-ink-400 hover:text-ink-600 transition-colors flex-shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded border
                  ${project.division === 'regular'
                    ? 'bg-regular/10 text-regular border-regular/20'
                    : 'bg-ira/10 text-ira border-ira/20'
                  }`}>
                  {project.project_number ?? '—'}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-ink-400 font-semibold">
                  {project.division === 'ira' ? 'IRA / Rope Access' : 'Regular'}
                </span>
              </div>
              <h1 className="text-lg font-condensed font-bold text-ink-900 leading-tight truncate max-w-xl">
                {project.project_address}
              </h1>
              {project.scope_type && (
                <p className="text-xs text-ink-500 mt-0.5">{project.scope_type}</p>
              )}
            </div>
          </div>

          {/* Status badge */}
          <div className="flex-shrink-0">
            {editStatus ? (
              <select
                autoFocus
                className="input text-xs py-1.5 pr-8 min-w-[160px]"
                defaultValue={project.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                onBlur={() => setEditStatus(false)}
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <button
                onClick={() => isPM && setEditStatus(true)}
                className={`
                  text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors
                  ${STATUS_STYLES[project.status] ?? 'bg-ink-100 text-ink-500 border-ink-200'}
                  ${isPM ? 'hover:opacity-75 cursor-pointer' : 'cursor-default'}
                `}
              >
                {project.status}
                {isPM && <span className="ml-1.5 opacity-50">▾</span>}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

          {/* Stage tracker */}
          <StageTracker
            current={project.current_stage ?? 1}
            isPM={isPM}
            onAdvance={handleAdvanceStage}
          />

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* ── Left / main column ── */}
            <div className="lg:col-span-2 space-y-5">

              {isProduction && (
                <ProductionChecklist
                  project={project}
                  production={production}
                  isPM={isPM}
                  onChecklistChange={handleChecklistChange}
                />
              )}

              <Card title="Bid Timeline">
                <div className="grid grid-cols-2 sm:grid-cols-3">
                  {[
                    { label: 'Walkthrough',   value: fmtDate(project.walkthrough_date) },
                    { label: 'Bid Due',       value: fmtDate(project.due_date) },
                    { label: 'Bid Submitted', value: project.bid_submitted ? 'Yes' : '—' },
                    { label: 'Interview',     value: fmtDate(project.bid_interview_date) },
                    { label: 'Award Date',    value: fmtDate(project.job_award_date) },
                  ].map(({ label, value }) => (
                    <InfoRow key={label} label={label} value={value} />
                  ))}
                </div>
              </Card>

              {project.notes && (
                <Card title="Notes">
                  <p className="py-4 text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
                    {project.notes}
                  </p>
                </Card>
              )}
            </div>

            {/* ── Right / sidebar ── */}
            <div className="space-y-5">

              <Card title="Financials">
                <InfoRow label="Bid Amount"      value={fmtMoney(project.bid_amount)} />
                <InfoRow label="Contract Amount" value={fmtMoney(project.job_amount_contracted)} />
              </Card>

              <TeamCard
                project={project}
                isPM={isPM}
                profiles={profiles}
                onSave={handleTeamSave}
                saving={saving}
              />

              <Card title="Contacts">
                <InfoRow label="Property Mgr / Owner" value={project.property_manager_owner} />
                <InfoRow label="Architect / Engineer" value={project.architect_engineer} />
              </Card>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div className="flex flex-col h-full bg-ink-50 animate-pulse">
      <div className="bg-white border-b border-ink-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="w-5 h-5 bg-ink-100 rounded" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-24 bg-ink-100 rounded" />
            <div className="h-5 w-72 bg-ink-100 rounded" />
          </div>
          <div className="h-7 w-28 bg-ink-100 rounded-full" />
        </div>
      </div>
      <div className="flex-1 p-6 space-y-5">
        <div className="h-20 bg-white rounded-xl border border-ink-200" />
        <div className="grid grid-cols-3 gap-5">
          <div className="col-span-2 space-y-5">
            <div className="h-64 bg-white rounded-xl border border-ink-200" />
            <div className="h-40 bg-white rounded-xl border border-ink-200" />
          </div>
          <div className="space-y-5">
            <div className="h-32 bg-white rounded-xl border border-ink-200" />
            <div className="h-40 bg-white rounded-xl border border-ink-200" />
          </div>
        </div>
      </div>
    </div>
  )
}