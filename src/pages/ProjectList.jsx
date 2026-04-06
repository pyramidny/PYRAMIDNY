import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { Anchor, ChevronRight, HardHat, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'

const STATUSES = [
  'New Bid', 'Active Bid', 'No Bid', 'Bid Not Awarded',
  'Job Awarded', 'Active Job', 'Job Closed'
]

const STATUS_STYLES = {
  'New Bid':         'bg-ink-100 text-ink-600',
  'Active Bid':      'bg-blue-50 text-blue-700',
  'No Bid':          'bg-red-50 text-red-600',
  'Bid Not Awarded': 'bg-orange-50 text-orange-600',
  'Job Awarded':     'bg-emerald-50 text-emerald-700',
  'Active Job':      'bg-emerald-100 text-emerald-800',
  'Job Closed':      'bg-ink-100 text-ink-500',
}

const STAGE_LABELS = {
  1: 'Bidding', 2: 'Interview', 3: 'Awarded',
  4: 'Transfer', 5: 'Active', 6: 'Closeout'
}

export function ProjectList() {
  const { division: userDivision, isPM } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Division tab: use URL param if elevated, else lock to user's division
  const location     = useLocation()
  const divisionParam = searchParams.get('division')
  const activeDivision = userDivision ?? divisionParam ?? 'regular'

  useEffect(() => { fetchProjects() }, [activeDivision, statusFilter, location.key])

  async function fetchProjects() {
    setLoading(true)
    let query = supabase
      .from('projects')
      .select(`
        id, project_number, division, status, current_stage,
        project_address, scope_type, bid_amount, job_amount_contracted,
        due_date, job_award_date,
        pm:profiles!pm_id(display_name, full_name),
        estimator:profiles!estimator_id(display_name, full_name)
      `)
      .eq('division', activeDivision)
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    const { data, error } = await query
    if (!error && data) setProjects(data)
    setLoading(false)
  }

  const filtered = projects.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.project_number.toLowerCase().includes(q) ||
      p.project_address.toLowerCase().includes(q) ||
      p.scope_type?.toLowerCase().includes(q)
    )
  })

  function setDivision(div) {
    setSearchParams({ division: div })
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Page Header ──────────────────────────────── */}
      <div className="bg-white border-b border-ink-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-condensed font-bold text-ink-900 tracking-wide">
            Projects
          </h1>
          {isPM && (
            <Link to="/projects/new" className="btn-primary">
              <Plus size={16} />
              New Project
            </Link>
          )}
        </div>

        {/* Division Tabs — only shown if user has access to both */}
        {!userDivision && (
          <div className="flex gap-1 mb-4 bg-ink-100 rounded-lg p-1 w-fit">
            {[
              { key: 'regular', label: 'Regular', icon: <HardHat size={14} />, color: 'text-regular' },
              { key: 'ira',     label: 'IRA / Rope Access', icon: <Anchor size={14} />, color: 'text-ira' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setDivision(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${activeDivision === tab.key
                    ? `bg-white shadow-sm ${tab.color}`
                    : 'text-ink-500 hover:text-ink-700'
                  }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Search + Status filter */}
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              placeholder="Search projects…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="input w-auto pr-8 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            {STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Project Table ─────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <ProjectListSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState division={activeDivision} search={search} />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 border-b border-ink-200 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider w-28">
                  Project #
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider">
                  Address / Scope
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider w-32 hidden md:table-cell">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider w-28 hidden lg:table-cell">
                  Stage
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider w-32 hidden lg:table-cell">
                  PM
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wider w-32 hidden xl:table-cell">
                  Amount
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-ink-100">
              {filtered.map(project => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer count ─────────────────────────────── */}
      {!loading && (
        <div className="bg-white border-t border-ink-200 px-6 py-2.5 text-xs text-ink-400">
          Showing {filtered.length} of {projects.length} projects
        </div>
      )}
    </div>
  )
}

function ProjectRow({ project }) {
  const pm = project.pm?.display_name ?? project.pm?.full_name?.split(' ')[0] ?? '—'
  const amount = project.job_amount_contracted ?? project.bid_amount
  const isRegular = project.division === 'regular'

  return (
    <Link
      to={`/projects/${project.id}`}
      className="table-row group hover:bg-ink-50 transition-colors cursor-pointer"
    >
      {/* Project # */}
      <td className="px-4 py-3.5">
        <span className={`font-mono text-xs font-semibold px-2 py-1 rounded border
          ${isRegular
            ? 'bg-regular/8 text-regular border-regular/20'
            : 'bg-ira/8 text-ira border-ira/20'
          }`}>
          {project.project_number}
        </span>
      </td>

      {/* Address */}
      <td className="px-4 py-3.5">
        <div className="font-medium text-ink-800 truncate max-w-xs">
          {project.project_address}
        </div>
        {project.scope_type && (
          <div className="text-ink-400 text-xs mt-0.5">{project.scope_type}</div>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3.5 hidden md:table-cell">
        <span className={`status-pill ${STATUS_STYLES[project.status] ?? 'bg-ink-100 text-ink-500'}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
          {project.status}
        </span>
      </td>

      {/* Stage */}
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-ink-100 text-ink-600 text-[10px] font-bold flex items-center justify-center">
            {project.current_stage}
          </span>
          <span className="text-ink-500 text-xs">
            {STAGE_LABELS[project.current_stage]}
          </span>
        </div>
      </td>

      {/* PM */}
      <td className="px-4 py-3.5 hidden lg:table-cell text-ink-600 text-xs">{pm}</td>

      {/* Amount */}
      <td className="px-4 py-3.5 hidden xl:table-cell text-right">
        {amount ? (
          <span className="font-mono text-xs font-medium text-ink-700">
            {new Intl.NumberFormat('en-US', {
              style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1
            }).format(amount)}
          </span>
        ) : (
          <span className="text-ink-300 text-xs">—</span>
        )}
      </td>

      {/* Arrow */}
      <td className="px-2 py-3.5">
        <ChevronRight size={15} className="text-ink-300 group-hover:text-ink-500 transition-colors" />
      </td>
    </Link>
  )
}

function EmptyState({ division, search }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      {division === 'regular' ? (
        <HardHat size={40} className="text-ink-300 mb-4" />
      ) : (
        <Anchor size={40} className="text-ink-300 mb-4" />
      )}
      <h3 className="text-ink-600 font-semibold mb-1">
        {search ? 'No matching projects' : 'No projects yet'}
      </h3>
      <p className="text-ink-400 text-sm max-w-xs">
        {search
          ? `No projects match "${search}". Try a different search term.`
          : 'Projects will appear here once they are created.'
        }
      </p>
    </div>
  )
}

function ProjectListSkeleton() {
  return (
    <div className="bg-white divide-y divide-ink-100">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-6 w-20 bg-ink-100 rounded animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 bg-ink-100 rounded w-2/3 animate-pulse" />
            <div className="h-3 bg-ink-50 rounded w-1/3 animate-pulse" />
          </div>
          <div className="h-6 w-24 bg-ink-100 rounded-full animate-pulse hidden md:block" />
        </div>
      ))}
    </div>
  )
}