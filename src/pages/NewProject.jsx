// src/pages/NewProject.jsx
// Route: /projects/new
// Writes to: projects table (Supabase)
// Redirects to: /projects on success

import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

// ── Trade types for Pyramid's restoration scope ──────────────────────────────
const TRADE_TYPES = [
  'Masonry Restoration',
  'Facade Restoration',
  'Waterproofing',
  'Tuckpointing / Repointing',
  'Caulking & Sealants',
  'Concrete Repair',
  'Structural Repair',
  'Roofing',
  'Parapet / Cornice',
  'Lintel Replacement',
  'Other',
]

const BID_STATUSES = [
  { value: 'bid',        label: 'Bid / Estimating' },
  { value: 'awarded',   label: 'Awarded' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold',   label: 'On Hold' },
]

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]

// ── Empty form state ─────────────────────────────────────────────────────────
const EMPTY = {
  name:            '',
  bid_status:      'bid',
  // Client
  client_name:     '',
  client_email:    '',
  client_phone:    '',
  // Location
  address:         '',
  city:            '',
  state:           'NY',
  zip:             '',
  // Scope & Budget
  trade_type:      '',
  scope_notes:     '',
  estimated_value: '',
}

// ── Input primitives ─────────────────────────────────────────────────────────
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
      className={`
        w-full bg-stone-900 border rounded-sm px-3 py-2.5 text-stone-100
        text-sm placeholder-stone-600 outline-none transition-colors
        ${error
          ? 'border-red-500 focus:border-red-400'
          : 'border-stone-700 focus:border-amber-500'}
        ${className}
      `}
      {...props}
    />
  )
}

function Select({ error, children, className = '', ...props }) {
  return (
    <select
      className={`
        w-full bg-stone-900 border rounded-sm px-3 py-2.5 text-stone-100
        text-sm outline-none transition-colors appearance-none cursor-pointer
        ${error
          ? 'border-red-500 focus:border-red-400'
          : 'border-stone-700 focus:border-amber-500'}
        ${className}
      `}
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
      className={`
        w-full bg-stone-900 border rounded-sm px-3 py-2.5 text-stone-100
        text-sm placeholder-stone-600 outline-none transition-colors resize-none
        ${error
          ? 'border-red-500 focus:border-red-400'
          : 'border-stone-700 focus:border-amber-500'}
        ${className}
      `}
      {...props}
    />
  )
}

function FieldError({ msg }) {
  if (!msg) return null
  return <p className="mt-1 text-xs text-red-400">{msg}</p>
}

