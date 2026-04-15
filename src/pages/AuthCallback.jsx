import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function AuthCallback() {
  const [status, setStatus] = useState('Completing sign in...')
  const navigate = useNavigate()

  useEffect(() => {
    // Supabase automatically detects ?code= and calls exchangeCodeForSession
    // internally via detectSessionInUrl. We just wait for the SIGNED_IN event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          navigate('/dashboard', { replace: true })
        }
        if (event === 'TOKEN_REFRESHED' && session) {
          subscription.unsubscribe()
          navigate('/dashboard', { replace: true })
        }
      }
    )

    // Also check if session already exists (handles page refresh case)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        subscription.unsubscribe()
        navigate('/dashboard', { replace: true })
      }
    })

    // Fallback — if nothing happens in 10s, go to login
    const timeout = setTimeout(() => {
      subscription.unsubscribe()
      setStatus('Sign in timed out. Redirecting...')
      setTimeout(() => navigate('/login', { replace: true }), 1500)
    }, 10000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
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
