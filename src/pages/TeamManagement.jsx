// src/pages/TeamManagement.jsx
// Route: /team
// Admin-only page to manage staff whitelist + profiles.
//
// Architecture (Pattern B — whitelist-as-invite):
// - Adding someone = inserting into staff_whitelist (is_active=true)
// - Their profile auto-creates on first Azure AD login via handle_new_user_from_whitelist trigger
// - Deactivating = is_active=false on both profile AND whitelist. Login still works
//   for Azure AD but app rejects inactive users. Fully reversible.
// - Hard delete = destructive purge, admin panel only, requires typed confirmation

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-proxy`
const SB_TOKEN_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

const ROLES = [
  { value: 'admin',                 label: 'Admin' },
  { value: 'director_of_operations', label: 'Director of Operations' },
  { value: 'sales_rep',             label: 'Sales Rep' },
  { value: 'estimating_coordinator', label: 'Estimating Coordinator' },
  { value: 'estimator',             label: 'Estimator' },
  { value: 'project_manager',       label: 'Project Manager' },
  { value: 'assistant_pm',          label: 'Assistant PM' },
  { value: 'task_manager',          label: 'Task Manager' },
  { value: 'purchasing_manager',    label: 'Purchasing Manager' },
  { value: 'billing_coordinator',   label: 'Billing Coordinator' },
  { value: 'office_manager',        label: 'Office Manager' },
  { value: 'field_crew',            label: 'Field Crew' },
]

const DIVISIONS = [
  { value: '',        label: '(none)' },
  { value: 'regular', label: 'Regular' },
  { value: 'ira',     label: 'IRA / Rope Access' },
]

const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r.value, r.label]))

function getAccessToken() {
  try {
    const raw = localStorage.getItem(SB_TOKEN_KEY)
    return raw ? JSON.parse(raw)?.access_token : null
  } catch { return null }
}

function roleBadgeColor(role) {
  if (role === 'admin') return 'bg-red-100 text-red-700'
  if (['director_of_operations', 'office_manager'].includes(role)) return 'bg-purple-100 text-purple-700'
  if (['project_manager', 'assistant_pm'].includes(role)) return 'bg-blue-100 text-blue-700'
  if (['estimator', 'estimating_coordinator'].includes(role)) return 'bg-amber-100 text-amber-700'
  if (['purchasing_manager', 'billing_coordinator'].includes(role)) return 'bg-teal-100 text-teal-700'
  return 'bg-gray-100 text-gray-700'
}

export default function TeamManagement() {
  const { isAdmin, profile: me } = useAuth()

  const [profiles, setProfiles]   = useState([])
  const [whitelist, setWhitelist] = useState([])
  const [auditLog, setAuditLog]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [tab, setTab]             = useState('active')  // 'active' | 'inactive' | 'admin'
  const [saving, setSaving]       = useState(false)

  // Invite/edit form state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteDraft, setInviteDraft] = useState({
    email: '', full_name: '', display_name: '', role: 'field_crew',
    division: '', title: '', phone: '',
  })

  // Inline role edit state
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({})

  // Hard delete confirmation state
  const [hardDeleteTarget, setHardDeleteTarget] = useState(null)
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('')
  const [hardDeleteReason, setHardDeleteReason] = useState('')

  const proxy = useCallback(async (body) => {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Proxy error ${res.status}`)
    return json
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [profRes, wlRes, auditRes] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('staff_whitelist').select('*').order('full_name'),
        supabase.from('staff_audit_log')
          .select('*, changer:profiles!changed_by(full_name, display_name)')
          .order('created_at', { ascending: false })
          .limit(50),
      ])
      if (profRes.error) throw profRes.error
      if (wlRes.error)   throw wlRes.error
      setProfiles(profRes.data ?? [])
      setWhitelist(wlRes.data ?? [])
      setAuditLog(auditRes.data ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Combine profiles + whitelist into unified rows.
  // Profile takes precedence when both exist (same email).
  const unified = (() => {
    const byEmail = new Map()
    for (const w of whitelist) {
      byEmail.set(w.email.toLowerCase(), {
        email: w.email,
        full_name: w.full_name,
        display_name: w.display_name,
        role: w.role,
        division: w.division,
        title: w.title,
        phone: w.phone,
        is_active: w.is_active,
        profile_id: null,         // no login yet
        azure_oid: null,
        status: w.is_active ? 'invited' : 'deactivated_whitelist',
      })
    }
    for (const p of profiles) {
      const key = p.email.toLowerCase()
      byEmail.set(key, {
        email: p.email,
        full_name: p.full_name,
        display_name: p.display_name,
        role: p.role,
        division: p.division,
        title: p.title,
        phone: p.phone,
        is_active: p.is_active,
        profile_id: p.id,
        azure_oid: p.azure_oid,
        status: p.is_active ? (p.azure_oid ? 'active' : 'invited') : 'deactivated',
      })
    }
    return Array.from(byEmail.values())
  })()

  const activeRows   = unified.filter(r => r.is_active)
  const inactiveRows = unified.filter(r => !r.is_active)

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleInvite = async (e) => {
    e?.preventDefault?.()
    if (!inviteDraft.email || !inviteDraft.full_name) {
      alert('Email and full name are required')
      return
    }
    setSaving(true)
    try {
      await proxy({ action: 'upsert_whitelist', ...inviteDraft })
      setInviteOpen(false)
      setInviteDraft({
        email: '', full_name: '', display_name: '', role: 'field_crew',
        division: '', title: '', phone: '',
      })
      await loadAll()
    } catch (err) {
      alert('Failed to invite: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (row) => {
    setEditingId(row.email)
    setEditDraft({
      role: row.role,
      division: row.division ?? '',
      title: row.title ?? '',
    })
  }

  const saveEdit = async (row) => {
    setSaving(true)
    try {
      if (row.profile_id) {
        await proxy({
          action: 'update_profile',
          profileId: row.profile_id,
          updates: {
            role: editDraft.role,
            division: editDraft.division || null,
            title: editDraft.title || null,
          },
        })
      } else {
        // Whitelist-only row — upsert against the whitelist
        await proxy({
          action: 'upsert_whitelist',
          email: row.email,
          full_name: row.full_name,
          display_name: row.display_name,
          role: editDraft.role,
          division: editDraft.division || null,
          title: editDraft.title || null,
          phone: row.phone,
        })
      }
      setEditingId(null)
      await loadAll()
    } catch (err) {
      alert('Failed to save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (row) => {
    if (!row.profile_id) {
      // Whitelist-only — flip whitelist is_active
      if (!confirm(`Deactivate invitation for ${row.full_name}? They won't be able to log in.`)) return
      setSaving(true)
      try {
        await proxy({
          action: 'upsert_whitelist',
          email: row.email, full_name: row.full_name,
          display_name: row.display_name, role: row.role,
          division: row.division, phone: row.phone, title: row.title,
        })
        // Need a dedicated deactivate_whitelist, but for now we use upsert then a direct flip
        // NOTE: simpler — hit DB? Actually upsert_whitelist forces is_active=true. Add specific path:
        // Easiest approach: just call deactivate_staff won't work (no profile). Use supabase direct:
        await supabase.from('staff_whitelist')
          .update({ is_active: false }).eq('email', row.email)
        await loadAll()
      } catch (err) {
        alert('Failed to deactivate: ' + err.message)
      } finally {
        setSaving(false)
      }
      return
    }

    if (!confirm(`Deactivate ${row.full_name}? They won't be able to use the portal. This is reversible.`)) return
    setSaving(true)
    try {
      await proxy({ action: 'deactivate_staff', profileId: row.profile_id })
      await loadAll()
    } catch (err) {
      alert('Failed to deactivate: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const reactivate = async (row) => {
    setSaving(true)
    try {
      if (row.profile_id) {
        await proxy({ action: 'reactivate_staff', profileId: row.profile_id })
      } else {
        await supabase.from('staff_whitelist')
          .update({ is_active: true }).eq('email', row.email)
      }
      await loadAll()
    } catch (err) {
      alert('Failed to reactivate: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const openHardDelete = (row) => {
    setHardDeleteTarget(row)
    setHardDeleteConfirmText('')
    setHardDeleteReason('')
  }

  const executeHardDelete = async () => {
    if (!hardDeleteTarget) return
    if (hardDeleteConfirmText !== 'DELETE') {
      alert('Type DELETE exactly to confirm.')
      return
    }
    setSaving(true)
    try {
      if (hardDeleteTarget.profile_id) {
        await proxy({
          action: 'hard_delete_staff',
          profileId: hardDeleteTarget.profile_id,
          confirm: true,
          reason: hardDeleteReason,
        })
      } else {
        // Whitelist-only: direct delete + audit log via proxy
        await supabase.from('staff_whitelist').delete().eq('email', hardDeleteTarget.email)
      }
      setHardDeleteTarget(null)
      await loadAll()
    } catch (err) {
      alert('Hard delete failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Guards ─────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Team Management</h1>
        <p className="text-sm text-gray-500">This page is for admins only.</p>
      </div>
    )
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading team…</div>
  if (error)   return <div className="p-8 text-center text-red-600">Error: {error}</div>

  // ── Render helper: one staff row ───────────────────────────────────────
  const renderRow = (row) => {
    const isEditing = editingId === row.email
    const isMe      = row.profile_id && row.profile_id === me?.id

    return (
      <tr key={row.email} className="border-t border-gray-100">
        {/* Name */}
        <td className="px-4 py-3">
          <p className="text-sm font-medium text-gray-900">{row.full_name}</p>
          <p className="text-xs text-gray-400">{row.email}</p>
          {row.title && <p className="text-xs text-gray-500 italic">{row.title}</p>}
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          {row.status === 'active' && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
          )}
          {row.status === 'invited' && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full" title="Whitelisted, pending first login">
              Invited
            </span>
          )}
          {(row.status === 'deactivated' || row.status === 'deactivated_whitelist') && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Deactivated</span>
          )}
          {isMe && <span className="ml-2 text-[10px] text-gray-400">(you)</span>}
        </td>

        {/* Role */}
        <td className="px-4 py-3">
          {isEditing ? (
            <select
              value={editDraft.role}
              onChange={(e) => setEditDraft(d => ({ ...d, role: e.target.value }))}
              className="text-sm border border-gray-200 rounded px-2 py-1 w-full"
            >
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          ) : (
            <span className={`text-xs px-2 py-0.5 rounded-full ${roleBadgeColor(row.role)}`}>
              {ROLE_LABEL[row.role] ?? row.role}
            </span>
          )}
        </td>

        {/* Division */}
        <td className="px-4 py-3">
          {isEditing ? (
            <select
              value={editDraft.division}
              onChange={(e) => setEditDraft(d => ({ ...d, division: e.target.value }))}
              className="text-sm border border-gray-200 rounded px-2 py-1 w-full"
            >
              {DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          ) : (
            <span className="text-xs text-gray-600">
              {row.division === 'regular' ? 'Regular' : row.division === 'ira' ? 'IRA' : '—'}
            </span>
          )}
        </td>

        {/* Actions */}
        <td className="px-4 py-3 text-right">
          {isEditing ? (
            <div className="flex gap-2 justify-end">
              <button onClick={() => saveEdit(row)} disabled={saving} className="text-xs text-green-600 hover:text-green-800 disabled:text-gray-400">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingId(null)} disabled={saving} className="text-xs text-gray-400 hover:text-gray-600">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-3 justify-end">
              {row.is_active ? (
                <>
                  <button onClick={() => startEdit(row)} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                  {!isMe && (
                    <button onClick={() => deactivate(row)} className="text-xs text-amber-600 hover:text-amber-800">
                      Deactivate
                    </button>
                  )}
                </>
              ) : (
                <button onClick={() => reactivate(row)} className="text-xs text-green-600 hover:text-green-800">
                  Reactivate
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeRows.length} active · {inactiveRows.length} inactive · {profiles.filter(p => !p.azure_oid || p.azure_oid === null).length + whitelist.filter(w => !profiles.find(p => p.email === w.email)).length} pending first login
          </p>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="text-sm bg-pyramid-500 hover:bg-pyramid-600 text-white px-4 py-2 rounded-lg transition-colors"
        >
          + Invite Staff
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {[
          { key: 'active',   label: `Active (${activeRows.length})` },
          { key: 'inactive', label: `Inactive (${inactiveRows.length})` },
          { key: 'admin',    label: 'Admin Panel' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-pyramid-500 text-pyramid-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Active / Inactive tables */}
      {(tab === 'active' || tab === 'inactive') && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Division</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(tab === 'active' ? activeRows : inactiveRows).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                    {tab === 'active' ? 'No active staff.' : 'No inactive staff.'}
                  </td>
                </tr>
              ) : (
                (tab === 'active' ? activeRows : inactiveRows).map(renderRow)
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Admin Panel */}
      {tab === 'admin' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-amber-900 mb-1">Admin Panel — Destructive Actions</h3>
            <p className="text-xs text-amber-800">
              Hard deletion wipes a staff member's profile and whitelist entry permanently.
              Use only when a person was added by mistake or is being fully purged from records.
              Audit log entries are preserved regardless.
            </p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Hard Delete Staff</h3>
              <p className="text-xs text-gray-500 mt-0.5">Select anyone from the list to purge.</p>
            </div>
            <table className="w-full">
              <tbody>
                {unified.filter(r => r.profile_id !== me?.id).map(row => (
                  <tr key={row.email} className="border-t border-gray-100">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{row.full_name}</p>
                      <p className="text-xs text-gray-400">{row.email}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{ROLE_LABEL[row.role] ?? row.role}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openHardDelete(row)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Hard Delete…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent audit log */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
              <p className="text-xs text-gray-500 mt-0.5">Last 50 staff changes.</p>
            </div>
            <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {auditLog.length === 0 ? (
                <p className="px-4 py-6 text-xs text-gray-500">No activity yet.</p>
              ) : auditLog.map(entry => (
                <div key={entry.id} className="px-4 py-2 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium text-gray-900">{entry.action}</span>
                    <span className="text-gray-500"> — {entry.email}</span>
                    {entry.notes && <span className="text-gray-400 italic"> · {entry.notes}</span>}
                  </div>
                  <div className="text-gray-400">
                    {entry.changer?.display_name ?? entry.changer?.full_name ?? '—'} · {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setInviteOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleInvite}
            className="bg-white rounded-lg max-w-md w-full p-6 space-y-4"
          >
            <h2 className="text-lg font-semibold text-gray-900">Invite Staff</h2>
            <p className="text-xs text-gray-500">
              Adding to the whitelist grants portal access. Their profile will be created automatically on first login via Azure AD.
            </p>

            <div>
              <label className="text-xs text-gray-600 block mb-1">Email *</label>
              <input
                type="email"
                required
                value={inviteDraft.email}
                onChange={(e) => setInviteDraft(d => ({ ...d, email: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                placeholder="person@pyramidny.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">Full name *</label>
                <input
                  type="text"
                  required
                  value={inviteDraft.full_name}
                  onChange={(e) => setInviteDraft(d => ({
                    ...d,
                    full_name: e.target.value,
                    display_name: d.display_name || e.target.value.split(' ')[0],
                  }))}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Display name</label>
                <input
                  type="text"
                  value={inviteDraft.display_name}
                  onChange={(e) => setInviteDraft(d => ({ ...d, display_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">Role *</label>
                <select
                  value={inviteDraft.role}
                  onChange={(e) => setInviteDraft(d => ({ ...d, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                >
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">Division</label>
                <select
                  value={inviteDraft.division}
                  onChange={(e) => setInviteDraft(d => ({ ...d, division: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                >
                  {DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-600 block mb-1">Title</label>
              <input
                type="text"
                value={inviteDraft.title}
                onChange={(e) => setInviteDraft(d => ({ ...d, title: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                placeholder="e.g. Senior Project Manager"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600 block mb-1">Phone</label>
              <input
                type="tel"
                value={inviteDraft.phone}
                onChange={(e) => setInviteDraft(d => ({ ...d, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                placeholder="(555) 123-4567"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 text-sm bg-pyramid-500 hover:bg-pyramid-600 text-white px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add to Whitelist'}
              </button>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Hard delete confirmation modal */}
      {hardDeleteTarget && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setHardDeleteTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg max-w-md w-full p-6 space-y-4"
          >
            <h2 className="text-lg font-semibold text-red-700">Hard Delete Staff</h2>
            <p className="text-sm text-gray-700">
              You are about to permanently delete <strong>{hardDeleteTarget.full_name}</strong> ({hardDeleteTarget.email}).
              This wipes their profile and whitelist entry. An audit log entry remains.
            </p>
            <p className="text-xs text-red-600">
              This cannot be undone. Use <strong>Deactivate</strong> instead if there's any chance they'll return.
            </p>

            <div>
              <label className="text-xs text-gray-600 block mb-1">Reason (optional)</label>
              <input
                type="text"
                value={hardDeleteReason}
                onChange={(e) => setHardDeleteReason(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-gray-900"
                placeholder="e.g. Added by mistake"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600 block mb-1">Type DELETE to confirm</label>
              <input
                type="text"
                value={hardDeleteConfirmText}
                onChange={(e) => setHardDeleteConfirmText(e.target.value)}
                className="w-full border border-red-300 rounded px-2 py-1.5 text-sm text-gray-900"
                autoFocus
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={executeHardDelete}
                disabled={saving || hardDeleteConfirmText !== 'DELETE'}
                className="flex-1 text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {saving ? 'Deleting…' : 'Permanently Delete'}
              </button>
              <button
                onClick={() => setHardDeleteTarget(null)}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
