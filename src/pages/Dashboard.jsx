import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  AlertCircle,
  Anchor,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FolderOpen,
  HardHat,
  ListTodo,
  TrendingUp
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

// Tasks considered "done" vs "still open" — mirrors the My-Tasks query.
const DONE_STATUSES = ['completed', 'skipped', 'na']
const ADMIN_TASK_CAP = 100  // safety cap on the org-wide rollup fetch

function fmtShort(ts) {
  if (!ts) return null
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const STATUS_STYLES = {
  'New Bid':         'bg-ink-100 text-ink-600',
  'Active Bid':      'bg-blue-50 text-blue-700',
  'No Bid':          'bg-red-50 text-red-600',
  'Bid Not Awarded': 'bg-orange-50 text-orange-600',
  'Job Awarded':     'bg-emerald-50 text-emerald-700',
  'Active Job':      'bg-emerald-100 text-emerald-800',
  'Job Closed':      'bg-ink-100 text-ink-500',
}

export function Dashboard() {
  const { profile, division, isAdmin } = useAuth()
  const location                = useLocation()
  const [projectRows, setRows]  = useState([])
  const [tasks, setTasks]       = useState([])
  const [adminTasks, setAdmin]  = useState([])
  const [loading, setLoading]   = useState(true)

  const firstName = profile?.display_name ?? profile?.full_name?.split(' ')[0] ?? 'there'
  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Re-fetch every time we navigate to this page (location.key changes on each visit)
  useEffect(() => { fetchData() }, [division, location.key])

  async function fetchData() {
    setLoading(true)
    try {
      // ── Projects (rows power both the stat cards and the two panes) ─────
      let query = supabase
        .from('projects')
        .select('id, project_number, project_address, status, current_stage, division, created_at')
        .order('created_at', { ascending: false })
      if (division) query = query.eq('division', division)
      const { data: projects, error: projectsError } = await query

      if (projectsError) console.error('Projects query error:', projectsError)

      // Newest activity per project → "last worked on" date + who
      const rows = projects ?? []
      const ids = rows.map(p => p.id)
      if (ids.length) {
        const { data: acts } = await supabase
          .from('project_activity')
          .select('project_id, author_id, created_at')
          .in('project_id', ids)
          .order('created_at', { ascending: false })
        const lastByProject = {}
        for (const a of (acts ?? [])) {
          if (!lastByProject[a.project_id]) lastByProject[a.project_id] = a
        }
        const authorIds = [...new Set(Object.values(lastByProject).map(a => a.author_id).filter(Boolean))]
        const names = {}
        if (authorIds.length) {
          const { data: profs } = await supabase
            .from('profiles').select('id, full_name, display_name').in('id', authorIds)
          for (const p of (profs ?? [])) names[p.id] = p.display_name || p.full_name
        }
        for (const p of rows) {
          const a = lastByProject[p.id]
          p.last_activity_at = a?.created_at ?? null
          p.last_activity_who = a?.author_id ? (names[a.author_id] ?? null) : null
        }
      }
      setRows(rows)

      // ── My open tasks ──────────────────────────────────────────────────
      // Use profile.id from AuthContext — supabase.auth.getUser() returns
      // null for Azure AD tokens and would break the query.
      const userId = profile?.id ?? null

      if (userId) {
        const { data: myTasks, error: tasksError } = await supabase
          .from('project_tasks')
          .select(`
            id, task_name, stage_number, due_date, status,
            project:projects(project_number, project_address, division)
          `)
          .eq('assigned_to_id', userId)
          .not('status', 'in', '("completed","skipped","na")')
          .order('due_date', { ascending: true })
          .limit(5)

        if (tasksError) console.error('Tasks query error:', tasksError)
        if (myTasks) setTasks(myTasks)
      }

      // ── Admin org-wide task rollup (Feature 3) ─────────────────────────
      // Boss view: every task across all projects, no assignee filter.
      // Reads project_tasks (instances) — unaffected by the template reseed.
      if (isAdmin) {
        const { data: allTasks, error: adminErr } = await supabase
          .from('project_tasks')
          .select(`
            id, task_name, stage_number, due_date, status,
            project:projects(project_number, project_address, division)
          `)
          .order('created_at', { ascending: false })
          .limit(ADMIN_TASK_CAP)

        if (adminErr) console.error('Admin tasks query error:', adminErr)
        setAdmin(allTasks ?? [])
      }

    } catch (err) {
      console.error('Dashboard fetchData error:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────
  const stats = {
    activeBids: projectRows.filter(p => p.status === 'Active Bid').length,
    activeJobs: projectRows.filter(p => p.status === 'Active Job').length,
    awarded:    projectRows.filter(p => p.status === 'Job Awarded').length,
    total:      projectRows.length,
    regular:    projectRows.filter(p => p.division === 'regular').length,
    ira:        projectRows.filter(p => p.division === 'ira').length,
  }

  const regularProjects = projectRows.filter(p => p.division === 'regular')
  const iraProjects     = projectRows.filter(p => p.division === 'ira')
  const showBoth        = !division   // All-Divisions users see both panes

  const completedTasks = adminTasks.filter(t => t.status === 'completed')
  const openTasks      = adminTasks.filter(t => !DONE_STATUSES.includes(t.status))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-condensed font-bold text-ink-900 tracking-wide">
            {greeting}, {firstName}
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric'
            })}
          </p>
        </div>
        {profile?.division && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium
            ${profile.division === 'regular'
              ? 'bg-regular/10 text-regular'
              : 'bg-ira/10 text-ira'
            }`}>
            {profile.division === 'regular' ? <HardHat size={14} /> : <Anchor size={14} />}
            {profile.division === 'regular' ? 'Regular' : 'IRA / Rope Access'}
          </div>
        )}
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Bids"    value={stats.activeBids} icon={<TrendingUp size={18} />}     color="text-blue-500"    bg="bg-blue-50"    loading={loading} />
        <StatCard label="Active Jobs"    value={stats.activeJobs} icon={<HardHat size={18} />}        color="text-emerald-600" bg="bg-emerald-50" loading={loading} />
        <StatCard label="Awarded"        value={stats.awarded}    icon={<ClipboardCheck size={18} />} color="text-pyramid-600" bg="bg-pyramid-50" loading={loading} />
        <StatCard label="Total Projects" value={stats.total}      icon={<FolderOpen size={18} />}     color="text-ink-500"     bg="bg-ink-100"    loading={loading} />
      </div>

      {/* ── My Tasks / Project Mix ── */}
      <div className="grid lg:grid-cols-2 gap-6">

        {/* My Tasks */}
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
            <h2 className="font-semibold text-ink-900 text-sm">My Open Tasks</h2>
            <Link to="/tasks" className="text-pyramid-600 text-xs font-medium hover:text-pyramid-500 flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-ink-50">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <TaskSkeleton key={i} />)
            ) : tasks.length === 0 ? (
              <div className="px-5 py-8 text-center text-ink-400 text-sm">
                No open tasks — you're all caught up 🎉
              </div>
            ) : (
              tasks.map(task => <TaskRow key={task.id} task={task} />)
            )}
          </div>
        </div>

        {/* Division breakdown */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-ink-900 text-sm">Project Mix</h2>
          <div className="space-y-3">
            <DivisionBar label="Regular Construction" prefix="P-" count={stats.regular} total={stats.total || 1} color="bg-regular" textColor="text-regular" icon={<HardHat size={15} />} loading={loading} />
            <DivisionBar label="IRA / Rope Access"     prefix="A-" count={stats.ira}     total={stats.total || 1} color="bg-ira"     textColor="text-ira"     icon={<Anchor size={15} />}  loading={loading} />
          </div>
          <div className="pt-2 border-t border-ink-100">
            <Link to="/projects" className="btn-primary w-full justify-center text-sm">
              View All Projects
            </Link>
          </div>
        </div>
      </div>

      {/* ── Project panes: Regular | IRA (Feature 1) ── */}
      {showBoth ? (
        <div className="grid lg:grid-cols-2 gap-6">
          <ProjectPane
            title="Regular Construction" icon={<HardHat size={15} />} accent="text-regular"
            prefixClass="bg-regular/10 text-regular border-regular/20"
            projects={regularProjects} loading={loading} division="regular"
          />
          <ProjectPane
            title="IRA / Rope Access" icon={<Anchor size={15} />} accent="text-ira"
            prefixClass="bg-ira/10 text-ira border-ira/20"
            projects={iraProjects} loading={loading} division="ira"
          />
        </div>
      ) : (
        <ProjectPane
          title={division === 'ira' ? 'IRA / Rope Access' : 'Regular Construction'}
          icon={division === 'ira' ? <Anchor size={15} /> : <HardHat size={15} />}
          accent={division === 'ira' ? 'text-ira' : 'text-regular'}
          prefixClass={division === 'ira' ? 'bg-ira/10 text-ira border-ira/20' : 'bg-regular/10 text-regular border-regular/20'}
          projects={division === 'ira' ? iraProjects : regularProjects}
          loading={loading} division={division}
        />
      )}

      {/* ── Admin task rollup: Completed | Still To Do (Feature 3) ── */}
      {isAdmin && (
        <div className="grid lg:grid-cols-2 gap-6">
          <TaskRollupPane
            title="Still To Do" tone="open" icon={<ListTodo size={15} />}
            tasks={openTasks} loading={loading} capped={adminTasks.length >= ADMIN_TASK_CAP}
          />
          <TaskRollupPane
            title="Completed" tone="done" icon={<CheckCircle2 size={15} />}
            tasks={completedTasks} loading={loading} capped={adminTasks.length >= ADMIN_TASK_CAP}
          />
        </div>
      )}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color, bg, loading }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${bg} ${color}`}>{icon}</div>
      </div>
      {loading ? (
        <div className="h-7 w-12 bg-ink-100 rounded animate-pulse mb-1" />
      ) : (
        <div className="text-2xl font-condensed font-bold text-ink-900">{value ?? '—'}</div>
      )}
      <div className="text-xs text-ink-500 font-medium mt-0.5">{label}</div>
    </div>
  )
}

