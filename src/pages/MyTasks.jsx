// src/pages/MyTasks.jsx
// Route: /tasks
// Shows open tasks assigned to the current user OR on projects where they are PM.
// Supports three sort modes: due date, by project, overdue first.

import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
    AlertCircle,
    AlertTriangle,
    CalendarDays,
    CheckCircle2, ChevronRight,
    FolderOpen
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d) => {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const isOverdue = (d) => d && new Date(d) < new Date()

const STATUS_STYLES = {
  pending:    'bg-blue-50 text-blue-700 border-blue-200',
  in_progress:'bg-amber-50 text-amber-700 border-amber-200',
  overdue:    'bg-red-50 text-red-600 border-red-200',
  blocked:    'bg-orange-50 text-orange-600 border-orange-200',
  completed:  'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const STATUS_LABELS = {
  pending:     'Pending',
  in_progress: 'In Progress',
  overdue:     'Overdue',
  blocked:     'Blocked',
  completed:   'Completed',
}

const SORT_MODES = [
  { key: 'due_date',      label: 'Due Date',       icon: <CalendarDays size={13} /> },
  { key: 'by_project',    label: 'By Project',      icon: <FolderOpen size={13} /> },
  { key: 'overdue_first', label: 'Overdue First',   icon: <AlertTriangle size={13} /> },
]

// ── Main component ────────────────────────────────────────────────────────────

export function MyTasks() {
  const { profile }    = useAuth()
  const location       = useLocation()
  const [tasks,        setTasks]       = useState([])
  const [loading,      setLoading]     = useState(true)
  const [sortMode,     setSortMode]    = useState('overdue_first')
  const [statusFilter, setStatusFilter]= useState('open')

  useEffect(() => { if (profile?.id) fetchTasks() }, [profile?.id, location.key])

  async function fetchTasks() {
    setLoading(true)
    try {
      // Fetch tasks assigned to this user OR on projects where they are PM
      const { data, error } = await supabase
        .from('project_tasks')
        .select(`
          id, task_name, stage_number, due_date, status, notes,
          assigned_role, is_recurring, recurrence_type,
          project:projects(
            id, project_number, project_address, division,
            status, current_stage, pm_id
          )
        `)
        .or(`assigned_to_id.eq.${profile.id},project.pm_id.eq.${profile.id}`)
        .not('status', 'in', '("completed","skipped","na")')
        .order('due_date', { ascending: true, nullsFirst: false })

      if (error) {
        console.error('MyTasks fetch error:', error)
        // Fallback: fetch only directly assigned tasks
        const { data: fallback } = await supabase
          .from('project_tasks')
          .select(`
            id, task_name, stage_number, due_date, status, notes,
            assigned_role, is_recurring,
            project:projects(
              id, project_number, project_address, division,
              status, current_stage, pm_id
            )
          `)
          .eq('assigned_to_id', profile.id)
          .not('status', 'in', '("completed","skipped","na")')
          .order('due_date', { ascending: true, nullsFirst: false })

        if (fallback) setTasks(fallback)
      } else {
        if (data) setTasks(data)
      }
    } catch (err) {
      console.error('MyTasks unexpected error:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (statusFilter === 'open') return tasks
    if (statusFilter === 'overdue') return tasks.filter(t => isOverdue(t.due_date))
    return tasks.filter(t => t.status === statusFilter)
  }, [tasks, statusFilter])

  // ── Sorting ───────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const copy = [...filtered]

    if (sortMode === 'due_date') {
      return copy.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date) - new Date(b.due_date)
      })
    }

    if (sortMode === 'overdue_first') {
      return copy.sort((a, b) => {
        const aOver = isOverdue(a.due_date) ? 0 : 1
        const bOver = isOverdue(b.due_date) ? 0 : 1
        if (aOver !== bOver) return aOver - bOver
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date) - new Date(b.due_date)
      })
    }

    if (sortMode === 'by_project') {
      return copy.sort((a, b) => {
        const pa = a.project?.project_number ?? ''
        const pb = b.project?.project_number ?? ''
        if (pa !== pb) return pa.localeCompare(pb)
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date) - new Date(b.due_date)
      })
    }

    return copy
  }, [filtered, sortMode])

  // ── Group by project when in by_project mode ──────────────────────────────
  const grouped = useMemo(() => {
    if (sortMode !== 'by_project') return null
    const map = new Map()
    for (const task of sorted) {
      const key = task.project?.id ?? 'unknown'
      if (!map.has(key)) map.set(key, { project: task.project, tasks: [] })
      map.get(key).tasks.push(task)
    }
    return Array.from(map.values())
  }, [sorted, sortMode])

  // ── Stats ─────────────────────────────────────────────────────────────────
  const overdueCount = tasks.filter(t => isOverdue(t.due_date)).length
  const dueThisWeek  = tasks.filter(t => {
    if (!t.due_date) return false
    const d    = new Date(t.due_date)
    const now  = new Date()
    const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    return d >= now && d <= week
  }).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-ink-50">

      {/* ── Header ── */}
      <div className="bg-white border-b border-ink-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-condensed font-bold text-ink-900 tracking-wide">
              My Tasks
            </h1>
            <p className="text-xs text-ink-400 mt-0.5">
              {loading ? '…' : `${tasks.length} open task${tasks.length !== 1 ? 's' : ''}`}
              {overdueCount > 0 && (
                <span className="ml-2 text-red-500 font-semibold">
                  · {overdueCount} overdue
                </span>
              )}
              {dueThisWeek > 0 && (
                <span className="ml-2 text-amber-600 font-semibold">
                  · {dueThisWeek} due this week
                </span>
              )}
            </p>
          </div>
        </div>

        {/* ── Controls row ── */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Sort toggle */}
          <div className="flex rounded-lg overflow-hidden border border-ink-200 text-xs font-medium">
            {SORT_MODES.map(mode => (
              <button
                key={mode.key}
                onClick={() => setSortMode(mode.key)}
                className={`flex items-center gap-1.5 px-3 py-2 transition-colors
                  ${sortMode === mode.key
                    ? 'bg-ink-900 text-white'
                    : 'text-ink-500 hover:text-ink-700 hover:bg-ink-50'
                  }`}
              >
                {mode.icon}
                {mode.label}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="input text-xs py-1.5 w-auto pr-8 cursor-pointer"
          >
            <option value="open">All Open</option>
            <option value="overdue">Overdue Only</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <TaskListSkeleton />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : sortMode === 'by_project' && grouped ? (
          // ── Grouped by project ──
          <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
            {grouped.map(({ project, tasks: ptasks }) => (
              <div key={project?.id ?? 'unknown'}>
                {/* Project group header */}
                <div className="flex items-center gap-3 mb-3">
                  <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded border
                    ${project?.division === 'regular'
                      ? 'bg-regular/10 text-regular border-regular/20'
                      : 'bg-ira/10 text-ira border-ira/20'
                    }`}>
                    {project?.project_number ?? '—'}
                  </span>
                  <span className="text-sm font-semibold text-ink-700 truncate">
                    {project?.project_address ?? 'Unknown project'}
                  </span>
                  <span className="ml-auto text-xs text-ink-400 flex-shrink-0">
                    {ptasks.length} task{ptasks.length !== 1 ? 's' : ''}
                  </span>
                  <Link
                    to={`/projects/${project?.id}`}
                    className="flex-shrink-0 text-pyramid-600 hover:text-pyramid-500 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </Link>
                </div>
                {/* Tasks under this project */}
                <div className="bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm">
                  {ptasks.map((task, i) => (
                    <TaskRow key={task.id} task={task} showProject={false} last={i === ptasks.length - 1} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // ── Flat list ──
          <div className="max-w-4xl mx-auto px-6 py-6">
            <div className="bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm">
              {sorted.map((task, i) => (
                <TaskRow key={task.id} task={task} showProject last={i === sorted.length - 1} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Task Row ──────────────────────────────────────────────────────────────────

function TaskRow({ task, showProject, last }) {
  const overdue  = isOverdue(task.due_date)
  const dueStr   = fmtDate(task.due_date)
  const isReg    = task.project?.division === 'regular'

  return (
    <Link
      to={`/projects/${task.project?.id}`}
      className={`flex items-start gap-4 px-5 py-4 hover:bg-ink-50 transition-colors
        ${!last ? 'border-b border-ink-100' : ''}`}
    >
      {/* Overdue indicator */}
      <div className={`flex-shrink-0 mt-0.5 w-2 h-2 rounded-full
        ${overdue ? 'bg-red-500' : 'bg-pyramid-400'}`}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-medium text-ink-800 leading-snug">
            {task.task_name}
          </span>
          {/* Status pill */}
          <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5
            rounded-full border whitespace-nowrap
            ${overdue
              ? STATUS_STYLES.overdue
              : STATUS_STYLES[task.status] ?? STATUS_STYLES.pending
            }`}>
            {overdue ? 'Overdue' : STATUS_LABELS[task.status] ?? task.status}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {/* Project badge */}
          {showProject && task.project && (
            <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border
              ${isReg
                ? 'bg-regular/10 text-regular border-regular/20'
                : 'bg-ira/10 text-ira border-ira/20'
              }`}>
              {task.project.project_number}
            </span>
          )}
          {showProject && task.project && (
            <span className="text-xs text-ink-400 truncate max-w-[200px]">
              {task.project.project_address}
            </span>
          )}
          {/* Stage */}
          <span className="text-xs text-ink-400">
            Stage {task.stage_number}
          </span>
          {/* Recurring badge */}
          {task.is_recurring && (
            <span className="text-[10px] text-ink-400 border border-ink-200 rounded px-1.5 py-0.5">
              Recurring
            </span>
          )}
        </div>

        {/* Notes preview */}
        {task.notes && (
          <p className="text-xs text-ink-400 mt-1 truncate">{task.notes}</p>
        )}
      </div>

      {/* Due date */}
      <div className="flex-shrink-0 text-right">
        {dueStr ? (
          <span className={`flex items-center gap-1 text-xs font-medium
            ${overdue ? 'text-red-500' : 'text-ink-400'}`}>
            {overdue && <AlertCircle size={11} />}
            {dueStr}
          </span>
        ) : (
          <span className="text-xs text-ink-300">No due date</span>
        )}
      </div>
    </Link>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
        <CheckCircle2 size={28} className="text-emerald-500" />
      </div>
      <h3 className="text-ink-700 font-semibold text-lg mb-1">You're all caught up!</h3>
      <p className="text-ink-400 text-sm max-w-xs">
        No open tasks right now. New tasks will appear here as projects move through stages.
      </p>
      <Link to="/projects" className="mt-6 btn-primary text-sm">
        View Projects
      </Link>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function TaskListSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <div className="bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-ink-100 last:border-0">
            <div className="w-2 h-2 rounded-full bg-ink-100 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-ink-100 rounded w-2/3 animate-pulse" />
              <div className="h-3 bg-ink-50 rounded w-1/3 animate-pulse" />
            </div>
            <div className="h-3 w-20 bg-ink-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
