import { supabase } from '@/lib/supabase'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    // By the time this component mounts, App.jsx has already cleared its
    // loading gate — meaning Supabase has finished exchanging the ?code=
    // and SIGNED_IN has already fired. Listening for onAuthStateChange here
    // would miss that event. Instead, just read the session directly.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/dashboard', { replace: true })
      } else {
        // Exchange failed or timed out — send to login
        navigate('/login', { replace: true })
      }
    })
  }, [navigate])

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
    </div>
  )
}