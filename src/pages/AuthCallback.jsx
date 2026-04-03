import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'

export function AuthCallback() {
  const [status, setStatus] = useState('Waiting for session...')

  useEffect(() => {
    let attempts = 0

    const poll = setInterval(async () => {
      attempts++
      const { data: { session }, error } = await supabase.auth.getSession()

      const msg = `Attempt ${attempts}: session=${!!session} error=${error?.message ?? 'none'}`
      console.log('[AuthCallback]', msg)
      setStatus(msg)

      if (session) {
        clearInterval(poll)
        window.location.replace('/dashboard')
        return
      }

      if (attempts >= 20) {
        clearInterval(poll)
        setStatus('Timed out — redirecting to login')
        window.location.replace('/login')
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
      <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.4, textAlign: 'center' }}>{status}</p>
    </div>
  )
}