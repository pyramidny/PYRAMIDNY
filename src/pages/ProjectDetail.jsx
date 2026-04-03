// src/pages/ProjectDetail.jsx
// Route: /projects/:id
// Reads: projects (with pm, estimator, assistant_pm joins) + project_production
// Writes: project status/stage updates, production checklist items

import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

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
  'New Bid':         'bg-stone-800 text-stone-300 border-stone-600',
  'Active Bid':      'bg-blue-950 text-blue-300 border-blue-700',
  'No Bid':          'bg-red-950 text-red-300 border-red-700',
  'Bid Not Awarded': 'bg-orange-950 text-orange-300 border-orange-700',
  'Job Awarded':     'bg-emerald-950 text-emerald-300 border-emerald-700',
  'Active Job':      'bg-emerald-900 text-emerald-200 border-emerald-600',
  'Job Closed':      'bg-stone-800 text-stone-400 border-stone-600',
}

// Production checklist — Regular has all 10, IRA skips retainage_closeout
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

const CHECKLIST_VALUES = [null, 'Yes', 'N/A', 'No']

const CHECKLIST_STYLES = {
  Yes:  'bg-emerald-500 text-white border-emerald-500',
  No:   'bg-red-500 text-white border-red-500',
  'N/A':'bg-stone-600 text-stone-200 border-stone-500',
  null: 'bg-transparent text-stone-600 border-stone-700',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtMoney(val) {
  if (!val) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val)
}

function profileName(p) {
  if (!p) return '—'
  return p.display_name ?? p.full_name ?? '—'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 border-b border-stone-800 last:border-0">
      <span className="text-[10px] font-semibold tracking-widest uppercase text-stone-500">{label}</span>
      <span className="text-sm text-stone-200">{value || '—'}</span>
    </div>
  )
}

function SectionCard({ title, children, action }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-sm">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-800">
        <h3 className="text-xs font-semibold tracking-widest uppercase text-stone-400">{title}</h3>
        {action}
      </div>
      <div className="px-5 py-1">{children}</div>
    </div>
  )
}