// ── Section wrapper ──────────────────────────────────────────────────────────
function Section({ number, title, children }) {
  return (
    <div className="relative">
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-px bg-stone-700" />
      <div className="pl-6">
        <div className="flex items-center gap-3 mb-5">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500 text-stone-950
                           text-xs font-bold flex items-center justify-center">
            {number}
          </span>
          <h2 className="text-sm font-semibold tracking-widest uppercase text-stone-300">
            {title}
          </h2>
        </div>
        <div className="space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function NewProject() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [form, setForm]       = useState(EMPTY)
  const [errors, setErrors]   = useState({})
  const [saving, setSaving]   = useState(false)
  const [serverErr, setServerErr] = useState(null)

  // ── Field helpers ──────────────────────────────────────────────────────────
  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const fmt = {
    phone: (e) => {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
      const formatted =
        digits.length >= 7
          ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
          : digits.length >= 4
          ? `(${digits.slice(0,3)}) ${digits.slice(3)}`
          : digits.length >= 1
          ? `(${digits}`
          : ''
      setForm((prev) => ({ ...prev, client_phone: formatted }))
    },
    currency: (e) => {
      const raw = e.target.value.replace(/[^0-9.]/g, '')
      setForm((prev) => ({ ...prev, estimated_value: raw }))
    },
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    const errs = {}
    if (!form.name.trim())        errs.name        = 'Project name is required.'
    if (!form.client_name.trim()) errs.client_name = 'Client name is required.'
    if (form.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.client_email))
                                  errs.client_email = 'Enter a valid email address.'
    if (!form.address.trim())     errs.address     = 'Street address is required.'
    if (!form.city.trim())        errs.city        = 'City is required.'
    if (!form.zip.trim())         errs.zip         = 'ZIP code is required.'
    if (!form.trade_type)         errs.trade_type  = 'Select a trade / scope type.'
    if (form.estimated_value && isNaN(Number(form.estimated_value)))
                                  errs.estimated_value = 'Enter a numeric value.'
    return errs
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setServerErr(null)

    const payload = {
      name:            form.name.trim(),
      bid_status:      form.bid_status,
      client_name:     form.client_name.trim(),
      client_email:    form.client_email.trim() || null,
      client_phone:    form.client_phone.trim() || null,
      address:         form.address.trim(),
      city:            form.city.trim(),
      state:           form.state,
      zip:             form.zip.trim(),
      trade_type:      form.trade_type,
      scope_notes:     form.scope_notes.trim() || null,
      estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
      created_by:      user?.id ?? null,
      status:          'active',
    }

    const { data, error } = await supabase
      .from('projects')
      .insert([payload])
      .select('id')
      .single()

    setSaving(false)

    if (error) {
      console.error('Supabase insert error:', error)
      setServerErr(error.message)
      return
    }

    // Navigate to the new project's detail page (or fall back to list)
    navigate(data?.id ? `/projects/${data.id}` : '/projects')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">

      {/* ── Page header ── */}
      <div className="border-b border-stone-800 bg-stone-950 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/projects"
              className="text-stone-500 hover:text-stone-300 transition-colors"
              title="Back to projects"
            >
              {/* Arrow left */}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <p className="text-xs tracking-widest uppercase text-stone-500 font-medium">
                New Project
              </p>
              <h1 className="text-lg font-bold text-stone-100 leading-tight mt-0.5">
                Create Project / Bid
              </h1>
            </div>
          </div>

          {/* Status badge selector in header */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-500 hidden sm:block">Status</span>
            <Select
              value={form.bid_status}
              onChange={set('bid_status')}
              className="text-xs py-1.5 pr-8 pl-3 w-auto min-w-[160px]"
            >
              {BID_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* ── Form ── */}
      <div className="max-w-3xl mx-auto px-6 py-10">
        <form onSubmit={handleSubmit} noValidate>

          {/* Project name — top-level, outside sections */}
          <div className="mb-10">
            <Label required>Project Name</Label>
            <Input
              type="text"
              placeholder="e.g. 245 Park Ave Facade Restoration"
              value={form.name}
              onChange={set('name')}
              error={errors.name}
              className="text-base font-medium"
            />
            <FieldError msg={errors.name} />
          </div>

          <div className="space-y-10">

            {/* ── Section 1: Client ── */}
            <Section number="1" title="Client & Contact">
              <div>
                <Label required>Client / Owner Name</Label>
                <Input
                  type="text"
                  placeholder="Company or individual name"
                  value={form.client_name}
                  onChange={set('client_name')}
                  error={errors.client_name}
                />
                <FieldError msg={errors.client_name} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="contact@example.com"
                    value={form.client_email}
                    onChange={set('client_email')}
                    error={errors.client_email}
                  />
                  <FieldError msg={errors.client_email} />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    type="tel"
                    placeholder="(555) 000-0000"
                    value={form.client_phone}
                    onChange={fmt.phone}
                  />
                </div>
              </div>
            </Section>

            {/* ── Section 2: Location ── */}
            <Section number="2" title="Project Location">
              <div>
                <Label required>Street Address</Label>
                <Input
                  type="text"
                  placeholder="123 Main Street, Suite 4"
                  value={form.address}
                  onChange={set('address')}
                  error={errors.address}
                />
                <FieldError msg={errors.address} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="col-span-2">
                  <Label required>City</Label>
                  <Input
                    type="text"
                    placeholder="New York"
                    value={form.city}
                    onChange={set('city')}
                    error={errors.city}
                  />
                  <FieldError msg={errors.city} />
                </div>
                <div>
                  <Label required>State</Label>
                  <Select
                    value={form.state}
                    onChange={set('state')}
                  >
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label required>ZIP</Label>
                  <Input
                    type="text"
                    maxLength={10}
                    placeholder="10001"
                    value={form.zip}
                    onChange={set('zip')}
                    error={errors.zip}
                  />
                  <FieldError msg={errors.zip} />
                </div>
              </div>
            </Section>

            {/* ── Section 3: Scope ── */}
            <Section number="3" title="Scope & Trade Type">
              <div>
                <Label required>Trade / Scope Type</Label>
                <div className="relative">
                  <Select
                    value={form.trade_type}
                    onChange={set('trade_type')}
                    error={errors.trade_type}
                  >
                    <option value="">Select scope…</option>
                    {TRADE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                  {/* Chevron */}
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <FieldError msg={errors.trade_type} />
              </div>
              <div>
                <Label>Scope Notes</Label>
                <Textarea
                  placeholder="Describe the work, notable conditions, access requirements…"
                  value={form.scope_notes}
                  onChange={set('scope_notes')}
                />
              </div>
            </Section>

            {/* ── Section 4: Budget ── */}
            <Section number="4" title="Estimated Value">
              <div className="max-w-xs">
                <Label>Estimated Contract Value</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-medium">
                    $
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.estimated_value}
                    onChange={fmt.currency}
                    error={errors.estimated_value}
                    className="pl-7"
                  />
                </div>
                <FieldError msg={errors.estimated_value} />
                <p className="mt-1.5 text-xs text-stone-600">Leave blank if not yet determined.</p>
              </div>
            </Section>

          </div>

          {/* ── Server error ── */}
          {serverErr && (
            <div className="mt-8 p-4 rounded-sm bg-red-950 border border-red-800 text-red-300 text-sm">
              <strong className="font-semibold">Save failed:</strong> {serverErr}
            </div>
          )}

          {/* ── Actions ── */}
          <div className="mt-10 pt-8 border-t border-stone-800 flex items-center justify-between gap-4">
            <Link
              to="/projects"
              className="text-sm text-stone-500 hover:text-stone-300 transition-colors"
            >
              Cancel
            </Link>
            <div className="flex items-center gap-3">
              {/* Save as draft (bid) */}
              <button
                type="button"
                onClick={() => {
                  setForm((p) => ({ ...p, bid_status: 'bid' }))
                  // trigger submit after state update
                  setTimeout(() => document.getElementById('_submit-btn').click(), 0)
                }}
                disabled={saving}
                className="px-5 py-2.5 text-sm font-medium text-stone-400
                           border border-stone-700 rounded-sm hover:border-stone-500
                           hover:text-stone-200 transition-colors disabled:opacity-50"
              >
                Save as Bid
              </button>
              {/* Primary submit */}
              <button
                id="_submit-btn"
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 text-sm font-semibold rounded-sm
                           bg-amber-500 hover:bg-amber-400 text-stone-950
                           transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10"
                              stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                    </svg>
                    Saving…
                  </>
                ) : (
                  'Create Project'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
