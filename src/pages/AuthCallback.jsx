import { useEffect, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'

// AuthCallback — watches session from AuthContext.
// Uses window.location.href (hard redirect) instead of React Router navigate()
// to ensure a full page reload on the way to /dashboard. This guarantees the
// Supabase client re-initializes with the stored session and all queries fire
// correctly. Without the hard redirect, the SPA navigation leaves the client
// in a partial state and the dashboard stalls until the user manually reloads.

export function AuthCallback() {
  const { session } = useAuth()
  const fallback = useRef(null)

  useEffect(() => {
    if (session) {
      clearTimeout(fallback.current)
      console.log('[auth/callback] session found — hard redirecting to dashboard')
      window.location.href = '/dashboard'
      return
    }

    if (!fallback.current) {
      console.log('[auth/callback] waiting for session...')
      fallback.current = setTimeout(() => {
        console.error('[auth/callback] no session after 12s — back to login')
        window.location.href = '/login'
      }, 12000)
    }
  }, [session])

  useEffect(() => () => clearTimeout(fallback.current), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8', fontFamily: 'system-ui', gap: '1rem' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #334155', borderTop: '3px solid #f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>Signing you in...</p>
    </div>
  )
}