// ── My-tasks row ────────────────────────────────────────────────────────────
function TaskRow({ task }) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()
  const dueStr = task.due_date
    ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="flex items-start gap-3 px-5 py-3.5 hover:bg-ink-50 transition-colors">
      <div className={`mt-0.5 flex-shrink-0 w-2 h-2 rounded-full
        ${isOverdue ? 'bg-red-500' : 'bg-pyramid-500'}`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-800 truncate">{task.task_name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border
            ${task.project?.division === 'regular'
              ? 'bg-regular/10 text-regular border-regular/20'
              : 'bg-ira/10 text-ira border-ira/20'
            }`}>
            {task.project?.project_number}
          </span>
          <span className="text-ink-400 text-xs truncate">{task.project?.project_address}</span>
        </div>
      </div>
      {dueStr && (
        <span className={`flex-shrink-0 flex items-center gap-1 text-xs font-medium
          ${isOverdue ? 'text-red-500' : 'text-ink-400'}`}>
          {isOverdue && <AlertCircle size={11} />}
          {isOverdue ? 'Overdue' : dueStr}
        </span>
      )}
    </div>
  )
}

function TaskSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <div className="w-2 h-2 rounded-full bg-ink-100 flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-ink-100 rounded w-3/4 animate-pulse" />
        <div className="h-2.5 bg-ink-100 rounded w-1/2 animate-pulse" />
      </div>
    </div>
  )
}

function DivisionBar({ label, prefix, count, total, color, textColor, icon, loading }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className={`flex items-center gap-1.5 text-sm font-medium ${textColor}`}>
          {icon} {label}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-400">{prefix}</span>
          <span className="text-sm font-bold text-ink-700">{count}</span>
        </div>
      </div>
      <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
        {!loading && (
          <div
            className={`h-full rounded-full ${color} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  )
}

