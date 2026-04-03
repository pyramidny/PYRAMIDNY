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
    const hasCode = window.location.search.includes('code=')

    if (!hasCode) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session)
        if (session?.user) loadProfile(session.user.id)
        setLoading(false)
      })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        if (session?.user) {
          await loadProfile(session.user.id)
          if (window.location.search.includes('code=')) {
            window.location.replace('/dashboard')
            return
          }
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signInWithMicrosoft() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email profile openid',
        redirectTo: 'https://pyramidapp.netlify.app/',
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