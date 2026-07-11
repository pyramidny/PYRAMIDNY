import { supabase } from '@/lib/supabase'
import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  // profileError:
  //   null          -> profile is fine (or not loaded yet)
  //   'NO_PROFILE'  -> signed in with Microsoft, but no row in `profiles`
  //                    (not yet loaded into the portal whitelist / no role)
  //   <string>      -> an actual DB/RLS error message
  const [profileError, setProfileError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    // maybeSingle() returns null (not an error) when there is no row, so we can
    // cleanly tell "not provisioned" apart from a real failure. .single() would
    // throw PGRST116 on zero rows and hide that distinction.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setProfileError(error.message)
      setProfile(null)
      return
    }
    if (!data) {
      setProfileError('NO_PROFILE')
      setProfile(null)
      return
    }
    setProfileError(null)
    setProfile(data)
  }

  useEffect(() => {
    let mounted = true

    // Fail-safe: never let a slow or stuck auth init freeze the UI forever.
    // If nothing has resolved within 8s, stop loading so ProtectedRoute can
    // route the user (to login) instead of showing a blank screen.
    const failSafe = setTimeout(() => {
      if (mounted) setLoading(false)
    }, 8000)

    // Single source of truth for auth state. In supabase-js v2, subscribing
    // fires an INITIAL_SESSION event right after the client finishes
    // initializing (including the PKCE code exchange), so we do NOT also call
    // getSession() — that second path is what used to race the first.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        if (!mounted) return
        setSession(nextSession)
        if (nextSession?.user) {
          await loadProfile(nextSession.user.id)
        } else {
          setProfile(null)
          setProfileError(null)
        }
        setLoading(false)
        clearTimeout(failSafe)
      }
    )

    return () => {
      mounted = false
      clearTimeout(failSafe)
      subscription.unsubscribe()
    }
  }, [])

  async function signInWithMicrosoft() {
    const redirectBase = window.location.origin
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email profile openid offline_access https://graph.microsoft.com/Sites.ReadWrite.All https://graph.microsoft.com/Files.ReadWrite',
        redirectTo: `${redirectBase}/auth/callback`,
      },
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const isAdmin = profile?.role === 'admin'
  const isElevated = ['admin', 'director_of_operations'].includes(profile?.role)
  const isPM = ['admin', 'director_of_operations', 'project_manager', 'assistant_pm']
    .includes(profile?.role)
  const division = profile?.division ?? null

  const value = {
    session,
    profile,
    profileError,
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
