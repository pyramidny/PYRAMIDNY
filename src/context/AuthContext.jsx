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
    const isCallback = window.location.search.includes('code=')

    // Normal page load (not an OAuth callback) — hydrate from existing session
    if (!isCallback) {
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
        const onCallbackUrl = window.location.search.includes('code=')

        setSession(session)

        if (session?.user) {
          await loadProfile(session.user.id)

          // Redirect after a successful OAuth code exchange
          if (onCallbackUrl && event === 'SIGNED_IN') {
            setLoading(false)
            navigate('/dashboard', { replace: true })
            return
          }
        } else {
          setProfile(null)

          // INITIAL_SESSION fires null before code exchange completes —
          // keep the loading spinner up so there's no login-page flash.
          if (onCallbackUrl) return
        }

        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [navigate])

  async function signInWithMicrosoft() {
    // Dynamically pick the redirect base so local dev still works
    const redirectBase =
      window.location.hostname === 'localhost'
        ? `http://localhost:${window.location.port || 5173}`
        : 'https://app.pyramidny.com'

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