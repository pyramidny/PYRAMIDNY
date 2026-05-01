// src/pages/NewProject.jsx
// Route: /projects/new
// Writes via: project-proxy Edge Function, action='insert'
// Passes both Supabase JWT (for auth) and Microsoft Graph provider_token
// (for SharePoint folder creation).

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useCanDo } from '@/lib/permissions'

const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-proxy`
const SB_TOKEN_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

const SCOPE_TYPES = [
  'Facade Repairs',
  'Facade Restoration',
  'Masonry Repair',
  'Masonry Restoration',
  'Waterproofing',
  'Tuckpointing / Repointing',
  'Caulking & Sealants',
  'Concrete Repair',
  'FISP Repairs',
  'FISP Inspection',
  'Roof Replacement',
  'Roof Repairs',
  'Parapet / Cornice',
  'Lintel Replacement',
  'Firestopping',
  'Glass Replacement',
  'Sidewalk Repairs',
  'Structural Repair',
  'Other',
]

const STATUSES = [
  { value: 'New Bid',         label: 'New Bid' },
  { value: 'Active Bid',      label: 'Active Bid' },
  { value: 'Job Awarded',     label: 'Job Awarded' },
  { value: 'Active Job',      label: 'Active Job' },
  { value: 'No Bid',          label: 'No Bid' },
  { value: 'Bid Not Awarded', label: 'Bid Not Awarded' },
  { value: 'Job Closed',      label: 'Job Closed' },
]

const EMPTY = {
  division:               'regular',
  status:                 'New Bid',
  project_address:        '',
  scope_type:             '',
  property_manager_owner: '',
  architect_engineer:     '',
  bid_amount:             '',
  notes:                  '',
}

// Pull both the Supabase JWT and Microsoft Graph provider_token from localStorage.
// Azure AD PKCE flow stores both there; the provider_token is what SharePoint needs.
function getAuthTokens() {
  try {
    const raw = localStorage.getItem(SB_TOKEN_KEY)
    if (!raw) return { accessToken: null, providerToken: null }
    const parsed = JSON.parse(raw)
    return {
      accessToken:   parsed?.access_token ?? null,
      providerToken: parsed?.provider_token ?? null,
    }
  } catch {
    return { accessToken: null, providerToken: null }
  }
}

function Label({ children, required }) {
  return (
    <label className="block text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5">
      {children}{required && <span className="text-amber-500 ml-1">*</span>}
    </label>
  )
}

function Input({ error, className = '', ...props }) {
  return (
    <input
      className={`w-full bg-stone-900 border rounded-sm px-3 py-2.5 text-stone-100 text-sm placeholder-stone-600 outline-none transition-colors ${error ? 'border-red-500 focus:border-red-400' : 'border-stone-700 focus:border-amber-500'} ${className}`}
      {...props}
    />
  )
}

function Select({ error, children, className = '', ...props }) {
  return (
    <select
      className={`w-full bg-stone-900 border rounded-sm px-3 py-2.5 text-stone-100 text-sm outline-none transition-colors appearance-none cursor-pointer ${error ? 'border-red-500 focus:border-red-400' : 'border-stone-700 focus:border-amber-500'} ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}

function Textarea({ error, className = '', ...props }) {
  return (
    <textarea
      rows={4}
      className={`w-full bg-stone-900 border rounded-sm px-3 py-2.5 text-stone-100 text-sm placeholder-stone-600 outline-none transition-colors resize-none ${error ? 'border-red-500 focus:border-red-400' : 'border-stone-700 focus:border-amber-500'} ${className}`}
      {...props}
    />
  )
}

function FieldError({ msg }) {
  if (!msg) return null
  return <p className="mt-1 text-xs text-red-400">{msg}</p>
}

function Section({ number, title, children }) {
  return (
    <div className="relative">
      <div className="absolute left-0 top-0 bottom-0 w-px bg-stone-700" />
      <div className="pl-6">
        <div className="flex items-center gap-3 mb-5">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500 text-stone-950 text-xs font-bold flex items-center justify-center">
            {number}
          </span>
          <h2 className="text-sm font-semibold tracking-widest uppercase text-stone-300">{title}</h2>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  )
}

