import { supabase } from '@/lib/supabase'
import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const AuthContext = createContext(null)

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
    // ✅ Capture ONCE at mount — before Supabase strips ?code= from the URL.
    // Checking window.location inside the event handler is too late; the URL
    // is already clean by the time SIGNED_IN fires.
    const isCallback = window.location.search.includes('code=')

    if (!isCallback) {
      // Normal page load — hydrate from existing session immediately
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session)
        if (session?.user) loadProfile(session.user.id)
        setLoading(false)
      })
    }
    // If it IS a callback, stay in loading state until SIGNED_IN fires below.
    // This prevents a flash of the login screen while the code is being exchanged.

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session)

        if (session?.user) {
          await loadProfile(session.user.id)

          // isCallback is from the closure above — still accurate even though
          // Supabase has already cleaned ?code= from the URL by now.
          if (isCallback && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
            setLoading(false)
            navigate('/dashboard', { replace: true })
            return
          }
        } else {
          setProfile(null)

          // INITIAL_SESSION can fire with null while code exchange is in flight.
          // Keep the spinner up — don't flash the login page.
          if (isCallback) return
        }

        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [navigate])

  async function signInWithMicrosoft() {
    // While app.pyramidny.com DNS is pending, keep pyramidapp.netlify.app as
    // the registered redirect. Swap this once DNS + Azure redirect URI are live.
    const redirectBase =
      window.location.hostname === 'localhost'
        ? `http://localhost:${window.location.port || 5173}`
        : 'https://pyramidapp.netlify.app'  // → swap to 'https://app.pyramidny.com' after DNS

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email profile openid',
        redirectTo: `${redirectBase}/`,
      },
    })
    if (error) throw error
  }

  async function signOut() {
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