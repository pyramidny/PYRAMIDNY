import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,   // Let Supabase auto-exchange ?code= at any URL
    flowType: 'pkce',
    // Bypass the Web Locks API — prevents the "lock stolen" error that kills
    // the PKCE exchange when AuthContext and AuthCallback both initialize
    // simultaneously on the /auth/callback page.
    lock: async (_name, _timeout, fn) => fn(),
  },
})
