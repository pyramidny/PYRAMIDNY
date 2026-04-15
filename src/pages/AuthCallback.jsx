import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function AuthCallback() {
  const [status, setStatus] = useState('Completing sign in...')
  const navigate = useNavigate()

  useEffect(() => {
    let authSub = null
    let fallbackTimer = null

    const run = async () => {
      try {
        // Already have a valid session? (e.g. page refresh on /auth/callback)
        const { data: { session: existing } } = await supabase.auth.getSession()
        if (existing) {
          navigate('/dashboard', { replace: true })
          return
        }

        // Exchange the PKCE code for a session — we own this call
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href)
        if (error) {
          console.error('[AuthCallback] exchange failed:', error.message)
          setStatus('Sign in failed — redirecting...')
          setTimeout(() => navigate('/login', { replace: true }), 2000)
          return
        }

        // Wait for onAuthStateChange to confirm the session is live in AuthContext
        // before navigating. This prevents the race condition where ProtectedRoute
        // sees loading=false + session=null and bounces to /login.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
            subscription.unsubscribe()
            clearTimeout(fallbackTimer)
            navigate('/dashboard', { replace: true })
          }
        })
        authSub = subscription

        // Safety fallback — if the event never fires within 8s, bail to login
        fallbackTimer = setTimeout(() => {
          authSub?.unsubscribe()
          navigate('/login', { replace: true })
        }, 8000)

      } catch (e) {
        console.error('[AuthCallback] unexpected:', e)
        navigate('/login', { replace: true })
      }
    }

    run()

    return () => {
      authSub?.unsubscribe()
      clearTimeout(fallbackTimer)
    }
  }, [navigate])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8', fontFamily: 'system-ui', gap: '1rem' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #334155', borderTop: '3px solid #f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>Signing you in...</p>
      <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.4 }}>{status}</p>
    </div>
  )
}
