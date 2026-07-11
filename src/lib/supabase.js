import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

// ---------------------------------------------------------------------------
// Auth config — long-lived staff sessions.
//
// autoRefreshToken + persistSession: staff stay signed in for days without
// closing the tab; the client silently refreshes the access token in the
// background and restores the session on reload.
//
// NO custom `lock` here — ON PURPOSE. The old no-op lock
// (`lock: (n,t,fn) => fn()`) disabled the browser Web Locks API, which is what
// serializes token refreshes. Without it, two refreshes could run at once;
// because Supabase refresh tokens are single-use (they rotate), the second
// call sent an already-used token and the session wedged. Since Supabase holds
// ALL data queries until the token settles, a wedged refresh froze the whole
// page (endless skeletons, blank screen). Letting supabase-js use its default
// Web Lock restores one-refresh-at-a-time and fixes the freeze.
// (Requires @supabase/supabase-js >= 2.110 for the orphaned-lock fixes.)
// ---------------------------------------------------------------------------
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // auto-exchange ?code= on the callback redirect
    flowType: 'pkce',
  },
})
