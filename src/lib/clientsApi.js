// src/lib/clientsApi.js
// =============================================================================
// CLIENT / SITE / CONTACT API  —  Deploy B
//
// Every write goes through project-proxy on the service_role key. Direct
// Supabase writes are blocked by RLS for Azure AD users (the tables grant
// authenticated SELECT and nothing else), so this is the only write path.
//
// READS are done straight from the page with the authenticated supabase
// client — the SELECT policies allow it and it avoids a round trip.
// =============================================================================

const PROXY_URL =
  'https://izjaxmcdlsdkdliqjlei.supabase.co/functions/v1/project-proxy'

const SP_TOKEN_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

/**
 * Azure AD access token. `supabase.auth.getSession()` returns null for Azure
 * AD JWTs — this is by design, not a bug to fix. Read it from localStorage.
 */
export function getAccessToken() {
  try {
    const raw = localStorage.getItem(SP_TOKEN_KEY)
    return raw ? JSON.parse(raw)?.access_token ?? null : null
  } catch {
    return null
  }
}

/**
 * Calls the proxy. Returns the whole envelope (not just `data`) because
 * several actions carry a `warning` — SharePoint failed but the row saved —
 * and the caller needs to surface it.
 */
async function call(payload) {
  const token = getAccessToken()
  if (!token) throw new Error('Not signed in')

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`Proxy returned ${res.status}`)
  }
  if (!res.ok) throw new Error(json?.error ?? `Proxy error ${res.status}`)
  return json
}

/* ---- clients ------------------------------------------------------------ */
export const createClient  = (client)          => call({ action: 'client_create', client })
export const updateClient  = (id, updates)     => call({ action: 'client_update', id, updates })
export const deleteClient  = (id)              => call({ action: 'client_delete', id })
export const promoteClient = (id)              => call({ action: 'client_promote', id })

/* ---- sites -------------------------------------------------------------- */
export const createSite = (site)               => call({ action: 'site_create', site })
export const updateSite = (id, updates)        => call({ action: 'site_update', id, updates })
export const deleteSite = (id)                 => call({ action: 'site_delete', id })

/**
 * Reassign a building to a different management company. Moves the SharePoint
 * folder server-side so every project and file under it follows. Admin only.
 */
export const moveSite = (siteId, newClientId)  => call({ action: 'move_site', siteId, newClientId })

/* ---- contacts ----------------------------------------------------------- */
// siteIds is optional on create and AUTHORITATIVE on update — pass the full
// set of buildings this person covers, or omit it to leave links untouched.
export const createContact = (contact, siteIds) => call({ action: 'contact_create', contact, siteIds })
export const updateContact = (id, updates, siteIds) => call({ action: 'contact_update', id, updates, siteIds })
export const deleteContact = (id)               => call({ action: 'contact_delete', id })

export const addSiteContact    = (siteId, contactId, roleNote) =>
  call({ action: 'site_contact_add', siteId, contactId, roleNote })
export const removeSiteContact = (siteId, contactId) =>
  call({ action: 'site_contact_remove', siteId, contactId })

export const addProjectContact    = (projectId, contactId, roleNote) =>
  call({ action: 'project_contact_add', projectId, contactId, roleNote })
export const removeProjectContact = (projectId, contactId) =>
  call({ action: 'project_contact_remove', projectId, contactId })

/* ---- folders ------------------------------------------------------------ */
export const backfillFolders = () => call({ action: 'backfill_folders' })

/** Non-blocking preflight for the New Client / New Project banner. */
export async function graphHealth() {
  try {
    return await call({ action: 'graph_health' })
  } catch (e) {
    return { ok: false, reason: 'unreachable', message: String(e) }
  }
}

/* ---- display helpers ---------------------------------------------------- */
export const CLIENT_TYPES = [
  ['managing_agent',     'Managing Agent'],
  ['owner',              'Owner'],
  ['architect',          'Architect'],
  ['engineer',           'Engineer'],
  ['general_contractor', 'General Contractor'],
  ['other',              'Other'],
]

export const CONTACT_TYPES = [
  ['primary',          'Primary'],
  ['billing',          'Billing'],
  ['property_manager', 'Property Manager'],
  ['architect',        'Architect'],
  ['engineer',         'Engineer'],
  ['board_member',     'Board Member'],
  ['superintendent',   'Superintendent'],
  ['other',            'Other'],
]

export const labelFor = (list, value) =>
  list.find(([v]) => v === value)?.[1] ?? value ?? '—'