// ── Project pane (Feature 1) ────────────────────────────────────────────────
function ProjectPane({ title, icon, accent, prefixClass, projects, loading, division }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
        <h2 className={`font-semibold text-sm flex items-center gap-1.5 ${accent}`}>
          {icon} {title}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-400">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
          <Link
            to={`/projects?division=${division}`}
            className="text-pyramid-600 text-xs font-medium hover:text-pyramid-500 flex items-center gap-1"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
      </div>
      <div className="divide-y divide-ink-50 max-h-[420px] overflow-y-auto">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <ProjectRowSkeleton key={i} />)
        ) : projects.length === 0 ? (
          <div className="px-5 py-10 text-center text-ink-400 text-sm">No projects in this division yet.</div>
        ) : (
          projects.map(p => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50 transition-colors"
            >
              <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${prefixClass}`}>
                {p.project_number}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{p.project_address}</p>
                <p className="text-[10px] text-ink-400 truncate">
                  {p.created_at ? 'Created ' + fmtShort(p.created_at) : ''}
                  {p.last_activity_at ? ' · Updated ' + fmtShort(p.last_activity_at) + (p.last_activity_who ? ' · ' + p.last_activity_who : '') : ''}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[p.status] ?? 'bg-ink-100 text-ink-500'}`}>
                  {p.status}
                </span>
                <span className="text-[10px] text-ink-400">Stage {p.current_stage ?? '—'}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

function ProjectRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-5 w-12 bg-ink-100 rounded animate-pulse flex-shrink-0" />
      <div className="flex-1"><div className="h-3.5 bg-ink-100 rounded w-2/3 animate-pulse" /></div>
      <div className="h-5 w-16 bg-ink-100 rounded-full animate-pulse" />
    </div>
  )
}

