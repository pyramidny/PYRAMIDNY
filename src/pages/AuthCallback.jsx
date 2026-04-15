import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

// With detectSessionInUrl:true and the lock bypass in supabase.js, Supabase
// automatically exchanges the ?code= param when the client initializes —
// no need to call exchangeCodeForSession manually. This component just waits
// for the SIGNED_IN event to fire and then navigates to the dashboard.

export function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    let sub = null
    let timer = null

    // Check if session already set (fast path — exchange already completed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[auth/callback] getSession on mount:', !!session)
      if (session) {
        navigate('/dashboard', { replace: true })
        return
      }

      // Session not ready yet — wait for SIGNED_IN event
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        console.log('[auth/callback] onAuthStateChange:', event, !!session)
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
          subscription.unsubscribe()
          clearTimeout(timer)
          navigate('/dashboard', { replace: true })
        }
      })
      sub = subscription

      // Safety fallback — 10s
      timer = setTimeout(() => {
        sub?.unsubscribe()
        console.error('[auth/callback] timeout — no session after 10s')
        navigate('/login', { replace: true })
      }, 10000)
    })

    return () => {
      sub?.unsubscribe()
      clearTimeout(timer)
    }
  }, [navigate])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8', fontFamily: 'system-ui', gap: '1rem' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #334155', borderTop: '3px solid #f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>Signing you in...</p>
    </div>
  )
}
