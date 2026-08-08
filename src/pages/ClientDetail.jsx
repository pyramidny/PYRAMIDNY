// src/pages/ClientDetail.jsx
// =============================================================================
// CLIENT DETAIL  —  Deploy B
//
// Shows the client, its job sites, its main-office contacts, and every project
// underneath (through the sites).
//
// Contacts here are MAIN OFFICE contacts — the people at the management
// company. Building supers and on-site PMs live on the SITE (see SiteDetail),
// because one person commonly covers several buildings.
// =============================================================================
import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, MapPin, User, Building2, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCanDo } from '@/lib/permissions'
import {
  createSite, createContact, updateClient,
  CLIENT_TYPES, CONTACT_TYPES, labelFor,
} from '@/lib/clientsApi'

export default function ClientDetail() {
  const { id } = useParams()
  const canDo = useCanDo()

  const [client, setClient] = useState(null)
  const [sites, setSites] = useState([])
  const [contacts, setContacts] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  const [siteForm, setSiteForm] = useState(null)     // null = closed
  const [contactForm, setContactForm] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: c } = await supabase.from('clients').select('*').eq('id', id).maybeSingle()
      setClient(c)

      const { data: ss } = await supabase.from('sites')
        .select('*').eq('client_id', id).eq('is_active', true).order('name')
      setSites(ss ?? [])

      const { data: cts } = await supabase.from('contacts')
        .select('*').eq('client_id', id).eq('is_active', true).order('last_name')
      setContacts(cts ?? [])

      const siteIds = (ss ?? []).map(s => s.id)
      if (siteIds.length) {
        const { data: ps } = await supabase.from('projects')
          .select('id, project_number, project_address, scope_type, status, current_stage, site_id')
          .in('site_id', siteIds)
          .order('project_number', { ascending: false })
        setProjects(ps ?? [])
      } else {
        setProjects([])
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function saveSite() {
    if (!siteForm?.name?.trim()) { setBanner({ kind: 'error', text: 'Site name is required.' }); return }
    try {
      const res = await createSite({ ...siteForm, client_id: id, name: siteForm.name.trim() })
      setSiteForm(null)
      if (res.warning) setBanner({ kind: 'warn', text: res.warning })
      await load()
    } catch (e) { setBanner({ kind: 'error', text: e.message }) }
  }

  async function saveContact() {
    if (!contactForm?.last_name?.trim() && !contactForm?.first_name?.trim()) {
      setBanner({ kind: 'error', text: 'A first or last name is required.' }); return
    }
    try {
      await createContact({ ...contactForm, client_id: id })
      setContactForm(null)
      await load()
    } catch (e) { setBanner({ kind: 'error', text: e.message }) }
  }

  async function togglePromote() {
    const next = client.relationship_status === 'client' ? 'prospect' : 'client'
    try {
      await updateClient(id, { relationship_status: next })
      await load()
    } catch (e) { setBanner({ kind: 'error', text: e.message }) }
  }

  if (loading) return <div className="p-6 text-gray-500 text-sm">Loading…</div>
  if (!client) return <div className="p-6 text-gray-500 text-sm">Client not found.</div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={15} /> Clients
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {labelFor(CLIENT_TYPES, client.client_type)}
            {client.address_line1 ? ` · ${client.address_line1}` : ''}
            {client.city ? `, ${client.city}` : ''}
            {client.state ? ` ${client.state}` : ''} {client.postal_code ?? ''}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={
              'text-[10px] px-2 py-0.5 rounded font-medium tracking-wide ' +
              (client.relationship_status === 'client'
                ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-600')
            }>
              {client.relationship_status === 'client' ? 'CLIENT' : 'PROSPECT'}
            </span>
            {client.qb_customer_name && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                QB: {client.qb_customer_name}
              </span>
            )}
            {client.sharepoint_folder_url && (
              <a href={client.sharepoint_folder_url} target="_blank" rel="noreferrer"
                className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
                SharePoint <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {canDo('edit_client') && (
            <button onClick={togglePromote}
              className="px-3 py-2 rounded border border-gray-200 text-gray-600 hover:text-gray-900 text-sm">
              {client.relationship_status === 'client' ? 'Mark as Prospect' : 'Promote to Client'}
            </button>
          )}
          {canDo('edit_client') && (
            <button onClick={() => setSiteForm({ name: '', address_line1: '', borough: '', bin_number: '', phone: '' })}
              className="flex items-center gap-1.5 px-4 py-2 rounded bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium">
              <Plus size={15} /> Job Site
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div className={'mt-4 px-4 py-3 rounded text-sm ' +
          (banner.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-amber-50 text-amber-800 border border-amber-200')}>
          {banner.text}
        </div>
      )}

      {/* ---- MAIN OFFICE CONTACTS ---- */}
      <Section
        title="Main office contacts"
        action={canDo('edit_client') && (
          <button onClick={() => setContactForm({
            first_name: '', last_name: '', title: '', email: '',
            phone: '', mobile: '', contact_type: 'primary', is_billing_contact: false,
          })} className="text-xs px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-900">
            + Contact
          </button>
        )}
      >
        {contacts.length === 0 ? (
          <Empty>No contacts yet.</Empty>
        ) : contacts.map(ct => (
          <div key={ct.id} className="px-4 py-3 border-t border-gray-200 first:border-t-0">
            <div className="flex items-center gap-2 flex-wrap">
              <User size={14} className="text-gray-400" />
              <span className="font-medium text-gray-900">{ct.full_name || '—'}</span>
              {ct.is_billing_contact && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                  RECEIVES INVOICES
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 pl-5">
              {[ct.title, ct.email, ct.phone, ct.mobile && `Cell ${ct.mobile}`]
                .filter(Boolean).join(' · ') || labelFor(CONTACT_TYPES, ct.contact_type)}
            </div>
          </div>
        ))}
      </Section>

      {/* ---- JOB SITES ---- */}
      <Section title={`Job sites (${sites.length})`}>
        {sites.length === 0 ? (
          <Empty>No job sites yet. Add one to start bidding work at a building.</Empty>
        ) : sites.map(s => {
          const n = projects.filter(p => p.site_id === s.id).length
          return (
            <Link key={s.id} to={`/sites/${s.id}`}
              className="flex items-center gap-3 px-4 py-3 border-t border-gray-200 first:border-t-0 hover:bg-gray-50">
              <MapPin size={15} className="text-gray-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">{s.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {[s.address_line1, s.borough, s.bin_number && `BIN ${s.bin_number}`]
                    .filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <span className="text-xs text-gray-400 shrink-0">{n} project{n === 1 ? '' : 's'}</span>
            </Link>
          )
        })}
      </Section>

      {/* ---- PROJECTS ROLL-UP ---- */}
      <Section title={`All projects (${projects.length})`}>
        {projects.length === 0 ? (
          <Empty>No projects at this client yet.</Empty>
        ) : projects.map(p => (
          <Link key={p.id} to={`/projects/${p.id}`}
            className="flex items-center gap-3 px-4 py-3 border-t border-gray-200 first:border-t-0 hover:bg-gray-50">
            <Building2 size={15} className="text-gray-400 shrink-0" />
            <span className="font-mono text-xs text-blue-300 shrink-0">{p.project_number}</span>
            <div className="min-w-0 flex-1">
              <div className="text-gray-900 truncate text-sm">{p.project_address}</div>
              <div className="text-xs text-gray-500">{p.scope_type ?? '—'}</div>
            </div>
            <span className="text-xs text-gray-400 shrink-0">Stage {p.current_stage} · {p.status}</span>
          </Link>
        ))}
      </Section>

      {/* ---- new site modal ---- */}
      {siteForm && (
        <Modal title="New Job Site" onClose={() => setSiteForm(null)} onSave={saveSite} saveLabel="Create Site">
          <Field label="Building name or address *">
            <input className="input w-full text-gray-900 bg-white" autoFocus
              value={siteForm.name} onChange={e => setSiteForm({ ...siteForm, name: e.target.value })}
              placeholder="e.g. Victoria House or 200 East 27th Street" />
          </Field>
          <Field label="Street address">
            <input className="input w-full text-gray-900 bg-white"
              value={siteForm.address_line1}
              onChange={e => setSiteForm({ ...siteForm, address_line1: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Borough">
              <select className="input w-full text-gray-900 bg-white"
                value={siteForm.borough}
                onChange={e => setSiteForm({ ...siteForm, borough: e.target.value })}>
                <option value="">—</option>
                {['Manhattan','Brooklyn','Queens','Bronx','Staten Island'].map(b =>
                  <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="BIN">
              <input className="input w-full text-gray-900 bg-white"
                value={siteForm.bin_number}
                onChange={e => setSiteForm({ ...siteForm, bin_number: e.target.value })} />
            </Field>
          </div>
          <Field label="Building office phone">
            <input className="input w-full text-gray-900 bg-white"
              value={siteForm.phone}
              onChange={e => setSiteForm({ ...siteForm, phone: e.target.value })} />
          </Field>
          <p className="text-xs text-gray-500">
            Site names only need to be unique within this client — the same address can
            exist under another management company.
          </p>
        </Modal>
      )}

      {/* ---- new contact modal ---- */}
      {contactForm && (
        <Modal title="New Contact" onClose={() => setContactForm(null)} onSave={saveContact} saveLabel="Add Contact">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input className="input w-full text-gray-900 bg-white" autoFocus
                value={contactForm.first_name}
                onChange={e => setContactForm({ ...contactForm, first_name: e.target.value })} />
            </Field>
            <Field label="Last name">
              <input className="input w-full text-gray-900 bg-white"
                value={contactForm.last_name}
                onChange={e => setContactForm({ ...contactForm, last_name: e.target.value })} />
            </Field>
          </div>
          <Field label="Title / position">
            <input className="input w-full text-gray-900 bg-white"
              value={contactForm.title}
              onChange={e => setContactForm({ ...contactForm, title: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className="input w-full text-gray-900 bg-white"
              value={contactForm.contact_type}
              onChange={e => setContactForm({ ...contactForm, contact_type: e.target.value })}>
              {CONTACT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Email">
            <input className="input w-full text-gray-900 bg-white"
              value={contactForm.email}
              onChange={e => setContactForm({ ...contactForm, email: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input className="input w-full text-gray-900 bg-white"
                value={contactForm.phone}
                onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} />
            </Field>
            <Field label="Cell">
              <input className="input w-full text-gray-900 bg-white"
                value={contactForm.mobile}
                onChange={e => setContactForm({ ...contactForm, mobile: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={contactForm.is_billing_contact}
              onChange={e => setContactForm({ ...contactForm, is_billing_contact: e.target.checked })} />
            Receives invoices
          </label>
        </Modal>
      )}
    </div>
  )
}

/* ---- small building blocks ---- */
function Section({ title, action, children }) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{title}</h2>
        {action}
      </div>
      <div className="border border-gray-200 rounded overflow-hidden">{children}</div>
    </div>
  )
}
const Empty = ({ children }) => <div className="px-4 py-6 text-sm text-gray-400">{children}</div>

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function Modal({ title, onClose, onSave, saveLabel, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button onClick={onSave}
            className="px-4 py-2 rounded bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium">
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
