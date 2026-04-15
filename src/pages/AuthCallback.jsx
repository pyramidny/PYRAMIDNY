import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function AuthCallback() {
  const [status, setStatus] = useState('Completing sign in...')
  const navigate = useNavigate()

  useEffect(() => {
    const run = async () => {
      try {
        const url = window.location.href

        // If already have a session, go straight to dashboard
        const { data: { session: existing } } = await supabase.auth.getSession()
        if (existing) {
          navigate('/dashboard', { replace: true })
          return
        }

        // Exchange PKCE code for session
        const { error } = await supabase.auth.exchangeCodeForSession(url)
        if (error) {
          console.error('[AuthCallback] exchange failed:', error.message)
          setStatus('Sign in failed — redirecting...')
          setTimeout(() => navigate('/login', { replace: true }), 2000)
          return
        }

        // Wait for onAuthStateChange to confirm session is live in context
        // This prevents the race where ProtectedRoute redirects to /login
        // before AuthContext has propagated the new session
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
            subscription.unsubscribe()
            navigate('/dashboard', { replace: true })
          }
        })

        // Safety fallback — if event doesn't fire within 5s
        setTimeout(() => {
          subscription.unsubscribe()
          navigate('/login', { replace: true })
        }, 5000)

      } catch (e) {
        console.error('[AuthCallback] unexpected:', e)
        navigate('/login', { replace: true })
      }
    }

    run()
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
