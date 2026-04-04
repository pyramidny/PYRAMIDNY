import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'sb-izjaxmcdlsdkdliqjlei-auth-token'

function getStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.access_token ? parsed : null
  } catch {
    return null
  }
}

export function AuthCallback() {
  const [status, setStatus] = useState('Checking localStorage...')

  useEffect(() => {
    let attempts = 0

    const poll = setInterval(async () => {
      attempts++
      const session = getStoredSession()
      const msg = `Attempt ${attempts}: token=${!!session}`
      console.log('[AuthCallback]', msg)
      setStatus(msg)

      if (session) {
        clearInterval(poll)
        console.log('[AuthCallback] session found, injecting into Supabase client...')

        // ── Inject the Azure AD token into the Supabase client ──────────────
        // Without this, the client falls back to the anon key for all requests
        // and every `to authenticated` RLS policy silently rejects them.
        const { error } = await supabase.auth.setSession({
          access_token:  session.access_token,
          refresh_token: session.refresh_token ?? session.access_token,
        })

        if (error) {
          console.warn('[AuthCallback] setSession error (non-fatal):', error.message)
          // Still redirect — the user is authenticated via Azure AD even if
          // Supabase setSession has a minor hiccup
        } else {
          console.log('[AuthCallback] Supabase client session injected successfully')
        }

        window.location.replace('/dashboard')
        return
      }

      if (attempts >= 30) {
        clearInterval(poll)
        setStatus('Timed out after 15s — check console')
        console.log('[AuthCallback] timed out, localStorage keys:', Object.keys(localStorage))
      }
    }, 500)

    return () => clearInterval(poll)
  }, [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#0f172a',
      color: '#94a3b8',
      fontFamily: 'system-ui, sans-serif',
      gap: '1rem',
    }}>
      <div style={{
        width: '40px',
        height: '40px',
        border: '3px solid #334155',
        borderTop: '3px solid #f97316',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: '0.9rem' }}>Signing you in…</p>
      <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.4 }}>{status}</p>
    </div>
  )
}