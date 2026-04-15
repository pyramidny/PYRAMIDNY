import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: false,  // WE call exchangeCodeForSession manually in AuthCallback
    flowType: 'pkce',
  },
})