export default function NewProject() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canDo = useCanDo()

  const [form, setForm]           = useState(EMPTY)
  const [errors, setErrors]       = useState({})
  const [saving, setSaving]       = useState(false)
  const [serverErr, setServerErr] = useState(null)
  const [saveMeta, setSaveMeta]   = useState(null)

  // Hard guard — if you somehow land here without permission, show a friendly
  // message instead of letting you fill out a form that will 403 on save.
  if (!canDo('create_project')) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center px-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">
          Not authorized to create projects
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Only admins can create new projects. Please ask Jorge or another admin to add this one.
        </p>
        <Link to="/projects" className="text-sm text-pyramid-600 hover:text-pyramid-500">
          ← Back to projects
        </Link>
      </div>
    )
  }

  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const setCurrency = (e) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '')
    setForm((prev) => ({ ...prev, bid_amount: raw }))
  }

  const validate = () => {
    const errs = {}
    if (!form.project_address.trim()) errs.project_address = 'Project address is required.'
    if (!form.scope_type)              errs.scope_type      = 'Select a scope type.'
    if (form.bid_amount && isNaN(Number(form.bid_amount)))
                                       errs.bid_amount      = 'Enter a numeric value.'
    return errs
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setServerErr(null)
    setSaveMeta(null)

    try {
      const { accessToken, providerToken } = getAuthTokens()

      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: 'insert',
          providerToken,
          project: {
            division:               form.division,
            status:                 form.status,
            project_address:        form.project_address.trim(),
            scope_type:             form.scope_type || null,
            property_manager_owner: form.property_manager_owner.trim() || null,
            architect_engineer:     form.architect_engineer.trim() || null,
            bid_amount:             form.bid_amount ? Number(form.bid_amount) : null,
            notes:                  form.notes.trim() || null,
          },
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        console.error('Proxy insert error:', json)
        setServerErr(json.error ?? `Save failed (${res.status})`)
        return
      }

      // Log success meta (tasks seeded, SP folder, etc.) for debugging.
      // If SP folder failed, we still navigate — project exists, folder can be backfilled.
      if (json.meta) {
        console.log('[NewProject] created:', json.meta)
        setSaveMeta(json.meta)
      }

      navigate(json.data?.id ? `/projects/${json.data.id}` : '/projects')

    } catch (err) {
      console.error('Unexpected error:', err)
      setServerErr('An unexpected error occurred. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">

      <div className="border-b border-stone-800 bg-stone-950 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/projects" className="text-stone-500 hover:text-stone-300 transition-colors" title="Back to projects">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <p className="text-xs tracking-widest uppercase text-stone-500 font-medium">New Project</p>
              <h1 className="text-lg font-bold text-stone-100 leading-tight mt-0.5">Create Project / Bid</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex rounded-sm overflow-hidden border border-stone-700 text-xs font-medium">
              {['regular', 'ira'].map((div) => (
                <button
                  key={div}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, division: div }))}
                  className={`px-3 py-2 transition-colors ${form.division === div ? 'bg-amber-500 text-stone-950' : 'text-stone-400 hover:text-stone-200'}`}
                >
                  {div === 'regular' ? 'Regular' : 'IRA'}
                </button>
              ))}
            </div>

            <div className="relative">
              <Select
                value={form.status}
                onChange={set('status')}
                className="text-xs py-1.5 pr-8 pl-3 w-auto min-w-[150px]"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                <svg className="w-3.5 h-3.5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <form onSubmit={handleSubmit} noValidate>

          <div className="mb-10">
            <Label required>Project Address</Label>
            <Input
              type="text"
              placeholder="e.g. 245 Park Ave, New York, NY 10167"
              value={form.project_address}
              onChange={set('project_address')}
              error={errors.project_address}
              className="text-base font-medium"
            />
            <FieldError msg={errors.project_address} />
          </div>

          <div className="space-y-10">

            <Section number="1" title="Scope">
              <div>
                <Label required>Scope Type</Label>
                <div className="relative">
                  <Select
                    value={form.scope_type}
                    onChange={set('scope_type')}
                    error={errors.scope_type}
                  >
                    <option value="">Select scope…</option>
                    {SCOPE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <FieldError msg={errors.scope_type} />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  placeholder="Describe the work, site conditions, access requirements…"
                  value={form.notes}
                  onChange={set('notes')}
                />
              </div>
            </Section>

            <Section number="2" title="Contacts">
              <div>
                <Label>Property Manager / Owner</Label>
                <Input
                  type="text"
                  placeholder="Management company or owner name"
                  value={form.property_manager_owner}
                  onChange={set('property_manager_owner')}
                />
              </div>
              <div>
                <Label>Architect / Engineer</Label>
                <Input
                  type="text"
                  placeholder="Architect or engineer of record"
                  value={form.architect_engineer}
                  onChange={set('architect_engineer')}
                />
              </div>
            </Section>

            <Section number="3" title="Bid Amount">
              <div className="max-w-xs">
                <Label>Bid Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-medium">$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.bid_amount}
                    onChange={setCurrency}
                    error={errors.bid_amount}
                    className="pl-7"
                  />
                </div>
                <FieldError msg={errors.bid_amount} />
                <p className="mt-1.5 text-xs text-stone-600">Leave blank if not yet determined.</p>
              </div>
            </Section>

          </div>

          {serverErr && (
            <div className="mt-8 p-4 rounded-sm bg-red-950 border border-red-800 text-red-300 text-sm">
              <strong className="font-semibold">Save failed:</strong> {serverErr}
            </div>
          )}

          <div className="mt-10 pt-8 border-t border-stone-800 flex items-center justify-between gap-4">
            <Link to="/projects" className="text-sm text-stone-500 hover:text-stone-300 transition-colors">Cancel</Link>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 text-sm font-semibold rounded-sm bg-amber-500 hover:bg-amber-400 text-stone-950 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                  </svg>
                  Saving…
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