// Stage tracker
function StageTracker({ current, isPM, onAdvance }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-sm px-5 py-4">
      <div className="flex items-center gap-0">
        {STAGES.map((s, i) => {
          const done    = s.n < current
          const active  = s.n === current
          const future  = s.n > current
          return (
            <div key={s.n} className="flex items-center flex-1 min-w-0">
              {/* Node */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={`
                  w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold
                  transition-all
                  ${done   ? 'bg-amber-500 border-amber-500 text-stone-950' : ''}
                  ${active ? 'bg-stone-950 border-amber-500 text-amber-500' : ''}
                  ${future ? 'bg-stone-900 border-stone-700 text-stone-600' : ''}
                `}>
                  {done ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : s.n}
                </div>
                <span className={`
                  mt-1.5 text-[10px] font-medium whitespace-nowrap hidden sm:block
                  ${active ? 'text-amber-400' : done ? 'text-stone-400' : 'text-stone-600'}
                `}>
                  {s.label}
                </span>
              </div>
              {/* Connector */}
              {i < STAGES.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${done ? 'bg-amber-500' : 'bg-stone-700'}`} />
              )}
            </div>
          )
        })}
      </div>
      {isPM && current < 6 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onAdvance}
            className="text-xs text-amber-500 hover:text-amber-400 font-medium
                       border border-amber-800 hover:border-amber-600 px-3 py-1.5
                       rounded-sm transition-colors"
          >
            Advance to {STAGES[current]?.label ?? 'Complete'} →
          </button>
        </div>
      )}
    </div>
  )
}

// Production checklist
function ProductionChecklist({ project, production, isPM, onChecklistChange }) {
  const fields = CHECKLIST_FIELDS.filter(f =>
    !f.regularOnly || project.division === 'regular'
  )

  const total    = fields.length
  const complete = fields.filter(f =>
    production?.[f.key] === 'Yes' || production?.[f.key] === 'N/A'
  ).length
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0

  const cycleValue = (current) => {
    const idx = CHECKLIST_VALUES.indexOf(current ?? null)
    return CHECKLIST_VALUES[(idx + 1) % CHECKLIST_VALUES.length]
  }

  const handleClick = (key) => {
    if (!isPM) return
    const next = cycleValue(production?.[key] ?? null)
    onChecklistChange(key, next)
  }

  return (
    <SectionCard
      title="Production Checklist"
      action={
        <div className="flex items-center gap-2">
          <div className="w-24 h-1.5 bg-stone-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-stone-400">{pct}%</span>
        </div>
      }
    >
      <div className="py-2 space-y-1">
        {fields.map((f) => {
          const val = production?.[f.key] ?? null
          return (
            <div
              key={f.key}
              className={`
                flex items-center justify-between py-2.5 px-1 rounded-sm
                ${isPM ? 'hover:bg-stone-800 cursor-pointer' : ''}
                transition-colors group
              `}
              onClick={() => handleClick(f.key)}
            >
              <span className={`text-sm ${val ? 'text-stone-200' : 'text-stone-500'}`}>
                {f.label}
              </span>
              <span className={`
                text-xs font-semibold px-2.5 py-0.5 rounded border min-w-[44px] text-center
                transition-colors
                ${CHECKLIST_STYLES[val] ?? CHECKLIST_STYLES[null]}
              `}>
                {val ?? '—'}
              </span>
            </div>
          )
        })}
      </div>
      {isPM && (
        <p className="text-[10px] text-stone-600 pb-3">
          Click any row to cycle: — → Yes → N/A → No
        </p>
      )}
    </SectionCard>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id }       = useParams()
  const navigate     = useNavigate()
  const { user, isPM } = useAuth()

  const [project,    setProject]    = useState(null)
  const [production, setProduction] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [notFound,   setNotFound]   = useState(false)
  const [editStatus, setEditStatus] = useState(false)
  const [saving,     setSaving]     = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────────────────
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

  // ── Update status ──────────────────────────────────────────────────────────
  const handleStatusChange = async (newStatus) => {
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) setProject((p) => ({ ...p, status: newStatus }))
    setEditStatus(false)
    setSaving(false)
  }

  // ── Advance stage ──────────────────────────────────────────────────────────
  const handleAdvanceStage = async () => {
    if (!project || project.current_stage >= 6) return
    const next = project.current_stage + 1
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ current_stage: next, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) setProject((p) => ({ ...p, current_stage: next }))
    setSaving(false)
  }

  // ── Checklist update ───────────────────────────────────────────────────────
  const handleChecklistChange = async (key, value) => {
    const optimistic = { ...(production ?? { project_id: id }), [key]: value }
    setProduction(optimistic)

    if (production?.id) {
      // Update existing row
      await supabase
        .from('project_production')
        .update({ [key]: value, updated_at: new Date().toISOString() })
        .eq('id', production.id)
    } else {
      // Insert new row
      const { data } = await supabase
        .from('project_production')
        .insert([{ project_id: id, [key]: value }])
        .select()
        .single()
      if (data) setProduction(data)
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) return <DetailSkeleton />

  if (notFound) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-stone-950 text-stone-400">
      <p className="text-lg font-semibold mb-2">Project not found</p>
      <Link to="/projects" className="text-amber-500 hover:text-amber-400 text-sm">
        ← Back to projects
      </Link>
    </div>
  )

  const isProduction = ['Job Awarded', 'Active Job', 'Job Closed'].includes(project.status)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">

      {/* ── Sticky header ── */}
      <div className="border-b border-stone-800 bg-stone-950 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-start justify-between gap-4">

            {/* Left: back + title */}
            <div className="flex items-center gap-4 min-w-0">
              <Link
                to="/projects"
                className="text-stone-500 hover:text-stone-300 transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded border
                    ${project.division === 'regular'
                      ? 'bg-blue-950 text-blue-300 border-blue-800'
                      : 'bg-purple-950 text-purple-300 border-purple-800'
                    }`}>
                    {project.project_number ?? '—'}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-stone-500 font-semibold">
                    {project.division === 'ira' ? 'IRA / Rope Access' : 'Regular'}
                  </span>
                </div>
                <h1 className="text-base font-bold text-stone-100 leading-tight mt-1 truncate max-w-lg">
                  {project.project_address}
                </h1>
                {project.scope_type && (
                  <p className="text-xs text-stone-500 mt-0.5">{project.scope_type}</p>
                )}
              </div>
            </div>

            {/* Right: status badge (clickable for PM) */}
            <div className="flex-shrink-0 relative">
              {editStatus ? (
                <select
                  autoFocus
                  className="bg-stone-900 border border-stone-600 text-stone-100 text-xs
                             rounded-sm px-3 py-1.5 outline-none focus:border-amber-500"
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
                    text-xs font-semibold px-3 py-1.5 rounded border transition-colors
                    ${STATUS_STYLES[project.status] ?? 'bg-stone-800 text-stone-300 border-stone-600'}
                    ${isPM ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}
                  `}
                >
                  {project.status}
                  {isPM && <span className="ml-1.5 opacity-50">▾</span>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Stage tracker */}
        <StageTracker
          current={project.current_stage ?? 1}
          isPM={isPM}
          onAdvance={handleAdvanceStage}
        />

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left column (main) ── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Production checklist — shown once job is awarded */}
            {isProduction && (
              <ProductionChecklist
                project={project}
                production={production}
                isPM={isPM}
                onChecklistChange={handleChecklistChange}
              />
            )}

            {/* Notes */}
            {project.notes && (
              <SectionCard title="Notes">
                <p className="py-4 text-sm text-stone-300 leading-relaxed whitespace-pre-wrap">
                  {project.notes}
                </p>
              </SectionCard>
            )}

            {/* Bid timeline — dates from bidding phase */}
            <SectionCard title="Bid Timeline">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-0">
                {[
                  { label: 'Walkthrough',    value: fmt(project.walkthrough_date) },
                  { label: 'Bid Due',        value: fmt(project.due_date) },
                  { label: 'Bid Submitted',  value: project.bid_submitted ? 'Yes' : '—' },
                  { label: 'Interview',      value: fmt(project.bid_interview_date) },
                  { label: 'Award Date',     value: fmt(project.job_award_date) },
                ].map(({ label, value }) => (
                  <DetailRow key={label} label={label} value={value} />
                ))}
              </div>
            </SectionCard>
          </div>

          {/* ── Right column (sidebar) ── */}
          <div className="space-y-6">

            {/* Financials */}
            <SectionCard title="Financials">
              <DetailRow label="Bid Amount"           value={fmtMoney(project.bid_amount)} />
              <DetailRow label="Contract Amount"      value={fmtMoney(project.job_amount_contracted)} />
            </SectionCard>

            {/* Team */}
            <SectionCard title="Team">
              <DetailRow label="Project Manager"      value={profileName(project.pm)} />
              <DetailRow label="Assistant PM"         value={profileName(project.assistant_pm)} />
              <DetailRow label="Estimator"            value={profileName(project.estimator)} />
            </SectionCard>

            {/* Contacts */}
            <SectionCard title="Contacts">
              <DetailRow label="Property Mgr / Owner" value={project.property_manager_owner} />
              <DetailRow label="Architect / Engineer" value={project.architect_engineer} />
            </SectionCard>

          </div>
        </div>
      </div>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div className="min-h-screen bg-stone-950 animate-pulse">
      <div className="border-b border-stone-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <div className="w-5 h-5 bg-stone-800 rounded" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-24 bg-stone-800 rounded" />
            <div className="h-5 w-64 bg-stone-800 rounded" />
          </div>
          <div className="h-7 w-28 bg-stone-800 rounded" />
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="h-16 bg-stone-900 rounded-sm border border-stone-800" />
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-4">
            <div className="h-64 bg-stone-900 rounded-sm border border-stone-800" />
            <div className="h-40 bg-stone-900 rounded-sm border border-stone-800" />
          </div>
          <div className="space-y-4">
            <div className="h-32 bg-stone-900 rounded-sm border border-stone-800" />
            <div className="h-40 bg-stone-900 rounded-sm border border-stone-800" />
          </div>
        </div>
      </div>
    </div>
  )
}
