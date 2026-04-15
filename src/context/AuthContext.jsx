import { supabase } from '@/lib/supabase'
import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error && data) setProfile(data)
  }

  useEffect(() => {
    // Initial session check — lock bypass in supabase.js ensures this
    // does not conflict with AuthCallback or onAuthStateChange
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) loadProfile(session.user.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        if (session?.user) {
          await loadProfile(session.user.id)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
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
