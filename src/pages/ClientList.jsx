// src/pages/ClientList.jsx
// =============================================================================
// CLIENTS  —  Deploy B
//
// Client → Job Site → Project. This is the top of that tree.
//
// A client is the entity Pyramid BILLS (matches QuickBooks). Architects,
// engineers and board members are CONTACTS, not clients — see ClientDetail.
//
// relationship_status is a separate axis from client_type: AKAM is a managing
// agent whether they are a prospect or a client. New companies start as
// prospects and promote on the first won bid.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Plus, Search, AlertTriangle, FolderPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCanDo, useIsAdmin } from '@/lib/permissions'
import {
  createClient, backfillFolders, graphHealth,
  CLIENT_TYPES, labelFor,
} from '@/lib/clientsApi'

const EMPTY = {
  name: '', client_type: 'managing_agent', relationship_status: 'prospect',
  address_line1: '', city: '', state: 'NY', postal_code: '',
  phone: '', email: '', website: '', notes: '',
}

export default function ClientList() {
  const canDo = useCanDo()
  const isAdmin = useIsAdmin()

  const [clients, setClients] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')      // all | client | prospect

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState(null) // { kind, text }
  const [spHealth, setSpHealth] = useState(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [{ data: cs, error: e1 }, { data: ss }] = await Promise.all([
        supabase.from('clients')
          .select('*').eq('is_active', true).order('name'),
        supabase.from('sites')
          .select('id, client_id').eq('is_active', true),
      ])
      if (e1) throw e1
      const byClient = {}
      for (const s of ss ?? []) byClient[s.client_id] = (byClient[s.client_id] ?? 0) + 1
      setClients(cs ?? [])
      setCounts(byClient)
    } catch (e) {
      setErr(e.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Non-blocking preflight. Warns BEFORE the user fills in a form that the
  // folder half will fail — they can still save; folders backfill later.
  useEffect(() => {
    if (!showNew) return
    let alive = true
    graphHealth().then(h => { if (alive) setSpHealth(h) })
    return () => { alive = false }
  }, [showNew])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return clients.filter(c => {
      if (tab !== 'all' && c.relationship_status !== tab) return false
      if (!needle) return true
      return [c.name, c.qb_customer_name, c.city, c.address_line1]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(needle))
    })
  }, [clients, q, tab])

  const nClients   = clients.filter(c => c.relationship_status === 'client').length
  const nProspects = clients.filter(c => c.relationship_status === 'prospect').length
  const unprovisioned = clients.filter(c => !c.sharepoint_folder_id).length

  async function submit() {
    if (!form.name.trim()) { setBanner({ kind: 'error', text: 'Company name is required.' }); return }
    setSaving(true); setBanner(null)
    try {
      const res = await createClient({ ...form, name: form.name.trim() })
      setShowNew(false); setForm(EMPTY)
      if (res.warning) setBanner({ kind: 'warn', text: res.warning })
      await load()
    } catch (e) {
      setBanner({ kind: 'error', text: e.message ?? String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function runBackfill() {
    setBanner({ kind: 'info', text: 'Creating missing folders…' })
    try {
      const res = await backfillFolders()
      const d = res.data ?? {}
      setBanner({
        kind: d.failed?.length ? 'warn' : 'info',
        text: `Created ${d.clients ?? 0} client and ${d.sites ?? 0} site folders.` +
              (d.failed?.length ? ` ${d.failed.length} failed — see console.` : ''),
      })
      if (d.failed?.length) console.warn('backfill failures:', d.failed)
      await load()
    } catch (e) {
      setBanner({ kind: 'error', text: e.message ?? String(e) })
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">
            Client → job site → project. Contacts attach at the level they belong to.
          </p>
        </div>
        {canDo('create_client') && (
          <button
            onClick={() => { setShowNew(true); setForm(EMPTY) }}
            className="flex items-center gap-2 px-4 py-2 rounded bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium"
          >
            <Plus size={16} /> New Client
          </button>
        )}
      </div>

      {banner && (
        <div className={
          'mt-4 px-4 py-3 rounded text-sm ' +
          (banner.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200'
            : banner.kind === 'warn' ? 'bg-amber-50 text-amber-800 border border-amber-200'
            : 'bg-blue-50 text-blue-800 border border-blue-200')
        }>
          {banner.text}
        </div>
      )}

      {isAdmin && unprovisioned > 0 && (
        <div className="mt-4 px-4 py-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} />
            {unprovisioned} client{unprovisioned === 1 ? '' : 's'} without a SharePoint folder.
          </span>
          <button
            onClick={runBackfill}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
          >
            <FolderPlus size={14} /> Create folders
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-5 mb-4">
        {[['all', `All ${clients.length}`],
          ['client', `Clients ${nClients}`],
          ['prospect', `Prospects ${nProspects}`]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={'px-3 py-1.5 rounded-full text-sm font-medium ' +
              (tab === k ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
          >
            {label}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input w-full pl-9 text-gray-900 bg-white"
            placeholder="Search by company name…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-10 text-center">Loading clients…</div>
      ) : err ? (
        <div className="text-red-300 text-sm py-10 text-center">{err}</div>
      ) : shown.length === 0 ? (
        <div className="text-gray-500 text-sm py-12 text-center border border-gray-200 rounded">
          {clients.length === 0
            ? 'No clients yet. The QuickBooks import will load these on cutover.'
            : 'Nothing matches that search.'}
        </div>
      ) : (
        <div className="border border-gray-200 rounded divide-y divide-gray-200">
          {shown.map(c => (
            <Link
              key={c.id}
              to={`/clients/${c.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50"
            >
              <Building2 size={18} className="text-gray-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 truncate">{c.name}</span>
                  <span className={
                    'text-[10px] px-1.5 py-0.5 rounded font-medium tracking-wide ' +
                    (c.relationship_status === 'client'
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-600')
                  }>
                    {c.relationship_status === 'client' ? 'CLIENT' : 'PROSPECT'}
                  </span>
                  {!c.sharepoint_folder_id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                      NO FOLDER
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate mt-0.5">
                  {labelFor(CLIENT_TYPES, c.client_type)}
                  {c.address_line1 ? ` · ${c.address_line1}` : ''}
                  {c.city ? `, ${c.city}` : ''}
                </div>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {counts[c.id] ?? 0} site{(counts[c.id] ?? 0) === 1 ? '' : 's'}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* ---- New client modal ---- */}
      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-lg w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">New Client</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="p-5 space-y-4">
              {spHealth && !spHealth.ok && (
                <div className="px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  SharePoint is unavailable right now. You can still save — the folder
                  will be created when it is back, using “Create folders”.
                </div>
              )}

              <Field label="Company name *">
                <input className="input w-full text-gray-900 bg-white" autoFocus
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Acme Property Group" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select className="input w-full text-gray-900 bg-white"
                    value={form.client_type}
                    onChange={e => setForm({ ...form, client_type: e.target.value })}>
                    {CLIENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select className="input w-full text-gray-900 bg-white"
                    value={form.relationship_status}
                    onChange={e => setForm({ ...form, relationship_status: e.target.value })}>
                    <option value="prospect">Prospect</option>
                    <option value="client">Client</option>
                  </select>
                </Field>
              </div>

              <Field label="Main office address">
                <input className="input w-full text-gray-900 bg-white"
                  value={form.address_line1}
                  onChange={e => setForm({ ...form, address_line1: e.target.value })} />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="City">
                  <input className="input w-full text-gray-900 bg-white"
                    value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
                </Field>
                <Field label="State">
                  <input className="input w-full text-gray-900 bg-white"
                    value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} />
                </Field>
                <Field label="ZIP">
                  <input className="input w-full text-gray-900 bg-white"
                    value={form.postal_code}
                    onChange={e => setForm({ ...form, postal_code: e.target.value })} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <input className="input w-full text-gray-900 bg-white"
                    value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </Field>
                <Field label="Email">
                  <input className="input w-full text-gray-900 bg-white"
                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </Field>
              </div>

              <Field label="Website">
                <input className="input w-full text-gray-900 bg-white"
                  value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
              </Field>

              <div className="px-3 py-2 rounded bg-blue-50 border border-blue-200 text-blue-800 text-xs">
                New companies start as prospects and promote automatically on the first won bid.
                Job sites and contacts are added on the client page once this is saved.
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
              <button onClick={() => setShowNew(false)}
                className="px-4 py-2 rounded text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={submit} disabled={saving}
                className="px-4 py-2 rounded bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium">
                {saving ? 'Saving…' : 'Create Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}
