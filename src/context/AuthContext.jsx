import { supabase } from '@/lib/supabase'
import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const AuthContext = createContext(null)

// Key stored in sessionStorage so it survives the Microsoft → app redirect
// but is cleared once we've consumed it.
const OAUTH_PENDING_KEY = 'pyramid_oauth_pending'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error && data) setProfile(data)
  }

  useEffect(() => {
    // ✅ Check sessionStorage — immune to Supabase stripping ?code= at module
    // load time (which happens before any React effect can read window.location).
    const isOAuthReturn = sessionStorage.getItem(OAUTH_PENDING_KEY) === '1'

    if (!isOAuthReturn) {
      // Normal page load — hydrate from existing session immediately
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session)
        if (session?.user) loadProfile(session.user.id)
        setLoading(false)
      })
    }
    // If it IS an OAuth return, stay in loading state until SIGNED_IN fires below.
    // This prevents a flash of the login screen while the code is being exchanged.

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session)

        if (session?.user) {
          await loadProfile(session.user.id)

          if (isOAuthReturn) {
            // Consume the flag — don't redirect again on subsequent events
            sessionStorage.removeItem(OAUTH_PENDING_KEY)
            setLoading(false)
            navigate('/dashboard', { replace: true })
            return
          }
        } else {
          setProfile(null)

          // INITIAL_SESSION fires null before exchange completes — keep spinner up
          if (isOAuthReturn) return
        }

        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [navigate])

  async function signInWithMicrosoft() {
    // ✅ Set the flag BEFORE redirecting to Microsoft — it survives the round trip
    sessionStorage.setItem(OAUTH_PENDING_KEY, '1')

    const redirectBase =
      window.location.hostname === 'localhost'
        ? `http://localhost:${window.location.port || 5173}`
        : 'https://pyramidapp.netlify.app'  // → swap to app.pyramidny.com after DNS + Netlify domain confirmed

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email profile openid',
        redirectTo: `${redirectBase}/`,
      },
    })

    if (error) {
      // Clean up flag if we never actually redirected
      sessionStorage.removeItem(OAUTH_PENDING_KEY)
      throw error
    }
  }

  async function signOut() {
    sessionStorage.removeItem(OAUTH_PENDING_KEY)
    await supabase.auth.signOut()
  }

  const isAdmin    = profile?.role === 'admin'
  const isElevated = ['admin', 'director_of_operations'].includes(profile?.role)
  const isPM       = ['admin', 'director_of_operations', 'project_manager', 'assistant_pm']
                       .includes(profile?.role)
  const division   = profile?.division ?? null

  const value = {
    session,
    profile,
    loading,
    signInWithMicrosoft,
    signOut,
    isAdmin,
    isElevated,
    isPM,
    division,
    user: session?.user ?? null,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}