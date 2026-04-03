import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment')
}

// Promise-based mutex — replaces the navigator.locks API that may not be
// available in all environments. Unlike the previous `fn()` no-op, this
// actually serializes concurrent callers so getSession() properly waits
// for an in-progress PKCE code exchange to complete before returning.
const _locks = {}
function promiseLock(name, _timeout, fn) {
  const prev = _locks[name] ?? Promise.resolve()
  let resolve
  _locks[name] = new Promise(r => (resolve = r))
  return prev.then(() => fn()).finally(() => resolve())
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
    flowType:           'pkce',
    lock:               promiseLock,
  },
})