// ── Admin task rollup pane (Feature 3) ──────────────────────────────────────
function TaskRollupPane({ title, tone, icon, tasks, loading, capped }) {
  const SHOW = 8
  const visible = tasks.slice(0, SHOW)
  const more = tasks.length - visible.length
  const headTone = tone === 'done' ? 'text-emerald-600' : 'text-pyramid-600'
  const dotTone  = tone === 'done' ? 'bg-emerald-500' : 'bg-pyramid-500'

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
        <h2 className={`font-semibold text-sm flex items-center gap-1.5 ${headTone}`}>
          {icon} {title}
        </h2>
        <span className="text-xs text-ink-400">
          {capped ? `${tasks.length}+` : tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="divide-y divide-ink-50 max-h-[420px] overflow-y-auto">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <TaskSkeleton key={i} />)
        ) : visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-ink-400 text-sm">
            {tone === 'done' ? 'Nothing completed yet.' : 'Nothing outstanding 🎉'}
          </div>
        ) : (
          visible.map(t => {
            const overdue = tone !== 'done' && t.due_date && new Date(t.due_date) < new Date()
            const dueStr = t.due_date
              ? new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : null
            return (
              <div key={t.id} className="flex items-start gap-3 px-5 py-3 hover:bg-ink-50 transition-colors">
                <div className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${overdue ? 'bg-red-500' : dotTone}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate ${tone === 'done' ? 'text-ink-500 line-through' : 'text-ink-800'}`}>
                    {t.task_name}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border
                      ${t.project?.division === 'regular'
                        ? 'bg-regular/10 text-regular border-regular/20'
                        : 'bg-ira/10 text-ira border-ira/20'
                      }`}>
                      {t.project?.project_number}
                    </span>
                    <span className="text-ink-400 text-xs truncate">{t.project?.project_address}</span>
                  </div>
                </div>
                {tone !== 'done' && dueStr && (
                  <span className={`flex-shrink-0 flex items-center gap-1 text-xs font-medium ${overdue ? 'text-red-500' : 'text-ink-400'}`}>
                    {overdue && <AlertCircle size={11} />}
                    {overdue ? 'Overdue' : dueStr}
                  </span>
                )}
              </div>
            )
          })
        )}
        {!loading && more > 0 && (
          <div className="px-5 py-2.5 text-center">
            <span className="text-xs text-ink-400">+ {more} more</span>
          </div>
        )}
      </div>
    </div>
  )
}
