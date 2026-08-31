// src/pages/ToolControl.jsx
// Route: /tools  —  Phase B: wired to Supabase.
//   Reads  : direct authenticated selects (RLS) on tools / tool_transactions
//            + profiles (techs) + projects (jobs).
//   Writes : project-proxy tool actions (enroll / checkout / checkin /
//            maintenance / retire), Azure-AD token from localStorage.
// Internal tabs are driven by ?tab= so the mobile bottom bar (Layout.jsx)
// and the desktop top-tab strip share the same state.
// Access: everyone can scan / view. Enrolling tools is gated to
//   isAdmin || profile.role === 'tool_manager'.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ScanLine, LayoutGrid, ClipboardList, Plus, Printer, Wrench,
  Camera, X, Search
} from 'lucide-react'
import QRCode from 'qrcode'
import { Html5Qrcode } from 'html5-qrcode'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

/* ---------------------------------------------------------------- config */
const DAY = 86400000
const OVERDUE_DAYS = 3
const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-proxy`
const SP_TOKEN_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

/* ---------------------------------------------------------------- helpers */
const toBase64List = (photos) => (photos || []).map((d) => String(d).split(',')[1]).filter(Boolean)


// Runtime tech index (profile id -> {name, initials}), filled on each load so
// the presentational atoms below can stay id-based without prop drilling.
let TECH_INDEX = {}
const initialsOf = (name) =>
  (name || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—'
const tName = (id) => TECH_INDEX[id]?.name ?? '—'
const tInit = (id) => TECH_INDEX[id]?.initials ?? '—'

const isOverdue = (t) => {
  if (t.status !== 'out') return false
  if (t.expectedReturnDate) return Date.now() > Date.parse(t.expectedReturnDate + 'T23:59:59')
  return Date.now() - t.lastActionAt > OVERDUE_DAYS * DAY
}
const money = (n) => '$' + Number(n || 0).toLocaleString()
function ago(ts) {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  const d = Math.floor(s / 86400)
  return d + (d === 1 ? ' day ago' : ' days ago')
}
const STATUS = {
  available: { label: 'Available', cls: 'bg-emerald-100 text-emerald-700' },
  out: { label: 'Checked out', cls: 'bg-pyramid-50 text-pyramid-600' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-100 text-amber-700' },
  retired: { label: 'Retired', cls: 'bg-ink-200 text-ink-600' },
}
const dotColor = (st) =>
  st === 'available' ? 'bg-emerald-500' : st === 'out' ? 'bg-pyramid-500'
    : st === 'retired' ? 'bg-ink-400' : 'bg-amber-500'

// Adapt a DB tools row (+ lookups) into the shape the render expects.
function adaptTool(row, projLabel, lastCond, lastPhoto, outInfo) {
  return {
    id: row.id,
    assetId: row.asset_id,
    name: row.name,
    manufacturer: row.manufacturer ?? '',
    model: row.model ?? '',
    serial: row.serial ?? '',
    value: row.replacement_value ?? 0,
    category: row.category ?? '—',
    notes: row.notes ?? '',
    status: row.status,
    holder: row.current_holder_id ?? null,
    jobSite: row.current_project_id ? (projLabel[row.current_project_id] ?? 'Job') : 'Tool Crib',
    lastActionAt: Date.parse(row.updated_at),
    condition: lastCond ?? 'Good',
    photo: lastPhoto ?? null,
    photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
    expectedReturnDate: outInfo?.expectedReturnDate ?? null,
  }
}

/* ---------------------------------------------------------------- atoms */
function Pill({ tool }) {
  const s = STATUS[tool.status] ?? STATUS.available
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
      {isOverdue(tool) && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">Overdue</span>}
    </span>
  )
}
function Avatar({ id, size = 36 }) {
  return (
    <div className="rounded-full bg-ink-900 text-white grid place-items-center font-semibold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}>{tInit(id)}</div>
  )
}
function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-widest uppercase text-ink-400 mb-0.5">{label}</div>
      <div className="text-sm text-ink-800">{children}</div>
    </div>
  )
}

// Up to `max` photos, captured from camera or file. Value is an array of data URLs.
function PhotoPicker({ photos, onChange, max = 2, label = 'Photos (optional)' }) {
  const add = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = () => onChange([...(photos || []), r.result].slice(0, max))
    r.readAsDataURL(file)
    e.target.value = ''
  }
  const remove = (i) => onChange((photos || []).filter((_, idx) => idx !== i))
  const count = photos?.length || 0
  return (
    <div>
      <div className="text-[13px] font-semibold text-ink-500 mb-1.5">{label} <span className="text-ink-400 font-normal">({count}/{max})</span></div>
      <div className="flex items-center gap-2 flex-wrap">
        {(photos || []).map((src, i) => (
          <div key={i} className="relative">
            <img src={src} alt={`photo ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-ink-200" />
            <button type="button" onClick={() => remove(i)}
              className="absolute -top-1.5 -right-1.5 bg-ink-900 text-white rounded-full w-5 h-5 grid place-items-center text-[12px] leading-none">×</button>
          </div>
        ))}
        {count < max && (
          <label className="inline-flex items-center gap-2 bg-white border border-ink-200 rounded-lg px-3 py-2.5 text-ink-700 cursor-pointer">
            <Camera size={18} className="text-ink-400" /> {count ? 'Add' : 'Take photo'}
            <input type="file" accept="image/*" capture="environment" onChange={add} className="hidden" />
          </label>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- page */
export default function ToolControl() {
  const { isAdmin, profile } = useAuth()
  // Tool ADMIN tier only — see the note in Layout.jsx. Tool Tech keeps scan,
  // checkout and activity, which are open to any authenticated user.
  const canManage =
    isAdmin || profile?.tool_access === 'admin' || profile?.role === 'tool_manager'

  const [params, setParams] = useSearchParams()
  let tab = params.get('tab') || 'scan'
  if (tab === 'enroll' && !canManage) tab = 'scan'
  const setTab = (t) => setParams({ tab: t }, { replace: true })

  const [tools, setTools] = useState([])
  const [activity, setActivity] = useState([])
  const [techs, setTechs] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [sheetMode, setSheetMode] = useState(null)
  const [tagId, setTagId] = useState(null)
  const [toast, setToast] = useState(null)

  const openTool = tools.find((t) => t.assetId === openId) || null
  const tagTool = tools.find((t) => t.assetId === tagId) || null

  function flash(msg) { setToast(msg); clearTimeout(flash._t); flash._t = setTimeout(() => setToast(null), 2600) }

  // Azure-AD access token for proxy writes (session.access_token is null for MS JWTs).
  const getAccessToken = useCallback(() => {
    try { const raw = localStorage.getItem(SP_TOKEN_KEY); return raw ? JSON.parse(raw)?.access_token : null }
    catch { return null }
  }, [])
  const getProviderToken = useCallback(() => {
    try { const raw = localStorage.getItem(SP_TOKEN_KEY); return raw ? JSON.parse(raw)?.provider_token : null }
    catch { return null }
  }, [])
  const proxy = useCallback(async (body) => {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Proxy error ${res.status}`)
    return json.data
  }, [getAccessToken])

  /* ---- data load ---- */
  const reload = useCallback(async () => {
    const withTimeout = (pr, ms = 12000) => Promise.race([
      pr, new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out loading tools. Tap Retry.')), ms)),
    ])
    const [toolsRes, txRes, profRes, projRes] = await withTimeout(Promise.all([
      supabase.from('tools').select('*').order('asset_id', { ascending: true }),
      supabase.from('tool_transactions').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('profiles').select('id, full_name, display_name, is_active').eq('is_active', true),
      supabase.from('projects').select('id, project_number, project_address').order('project_number', { ascending: true }),
    ]))
    if (toolsRes.error) throw toolsRes.error

    const profRows = profRes.data ?? []
    TECH_INDEX = Object.fromEntries(profRows.map((p) => {
      const name = p.display_name || p.full_name || '—'
      return [p.id, { name, initials: initialsOf(name) }]
    }))
    setTechs(profRows.map((p) => ({ id: p.id, name: p.display_name || p.full_name || '—' })))

    const projRows = projRes.data ?? []
    const projLabel = Object.fromEntries(projRows.map((p) => [p.id, `${p.project_number} — ${p.project_address ?? ''}`.trim()]))
    setJobs(projRows.map((p) => ({ id: p.id, label: `${p.project_number} — ${p.project_address ?? ''}`.trim() })))

    // Derive per-tool last condition / photo / latest-out info from the ledger.
    const txRows = txRes.data ?? []
    const lastCond = {}, lastPhoto = {}, outInfo = {}
    for (const tx of txRows) { // already newest-first
      if (tx.condition && !(tx.tool_id in lastCond)) lastCond[tx.tool_id] = tx.condition
      if (tx.photo_url && !(tx.tool_id in lastPhoto)) lastPhoto[tx.tool_id] = tx.photo_url
      if (tx.action === 'out' && !(tx.tool_id in outInfo)) outInfo[tx.tool_id] = { expectedReturnDate: tx.expected_return_date ?? null }
    }

    const toolRows = toolsRes.data ?? []
    const nameById = Object.fromEntries(toolRows.map((r) => [r.id, r.name]))
    const assetById = Object.fromEntries(toolRows.map((r) => [r.id, r.asset_id]))

    setTools(toolRows.map((r) => adaptTool(r, projLabel, lastCond[r.id], lastPhoto[r.id], outInfo[r.id])))
    setActivity(txRows.map((tx) => ({
      id: tx.id,
      ts: Date.parse(tx.created_at),
      assetId: assetById[tx.tool_id] ?? '—',
      toolName: nameById[tx.tool_id] ?? 'Tool',
      action: tx.action,
      techId: tx.profile_id,
      jobSite: tx.project_id ? (projLabel[tx.project_id] ?? 'Job') : 'Tool Crib',
      condition: tx.condition,
      note: tx.note ?? '',
    })))
  }, [])

  const loadTools = useCallback(async () => {
    setLoading(true); setLoadErr(null)
    try { await reload() } catch (e) { setLoadErr(e.message || 'Failed to load tools') }
    finally { setLoading(false) }
  }, [reload])
  useEffect(() => { loadTools() }, [loadTools])

  const counts = useMemo(() => ({
    out: tools.filter((t) => t.status === 'out').length,
    avail: tools.filter((t) => t.status === 'available').length,
    maint: tools.filter((t) => t.status === 'maintenance').length,
    over: tools.filter(isOverdue).length,
  }), [tools])

  const nextId = useMemo(() => {
    const n = tools.reduce((m, t) => {
      const v = parseInt(String(t.assetId).replace('PYR-', ''), 10)
      return isNaN(v) ? m : Math.max(m, v)
    }, 0) + 1
    return 'PYR-' + String(n).padStart(4, '0')
  }, [tools])

  /* ---- actions (proxy → reload) ---- */
  async function checkout(t, { tech, job, note, expectedReturnDate, photos }) {
    try {
      await proxy({ action: 'checkout_tool', toolId: t.id, profileId: tech, jobProjectId: job || null, expectedReturnDate: expectedReturnDate || null, note, photos: toBase64List(photos), providerToken: getProviderToken() })
      await reload(); setOpenId(null); setSheetMode(null); flash(`${t.name} checked out to ${tName(tech)}`)
    } catch (e) { flash(e.message) }
  }
  async function checkin(t, { cond, note, photos }) {
    try {
      await proxy({ action: 'checkin_tool', toolId: t.id, condition: cond, note, photos: toBase64List(photos), providerToken: getProviderToken(), toMaintenance: cond === 'Damaged' })
      await reload(); setOpenId(null); setSheetMode(null); flash(`${t.name} checked in · ${cond}`)
    } catch (e) { flash(e.message) }
  }
  async function maint(t) {
    try {
      await proxy({ action: 'tool_maintenance', toolId: t.id, condition: 'Needs attention' })
      await reload(); setOpenId(null); setSheetMode(null); flash(`${t.name} sent to maintenance`)
    } catch (e) { flash(e.message) }
  }
  async function returnService(t) {
    try {
      await proxy({ action: 'tool_maintenance', toolId: t.id, back: true, condition: 'Good', note: 'Returned from service.' })
      await reload(); setOpenId(null); flash(`${t.name} returned to service`)
    } catch (e) { flash(e.message) }
  }
  async function enroll(data) {
    try {
      const created = await proxy({
        action: 'enroll_tool',
        tool: {
          name: data.name, manufacturer: data.manufacturer,
          model: data.model, serial: data.serial, category: data.category,
          // strip $ and commas so "$650" saves as 650, not NaN -> 0
          replacement_value: Number(String(data.value ?? '').replace(/[^0-9.]/g, '')) || 0,
        },
        photos: toBase64List(data.photos),
        providerToken: getProviderToken(),
      })
      const newId = created?.asset_id
      setTab('tools'); if (newId) setTagId(newId); flash(`${newId ?? 'Tool'} enrolled`)
      reload().catch(() => {})   // refresh list in the background; never blocks the tag
    } catch (e) { flash(e.message) }
  }
  function resolve(code) {
    const hit = tools.find((t) => t.assetId.toLowerCase() === String(code).trim().toLowerCase())
    if (hit) { setOpenId(hit.assetId); setSheetMode(null) }
    else alert(`No tool found for "${code}". Try an asset ID like PYR-0003.`)
  }

  const DESKTOP_TABS = [
    { k: 'scan', label: 'Scan', icon: ScanLine },
    { k: 'tools', label: 'Tools', icon: LayoutGrid },
    { k: 'activity', label: 'Activity', icon: ClipboardList },
    ...(canManage ? [{ k: 'enroll', label: 'Add', icon: Plus }] : []),
  ]

  return (
    <div className="min-h-full bg-ink-50">
      {/* Header + live counts */}
      <div className="bg-white border-b border-ink-200 px-6 pt-5 pb-0">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-condensed font-bold text-ink-900 tracking-wide">Tool Control</h1>
              <p className="text-ink-400 text-sm mt-0.5">Scan a tag to check tools out and in.</p>
            </div>
            <div className="hidden sm:flex gap-2">
              <Stat label="Out" value={counts.out} tone="text-pyramid-600" />
              <Stat label="Available" value={counts.avail} tone="text-emerald-600" />
              <Stat label="Maint." value={counts.maint} tone="text-amber-600" />
              <Stat label="Overdue" value={counts.over} tone="text-red-600" />
            </div>
          </div>

          {/* Desktop top-tab strip (mobile uses the swapped bottom bar) */}
          <div className="hidden lg:flex gap-1 mt-4">
            {DESKTOP_TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
                  ${tab === t.k ? 'border-pyramid-500 text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-700'}`}>
                <t.icon size={16} className={tab === t.k ? 'text-pyramid-500' : ''} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center text-ink-400 py-20">Loading tools…</div>
        ) : loadErr ? (
          <div className="text-center py-20">
            <div className="text-ink-500 mb-3">{loadErr}</div>
            <button onClick={loadTools} className="btn-primary">Retry</button>
          </div>
        ) : (
          <>
            {tab === 'scan' && <ScanTab tools={tools} onResolve={resolve} />}
            {tab === 'tools' && <ToolsTab tools={tools} onOpen={(id) => { setOpenId(id); setSheetMode(null) }} />}
            {tab === 'activity' && <ActivityTab activity={activity} />}
            {tab === 'enroll' && canManage && <EnrollTab nextId={nextId} onEnroll={enroll} />}
          </>
        )}
      </div>

      {openTool && (
        <ToolSheet
          tool={openTool} mode={sheetMode} setMode={setSheetMode}
          techs={techs} jobs={jobs}
          onClose={() => { setOpenId(null); setSheetMode(null) }}
          onCheckout={checkout} onCheckin={checkin} onMaint={maint}
          onReturn={returnService} onPrint={() => setTagId(openTool.assetId)}
        />
      )}
      {tagTool && <TagModal tool={tagTool} onClose={() => setTagId(null)} />}

      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 bg-ink-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="w-20 rounded-lg bg-ink-50 border border-ink-200 px-2 py-1.5 text-center">
      <div className={`font-condensed text-xl font-bold leading-none ${tone}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- Scan tab */
function ScanTab({ tools, onResolve }) {
  const [camState, setCamState] = useState('idle') // idle | running | error
  const [manual, setManual] = useState('')
  const scannerRef = useRef(null)

  useEffect(() => () => stop(), [])
  function stop() {
    const s = scannerRef.current
    if (s) { s.stop().then(() => s.clear()).catch(() => {}); scannerRef.current = null }
  }
  async function start() {
    try {
      const s = new Html5Qrcode('tc-reader')
      scannerRef.current = s
      await s.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } },
        (decoded) => { stop(); setCamState('idle'); onResolve(decoded.trim()) }, () => {})
      setCamState('running')
    } catch { setCamState('error') }
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="relative bg-ink-950 rounded-2xl overflow-hidden aspect-square mb-3">
        <div id="tc-reader" className="w-full h-full" />
        <div className="pointer-events-none absolute inset-0">
          {['top-4 left-4 border-l-2 border-t-2', 'top-4 right-4 border-r-2 border-t-2', 'bottom-4 left-4 border-l-2 border-b-2', 'bottom-4 right-4 border-r-2 border-b-2']
            .map((c, i) => <span key={i} className={`absolute w-8 h-8 rounded border-pyramid-500 ${c}`} />)}
        </div>
        {camState !== 'running' && (
          <div className="absolute inset-0 grid place-items-center text-center px-6">
            <div>
              <p className="text-ink-400 text-sm mb-4">Camera is off</p>
              <button onClick={start} className="btn-primary inline-flex items-center gap-2 text-sm">
                <Camera size={18} /> Start camera
              </button>
            </div>
          </div>
        )}
      </div>

      {camState === 'error' && (
        <div className="bg-amber-50 text-amber-700 text-[13px] rounded-xl px-4 py-3 mb-3">
          Camera needs a secure (HTTPS) connection and permission. Use the tags below or manual entry.
        </div>
      )}

      <div className="card p-4 mb-4">
        <div className="text-[10px] uppercase tracking-widest text-ink-400 font-semibold mb-2">Enter asset ID manually</div>
        <div className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="PYR-0003" className="input font-mono" />
          <button onClick={() => manual.trim() && onResolve(manual.trim())} className="btn-primary px-5">Go</button>
        </div>
      </div>

      <div className="text-[10px] uppercase tracking-widest text-ink-400 font-semibold mb-2">Or tap a tag to simulate a scan</div>
      <div className="flex flex-wrap gap-2">
        {tools.slice(0, 6).map((t) => (
          <button key={t.assetId} onClick={() => onResolve(t.assetId)}
            className="font-mono text-[12px] bg-white border border-ink-200 rounded-lg px-3 py-2 text-ink-700">
            {t.assetId}
            <span className={`ml-2 inline-block w-2 h-2 rounded-full align-middle ${dotColor(t.status)}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Tools tab */
function ToolsTab({ tools, onOpen }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const list = useMemo(() => tools.filter((t) => {
    if (filter === 'overdue') { if (!isOverdue(t)) return false }
    else if (filter !== 'all' && t.status !== filter) return false
    if (!q) return true
    return (t.name + ' ' + t.assetId + ' ' + t.serial + ' ' + t.manufacturer + ' ' + t.model).toLowerCase().includes(q.toLowerCase())
  }), [tools, q, filter])

  const chips = [['all', 'All'], ['available', 'Available'], ['out', 'Out'], ['overdue', 'Overdue'], ['maintenance', 'Maint.']]
  return (
    <div>
      <div className="relative max-w-md mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, serial, asset ID…" className="input pl-9" />
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {chips.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border
              ${filter === k ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-500 border-ink-200'}`}>{l}</button>
        ))}
      </div>

      {list.length === 0 && <div className="text-center text-ink-400 py-16">No tools match that.</div>}
      <div className="space-y-2.5">
        {list.map((t) => (
          <button key={t.assetId} onClick={() => onOpen(t.assetId)}
            className="card w-full p-3.5 flex items-center gap-3 text-left hover:border-ink-300 transition-colors">
            <div className="w-11 h-11 rounded-lg bg-ink-50 grid place-items-center flex-shrink-0">
              <span className={`w-2.5 h-2.5 rounded-full ${dotColor(t.status)}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-ink-400">{t.assetId}</span>
                {isOverdue(t) && <span className="text-[10px] font-bold text-red-600">OVERDUE</span>}
              </div>
              <div className="font-condensed text-[17px] font-semibold text-ink-900 leading-tight truncate">{t.name}</div>
              <div className="text-[12.5px] text-ink-400 truncate">
                {t.status === 'out' ? `${tName(t.holder)} · ${t.jobSite}` : `${t.manufacturer} ${t.model}`}
              </div>
            </div>
            <Pill tool={t} />
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Activity tab */
function ActivityTab({ activity }) {
  const META = {
    out: ['text-pyramid-600', 'Checked out'], in: ['text-emerald-600', 'Checked in'],
    maintenance: ['text-amber-600', 'To maintenance'], enrolled: ['text-ink-700', 'Enrolled'],
    retired: ['text-ink-500', 'Retired'],
  }
  return (
    <div className="max-w-2xl">
      {activity.length === 0 && <div className="text-center text-ink-400 py-16">No activity yet.</div>}
      <div className="space-y-2.5">
        {activity.map((a) => {
          const m = META[a.action] || META.out
          return (
            <div key={a.id} className="card p-3.5 flex gap-3">
              <Avatar id={a.techId} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[12px] font-bold uppercase tracking-wide ${m[0]}`}>{m[1]}</span>
                  <span className="text-[11px] text-ink-400">{ago(a.ts)}</span>
                </div>
                <div className="font-condensed text-[16px] font-semibold text-ink-900 leading-tight">
                  {a.toolName} <span className="font-mono text-[12px] text-ink-400 font-normal">{a.assetId}</span>
                </div>
                <div className="text-[12.5px] text-ink-400">
                  {tName(a.techId)} · {a.jobSite}{a.condition ? ` · ${a.condition}` : ''}
                </div>
                {a.note && <div className="text-[12.5px] text-ink-500 italic mt-0.5">“{a.note}”</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Enroll tab */
function EnrollTab({ nextId, onEnroll }) {
  const [f, setF] = useState({ name: '', manufacturer: '', model: '', serial: '', value: '', category: 'Power tool' })
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const ready = f.name.trim() && f.serial.trim() && !busy
  const fields = [
    ['name', 'Tool name', 'e.g. Hammer Drill'], ['manufacturer', 'Manufacturer', 'e.g. Milwaukee'],
    ['model', 'Model', 'e.g. 2904-20'], ['serial', 'Serial number', 'from the nameplate'],
    ['value', 'Replacement value ($)', '329'],
  ]
  return (
    <div className="max-w-md">
      <div className="card p-4 mb-4 bg-ink-900 text-white flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-white/60">Will be assigned</span>
        <span className="font-mono text-xl font-bold text-pyramid-500">{nextId}</span>
      </div>
      <div className="card p-4 space-y-3">
        {fields.map(([k, label, ph]) => (
          <label key={k} className="block text-[13px] font-semibold text-ink-500">{label}
            <input value={f[k]} onChange={set(k)} placeholder={ph}
              className={`input mt-1 font-normal ${k === 'serial' ? 'font-mono' : ''}`} />
          </label>
        ))}
        <label className="block text-[13px] font-semibold text-ink-500">Category
          <select value={f.category} onChange={set('category')} className="input mt-1 font-normal">
            {['Power tool', 'Equipment', 'Instrument', 'Hand tool'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <PhotoPicker photos={photos} onChange={setPhotos} label="Tool photos" />
        <button disabled={!ready} onClick={async () => { setBusy(true); await onEnroll({ ...f, photos }); setBusy(false) }}
          className="btn-primary w-full disabled:opacity-50">{busy ? 'Enrolling…' : 'Enroll & print tag'}</button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Tool sheet */
function ToolSheet({ tool, mode, setMode, techs, jobs, onClose, onCheckout, onCheckin, onMaint, onReturn, onPrint }) {
  const [tech, setTech] = useState(techs[0]?.id ?? '')
  const [job, setJob] = useState('')
  const [exp, setExp] = useState('')
  const [note, setNote] = useState('')
  const [cond, setCond] = useState('Good')
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)

  const run = (fn) => async () => { setBusy(true); await fn(); setBusy(false) }

  return (
    <div className="fixed inset-0 z-40 bg-ink-950/60 flex items-end sm:items-center sm:justify-center">
      <div className="bg-ink-50 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-ink-950 text-white px-5 py-4 flex items-start justify-between">
          <div className="min-w-0">
            <div className="font-mono text-pyramid-500 text-sm font-bold">{tool.assetId}</div>
            <h2 className="font-condensed text-2xl font-bold leading-tight truncate">{tool.name}</h2>
            <div className="text-white/60 text-[13px]">{tool.manufacturer} {tool.model}</div>
          </div>
          <button className="text-white/70 flex-shrink-0 ml-3" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <Pill tool={tool} />
            <button onClick={onPrint} className="text-sm font-semibold text-ink-900 flex items-center gap-1.5"><Printer size={16} /> Print tag</button>
          </div>

          {tool.status === 'out' && (
            <div className="card p-4 flex items-center gap-3">
              <Avatar id={tool.holder} size={40} />
              <div className="min-w-0">
                <div className="font-semibold text-ink-900">{tName(tool.holder)}</div>
                <div className="text-[13px] text-ink-400 truncate">{tool.jobSite} · out {ago(tool.lastActionAt)}</div>
              </div>
            </div>
          )}

          <div className="card p-4 grid grid-cols-2 gap-4">
            <Field label="Serial number"><span className="font-mono text-[13px]">{tool.serial}</span></Field>
            <Field label="Category">{tool.category}</Field>
            <Field label="Replacement value">{money(tool.value)}</Field>
            <Field label="Last condition">{tool.condition}</Field>
            <Field label="Last seen">{ago(tool.lastActionAt)}</Field>
            <Field label="Location">{tool.jobSite}</Field>
          </div>

          {tool.notes && <div className="card p-4"><Field label="Notes">{tool.notes}</Field></div>}

          {tool.photoUrls?.length > 0 && (
            <div className="card p-4">
              <Field label="Tool photos">
                <div className="flex gap-2 flex-wrap mt-1">
                  {tool.photoUrls.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer"
                      className="w-16 h-16 rounded-lg border border-ink-200 bg-ink-100 grid place-items-center text-[11px] font-semibold text-ink-500 hover:border-ink-300">
                      Photo {i + 1}
                    </a>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {mode === null && (
            <div className="space-y-2.5">
              {tool.status === 'available' && <button onClick={() => setMode('out')} className="btn-primary w-full">Check out</button>}
              {tool.status === 'out' && <button onClick={() => setMode('in')} className="w-full py-3 rounded-lg font-semibold text-white bg-emerald-600 hover:bg-emerald-500">Check in</button>}
              {tool.status !== 'maintenance' && tool.status !== 'retired' && (
                <button onClick={run(() => onMaint(tool))} disabled={busy} className="w-full py-3 rounded-lg font-semibold text-amber-700 bg-white border border-amber-300 flex items-center justify-center gap-2 disabled:opacity-50">
                  <Wrench size={16} /> Send to maintenance
                </button>
              )}
              {tool.status === 'maintenance' && <button onClick={run(() => onReturn(tool))} disabled={busy} className="w-full py-3 rounded-lg font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">Return to service (Available)</button>}
            </div>
          )}

          {mode === 'out' && (
            <div className="card p-4 space-y-3">
              <div className="font-condensed text-lg font-bold text-ink-900">Check out to…</div>
              <label className="block text-[13px] font-semibold text-ink-500">Technician
                <select value={tech} onChange={(e) => setTech(e.target.value)} className="input mt-1 font-normal">
                  {techs.length === 0 && <option value="">No staff found</option>}
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="block text-[13px] font-semibold text-ink-500">Job site
                <select value={job} onChange={(e) => setJob(e.target.value)} className="input mt-1 font-normal">
                  <option value="">— No job / Tool Crib —</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                </select>
              </label>
              <label className="block text-[13px] font-semibold text-ink-500">Expected return (optional)
                <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} className="input mt-1 font-normal" />
              </label>
              <label className="block text-[13px] font-semibold text-ink-500">Note (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. needs charged battery" className="input mt-1 font-normal" />
              </label>
              <PhotoPicker photos={photos} onChange={setPhotos} label="Condition photos" />
              <div className="flex gap-2 pt-1">
                <button onClick={() => setMode(null)} className="btn-secondary flex-1">Cancel</button>
                <button disabled={busy || !tech} onClick={run(() => onCheckout(tool, { tech, job, note, expectedReturnDate: exp, photos }))} className="btn-primary flex-[2] disabled:opacity-50">{busy ? 'Saving…' : 'Confirm check out'}</button>
              </div>
            </div>
          )}

          {mode === 'in' && (
            <div className="card p-4 space-y-3">
              <div className="font-condensed text-lg font-bold text-ink-900">Check in</div>
              <div>
                <div className="text-[13px] font-semibold text-ink-500 mb-1.5">Condition on return</div>
                <div className="grid grid-cols-3 gap-2">
                  {['Good', 'Needs attention', 'Damaged'].map((c) => (
                    <button key={c} onClick={() => setCond(c)}
                      className={`py-2 rounded-lg text-[12.5px] font-semibold border ${cond === c ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-500 border-ink-200'}`}>{c}</button>
                  ))}
                </div>
                {cond === 'Damaged' && <div className="text-[12px] text-amber-700 mt-2">Damaged tools are routed to maintenance on check-in.</div>}
              </div>
              <PhotoPicker photos={photos} onChange={setPhotos} label="Photos on return" />
              <label className="block text-[13px] font-semibold text-ink-500">Note (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. chuck sticking" className="input mt-1 font-normal" />
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setMode(null)} className="btn-secondary flex-1">Cancel</button>
                <button disabled={busy} onClick={run(() => onCheckin(tool, { cond, note, photos }))} className="flex-[2] py-3 rounded-lg font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">{busy ? 'Saving…' : 'Confirm check in'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Tag modal */
function TagModal({ tool, onClose }) {
  const canvasRef = useRef(null)       // on-screen preview
  const printRef = useRef(null)        // hidden print label
  useEffect(() => {
    const opts = { errorCorrectionLevel: 'H', width: 150, margin: 1 }
    if (canvasRef.current) QRCode.toCanvas(canvasRef.current, tool.assetId, { ...opts, color: { dark: '#0F1923', light: '#ffffff' } }).catch(() => {})
    if (printRef.current) QRCode.toCanvas(printRef.current, tool.assetId, { ...opts, color: { dark: '#000000', light: '#ffffff' } }).catch(() => {})
  }, [tool])

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/70 grid place-items-center p-5">
      <style>{`@media print{
        body *{visibility:hidden!important}
        #tc-print,#tc-print *{visibility:visible!important}
        #tc-print{position:fixed!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important}
        .tcp-card{display:flex;align-items:center;gap:0.12in;width:2.2in;height:1.1in;box-sizing:border-box;padding:0.08in;background:#fff}
        .tcp-qr canvas{width:0.9in!important;height:0.9in!important;display:block}
        .tcp-txt{font-family:Arial,sans-serif;line-height:1.08;overflow:hidden}
        .tcp-h{font-size:5pt;font-weight:700;letter-spacing:0.4pt;color:#333}
        .tcp-id{font-size:13pt;font-weight:800;color:#000;font-family:monospace;line-height:1}
        .tcp-name{font-size:7pt;font-weight:600;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:1.05in}
        .tcp-sub{font-size:5.5pt;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:1.05in}
        @page{margin:0}
      }`}</style>
      {/* Hidden print-only label — sized in inches so it prints clean on a normal
          Letter printer (centered) and fills a 2.2x1.1 Godex label. */}
      <div id="tc-print" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        <div className="tcp-card">
          <div className="tcp-qr"><canvas ref={printRef} /></div>
          <div className="tcp-txt">
            <div className="tcp-h">PYRAMID · PROPERTY OF</div>
            <div className="tcp-id">{tool.assetId}</div>
            <div className="tcp-name">{tool.name}</div>
            <div className="tcp-sub">{tool.manufacturer} {tool.model}</div>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b border-ink-100">
          <h3 className="font-condensed text-xl font-bold">Asset tag</h3>
          <button className="text-ink-400" onClick={onClose}><X size={24} /></button>
        </div>
        <div className="p-6 grid place-items-center">
          <div className="rounded-lg p-3 flex items-center gap-3"
            style={{ background: 'linear-gradient(135deg,#E8EAEC,#C9CDD2)', border: '1px solid #AEB4BB', width: 300 }}>
            <div className="bg-white p-1.5 rounded"><canvas ref={canvasRef} /></div>
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-ink-500 font-bold tracking-wide">PYRAMID · PROPERTY OF</div>
              <div className="font-mono text-2xl font-bold text-ink-900 leading-tight">{tool.assetId}</div>
              <div className="font-condensed text-[15px] font-semibold text-ink-700 truncate">{tool.name}</div>
              <div className="text-[10px] text-ink-500 truncate">{tool.manufacturer} {tool.model}</div>
            </div>
          </div>
          <p className="text-[12px] text-ink-400 mt-4 text-center">
            QR error correction <span className="font-mono font-bold text-ink-700">H · 30%</span> — still scans when scratched. Reprint anytime; the code never changes.
          </p>
        </div>
        <div className="px-5 pb-5">
          <button onClick={() => window.print()} className="w-full bg-ink-900 text-white rounded-xl py-3.5 font-semibold flex items-center justify-center gap-2">
            <Printer size={18} /> Print tag
          </button>
        </div>
      </div>
    </div>
  )
}
