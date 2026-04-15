import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function AuthCallback() {
  const [status, setStatus] = useState('Completing sign in...')
  const navigate = useNavigate()
  const ran = useRef(false)

  useEffect(() => {
    const finishLogin = async () => {
      // Guard: prevent double-fire (React effect timing, strict mode, etc.)
      if (ran.current) return
      ran.current = true

      // Extract the code param — Supabase expects the CODE, not the full URL
      const code = new URL(window.location.href).searchParams.get('code')
      console.log('[auth/callback] code present?', !!code)

      if (!code) {
        // No code — might be a direct hit or refresh. Check for existing session.
        const { data: { session } } = await supabase.auth.getSession()
        console.log('[auth/callback] no code, existing session?', !!session)
        if (session) {
          navigate('/dashboard', { replace: true })
        } else {
          console.error('[auth/callback] no code and no session')
          navigate('/login', { replace: true })
        }
        return
      }

      // Exchange the PKCE code for a session
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      console.log('[auth/callback] exchange result', { session: !!data?.session, error })

      if (error) {
        console.error('[auth/callback] exchange failed', error.message)
        setStatus('Sign in failed — ' + error.message)
        setTimeout(() => navigate('/login', { replace: true }), 2500)
        return
      }

      // Verify session is available immediately after exchange
      const { data: { session } } = await supabase.auth.getSession()
      console.log('[auth/callback] getSession after exchange:', !!session)

      if (session) {
        navigate('/dashboard', { replace: true })
      } else {
        console.error('[auth/callback] exchange succeeded but getSession returned null')
        setStatus('Session error — redirecting...')
        setTimeout(() => navigate('/login', { replace: true }), 2500)
      }
    }

    finishLogin()
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
