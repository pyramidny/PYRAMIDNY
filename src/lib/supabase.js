import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment')
}

// ── Read the Azure AD token from localStorage on client init ─────────────────
// The Azure AD PKCE flow stores the session here but doesn't sign it with
// Supabase's JWT secret, so the client won't pick it up automatically.
// We inject it manually as the Authorization header so every request goes
// out as Bearer <token> rather than falling back to the anon key.
const STORAGE_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

function getStoredAccessToken() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.access_token ?? null
  } catch {
    return null
  }
}

const accessToken = getStoredAccessToken()

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  global: {
    headers: accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : {},
  },
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
    flowType:           'pkce',
    lock:               async (name, timeout, fn) => fn(),
  },
})

// ── Allow runtime header injection after login ───────────────────────────────
// Called by AuthCallback after the token lands in localStorage so the
// already-initialized client also gets the header without a page reload.
export function injectAccessToken(token) {
  if (token) {
    supabase.rest.headers['Authorization'] = `Bearer ${token}`
  }
}