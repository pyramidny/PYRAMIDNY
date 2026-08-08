// src/pages/SiteDetail.jsx
// =============================================================================
// JOB SITE DETAIL  —  Deploy B
//
// A site is a building. It belongs to one client, but that link is
// REASSIGNABLE — buildings change management companies regularly in NYC.
// "Move to client" updates the FK and moves the SharePoint folder server-side,
// so every project and file under it follows. Admin only.
//
// Site contacts are MANY-TO-MANY: one super or on-site PM often covers several
// buildings for the same agent, so they are one contact row linked to several
// sites rather than duplicated per building.
// =============================================================================
import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, User, Building2, ExternalLink, MoveRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCanDo, useIsAdmin } from '@/lib/permissions'
import {
  createContact, addSiteContact, removeSiteContact, moveSite,
  CONTACT_TYPES, labelFor,
} from '@/lib/clientsApi'

export default function SiteDetail() {
  const { id } = useParams()
  const canDo = useCanDo()
  const isAdmin = useIsAdmin()   // plain boolean — safe in dep arrays

  const [site, setSite] = useState(null)
  const [client, setClient] = useState(null)
  const [contacts, setContacts] = useState([])   // [{contact, alsoSites:[names]}]
  const [projects, setProjects] = useState([])
  const [allClients, setAllClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  const [contactForm, setContactForm] = useState(null)
  const [moveTo, setMoveTo] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: s } = await supabase.from('sites').select('*').eq('id', id).maybeSingle()
      setSite(s)
      if (!s) return

      const { data: c } = await supabase.from('clients')
        .select('id, name, relationship_status').eq('id', s.client_id).maybeSingle()
      setClient(c)

      // Contacts linked to this site, plus which OTHER buildings each covers.
      const { data: links } = await supabase.from('site_contacts')
        .select('contact_id, role_note').eq('site_id', id)
      const ids = (links ?? []).map(l => l.contact_id)

      if (ids.length) {
        const { data: cts } = await supabase.from('contacts').select('*').in('id', ids)
        const { data: others } = await supabase.from('site_contacts')
          .select('contact_id, site_id').in('contact_id', ids).neq('site_id', id)
        const otherSiteIds = [...new Set((others ?? []).map(o => o.site_id))]
        let siteNames = {}
        if (otherSiteIds.length) {
          const { data: os } = await supabase.from('sites').select('id, name').in('id', otherSiteIds)
          siteNames = Object.fromEntries((os ?? []).map(x => [x.id, x.name]))
        }
        setContacts((cts ?? []).map(ct => ({
          ...ct,
          role_note: links.find(l => l.contact_id === ct.id)?.role_note,
          alsoSites: (others ?? []).filter(o => o.contact_id === ct.id)
            .map(o => siteNames[o.site_id]).filter(Boolean),
        })))
      } else {
        setContacts([])
      }

      const { data: ps } = await supabase.from('projects')
        .select('id, project_number, project_address, scope_type, status, current_stage, bid_amount')
        .eq('site_id', id).order('project_number', { ascending: false })
      setProjects(ps ?? [])

      if (isAdmin) {
        const { data: cl } = await supabase.from('clients')
          .select('id, name').eq('is_active', true).order('name')
        setAllClients(cl ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [id, isAdmin])

  useEffect(() => { load() }, [load])

  async function saveContact() {
    if (!contactForm?.first_name?.trim() && !contactForm?.last_name?.trim()) {
      setBanner({ kind: 'error', text: 'A first or last name is required.' }); return
    }
    try {
      // Created against the client, then linked to this building.
      const res = await createContact(
        { ...contactForm, client_id: site.client_id, site_id: id },
        [id],
      )
      if (!res?.data?.id) throw new Error('Contact was not created')
      setContactForm(null)
      await load()
    } catch (e) { setBanner({ kind: 'error', text: e.message }) }
  }

  async function unlink(contactId) {
    try { await removeSiteContact(id, contactId); await load() }
    catch (e) { setBanner({ kind: 'error', text: e.message }) }
  }

  async function doMove() {
    if (!moveTo) return
    try {
      const res = await moveSite(id, moveTo)
      setMoveTo(null)
      setBanner(res.warning
        ? { kind: 'warn', text: res.warning }
        : { kind: 'info', text: 'Site moved. Its folder and every project followed.' })
      await load()
    } catch (e) { setBanner({ kind: 'error', text: e.message }) }
  }

  if (loading) return <div className="p-6 text-ink-400 text-sm">Loading…</div>
  if (!site) return <div className="p-6 text-ink-400 text-sm">Job site not found.</div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-ink-400 mb-4">
        <Link to="/clients" className="hover:text-ink-200 inline-flex items-center gap-1.5">
          <ArrowLeft size={15} /> Clients
        </Link>
        {client && (
          <>
            <span>/</span>
            <Link to={`/clients/${client.id}`} className="hover:text-ink-200">{client.name}</Link>
          </>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink-100">{site.name}</h1>
          <p className="text-sm text-ink-400 mt-1">
            {[site.address_line1, site.borough, site.city].filter(Boolean).join(', ') || '—'}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {site.bin_number && <Tag>BIN {site.bin_number}</Tag>}
            {site.block_lot && <Tag>{site.block_lot}</Tag>}
            {site.phone && <Tag>{site.phone}</Tag>}
            {site.sharepoint_folder_url && (
              <a href={site.sharepoint_folder_url} target="_blank" rel="noreferrer"
                className="text-[10px] px-2 py-0.5 rounded bg-ink-700 text-ink-300 hover:text-ink-100 inline-flex items-center gap-1">
                SharePoint <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
        {canDo('move_site') && (
          <button onClick={() => setMoveTo(site.client_id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded border border-ink-700 text-ink-300 hover:text-ink-100 text-sm">
            <MoveRight size={15} /> Move to client
          </button>
        )}
      </div>

      {banner && (
        <div className={'mt-4 px-4 py-3 rounded text-sm ' +
          (banner.kind === 'error' ? 'bg-red-900/40 text-red-200 border border-red-700'
            : banner.kind === 'warn' ? 'bg-amber-900/30 text-amber-200 border border-amber-700'
            : 'bg-blue-900/30 text-blue-200 border border-blue-800')}>
          {banner.text}
        </div>
      )}

      <Section
        title="Site contacts"
        action={canDo('edit_client') && (
          <button onClick={() => setContactForm({
            first_name: '', last_name: '', title: '', email: '',
            phone: '', mobile: '', contact_type: 'superintendent', is_billing_contact: false,
          })} className="text-xs px-3 py-1.5 rounded bg-ink-700 hover:bg-ink-600 text-ink-100">
            + Contact
          </button>
        )}
      >
        {contacts.length === 0 ? (
          <Empty>No site contacts yet — add the super or on-site PM.</Empty>
        ) : contacts.map(ct => (
          <div key={ct.id} className="px-4 py-3 border-t border-ink-800 first:border-t-0">
            <div className="flex items-start gap-2">
              <User size={14} className="text-ink-500 mt-1 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink-100">{ct.full_name || '—'}</div>
                <div className="text-xs text-ink-400 mt-0.5">
                  {[ct.title, ct.email, ct.phone, ct.mobile && `Cell ${ct.mobile}`]
                    .filter(Boolean).join(' · ') || labelFor(CONTACT_TYPES, ct.contact_type)}
                </div>
                {ct.alsoSites?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ct.alsoSites.map(n => (
                      <span key={n} className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-ink-300">
                        ALSO {n.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {canDo('edit_client') && (
                <button onClick={() => unlink(ct.id)}
                  className="text-xs text-ink-500 hover:text-red-300 shrink-0">Unlink</button>
              )}
            </div>
          </div>
        ))}
        {contacts.some(c => c.alsoSites?.length) && (
          <div className="px-4 py-3 border-t border-ink-800 bg-blue-900/15 text-xs text-blue-200">
            One person can cover several buildings — contacts attach many-to-many, so
            editing them here updates them everywhere.
          </div>
        )}
      </Section>

      <Section title={`Projects at this site (${projects.length})`}>
        {projects.length === 0 ? (
          <Empty>No projects at this building yet.</Empty>
        ) : projects.map(p => (
          <Link key={p.id} to={`/projects/${p.id}`}
            className="flex items-center gap-3 px-4 py-3 border-t border-ink-800 first:border-t-0 hover:bg-ink-800/50">
            <Building2 size={15} className="text-ink-500 shrink-0" />
            <span className="font-mono text-xs text-blue-300 shrink-0">{p.project_number}</span>
            <div className="min-w-0 flex-1">
              <div className="text-ink-100 truncate text-sm">{p.project_address}</div>
              <div className="text-xs text-ink-400">{p.scope_type ?? '—'}</div>
            </div>
            <span className="text-xs text-ink-500 shrink-0">Stage {p.current_stage} · {p.status}</span>
          </Link>
        ))}
      </Section>

      {contactForm && (
        <Modal title="New Site Contact" onClose={() => setContactForm(null)}
               onSave={saveContact} saveLabel="Add Contact">
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
              onChange={e => setContactForm({ ...contactForm, title: e.target.value })}
              placeholder="e.g. Superintendent" />
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
        </Modal>
      )}

      {moveTo !== null && (
        <Modal title="Move site to a different client" onClose={() => setMoveTo(null)}
               onSave={doMove} saveLabel="Move Site">
          <Field label="New management company">
            <select className="input w-full text-gray-900 bg-white"
              value={moveTo} onChange={e => setMoveTo(e.target.value)}>
              {allClients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.id === site.client_id ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="px-3 py-2 rounded bg-blue-900/25 border border-blue-800 text-blue-200 text-xs space-y-1">
            <p>Every project at this building moves with it, and the SharePoint folder is
            moved server-side — no re-upload, version history intact.</p>
            <p>Billing history is not touched. Invoices already raised under the old
            company stay keyed to the old company.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ---- small building blocks ---- */
const Tag = ({ children }) =>
  <span className="text-[10px] px-2 py-0.5 rounded bg-ink-700 text-ink-300 font-mono">{children}</span>

function Section({ title, action, children }) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-wider text-ink-400 font-semibold">{title}</h2>
        {action}
      </div>
      <div className="border border-ink-800 rounded overflow-hidden">{children}</div>
    </div>
  )
}
const Empty = ({ children }) => <div className="px-4 py-6 text-sm text-ink-500">{children}</div>

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-ink-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

function Modal({ title, onClose, onSave, saveLabel, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-ink-900 border border-ink-700 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-800">
          <h2 className="text-lg font-semibold text-ink-100">{title}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-200">✕</button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-ink-800">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-ink-300 hover:text-ink-100">Cancel</button>
          <button onClick={onSave}
            className="px-4 py-2 rounded bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium">
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
