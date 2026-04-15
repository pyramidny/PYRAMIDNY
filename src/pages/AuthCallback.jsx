import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

// AuthCallback — watches the session from AuthContext.
// With detectSessionInUrl:true + lock bypass, Supabase auto-exchanges the
// ?code= param and fires onAuthStateChange(SIGNED_IN) which sets session
// in AuthContext. We just watch for it and navigate when it appears.
// No manual exchangeCodeForSession needed — no lock conflicts possible.

export function AuthCallback() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const fallback = useRef(null)

  useEffect(() => {
    if (session) {
      // Session is live — go to dashboard
      clearTimeout(fallback.current)
      console.log('[auth/callback] session found, navigating to dashboard')
      navigate('/dashboard', { replace: true })
      return
    }

    // Session not yet available — start a fallback timer (first render only)
    if (!fallback.current) {
      console.log('[auth/callback] waiting for session...')
      fallback.current = setTimeout(() => {
        console.error('[auth/callback] no session after 12s — back to login')
        navigate('/login', { replace: true })
      }, 12000)
    }
  }, [session, navigate])

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(fallback.current), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8', fontFamily: 'system-ui', gap: '1rem' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #334155', borderTop: '3px solid #f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>Signing you in...</p>
    </div>
  )
}
