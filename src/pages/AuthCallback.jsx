import { injectAccessToken } from '@/lib/supabase'
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

    const poll = setInterval(() => {
      attempts++
      const session = getStoredSession()
      const msg = `Attempt ${attempts}: token=${!!session}`
      console.log('[AuthCallback]', msg)
      setStatus(msg)

      if (session) {
        clearInterval(poll)
        console.log('[AuthCallback] session found, injecting into Supabase client...')

        // Inject the token into the already-initialized Supabase client
        // so all subsequent requests go out with Bearer <token>
        injectAccessToken(session.access_token)

        console.log('[AuthCallback] token injected, redirecting to dashboard')
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