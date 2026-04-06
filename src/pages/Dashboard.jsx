import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  AlertCircle,
  Anchor,
  ArrowRight,
  ClipboardCheck,
  FolderOpen,
  HardHat,
  TrendingUp
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export function Dashboard() {
  const { profile, division } = useAuth()
  const [stats, setStats]     = useState(null)
  const [tasks, setTasks]     = useState([])
  const [loading, setLoading] = useState(true)

  const firstName = profile?.display_name ?? profile?.full_name?.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => { fetchData() }, [division])

  async function fetchData() {
    setLoading(true)
    try {
      // ── Project counts by status ───────────────────────────────────────
      let query = supabase.from('projects').select('status, division')
      if (division) query = query.eq('division', division)
      const { data: projects, error: projectsError } = await query

      if (projectsError) console.error('Projects query error:', projectsError)

      if (projects) {
        setStats({
          activeBids: projects.filter(p => p.status === 'Active Bid').length,
          activeJobs: projects.filter(p => p.status === 'Active Job').length,
          awarded:    projects.filter(p => p.status === 'Job Awarded').length,
          total:      projects.length,
          regular:    projects.filter(p => p.division === 'regular').length,
          ira:        projects.filter(p => p.division === 'ira').length,
        })
      }

      // ── My open tasks — safe user id lookup ───────────────────────────
      // supabase.auth.getUser() returns null for Azure AD tokens.
      // Fall back to the profile id from AuthContext instead.
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

    } catch (err) {
      console.error('Dashboard fetchData error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* ── Header ───────────────────────────────────── */}
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

      {/* ── Stat Cards ───────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Bids"
          value={stats?.activeBids}
          icon={<TrendingUp size={18} />}
          color="text-blue-500"
          bg="bg-blue-50"
          loading={loading}
        />
        <StatCard
          label="Active Jobs"
          value={stats?.activeJobs}
          icon={<HardHat size={18} />}
          color="text-emerald-600"
          bg="bg-emerald-50"
          loading={loading}
        />
        <StatCard
          label="Awarded"
          value={stats?.awarded}
          icon={<ClipboardCheck size={18} />}
          color="text-pyramid-600"
          bg="bg-pyramid-50"
          loading={loading}
        />
        <StatCard
          label="Total Projects"
          value={stats?.total}
          icon={<FolderOpen size={18} />}
          color="text-ink-500"
          bg="bg-ink-100"
          loading={loading}
        />
      </div>

      {/* ── Two-column grid ──────────────────────────── */}
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
            <DivisionBar
              division="regular"
              label="Regular Construction"
              prefix="P-"
              count={stats?.regular ?? 0}
              total={stats?.total ?? 1}
              color="bg-regular"
              textColor="text-regular"
              icon={<HardHat size={15} />}
              loading={loading}
            />
            <DivisionBar
              division="ira"
              label="IRA / Rope Access"
              prefix="A-"
              count={stats?.ira ?? 0}
              total={stats?.total ?? 1}
              color="bg-ira"
              textColor="text-ira"
              icon={<Anchor size={15} />}
              loading={loading}
            />
          </div>

          <div className="pt-2 border-t border-ink-100">
            <Link to="/projects" className="btn-primary w-full justify-center text-sm">
              View All Projects
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

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

function TaskRow({ task }) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()
  const dueStr = task.due_date
    ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="flex items-start gap-3 px-5 py-3.5 hover:bg-ink-50 transition-colors">
      <div className={`mt-0.5 flex-shrink-0 w-2 h-2 rounded-full
        ${task.status === 'overdue' || isOverdue ? 'bg-red-500' : 'bg-pyramid-500'}`}
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