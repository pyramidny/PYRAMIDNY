import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallback() {
  const [status, setStatus] = useState('Completing sign in...')
  const navigate = useNavigate()

  useEffect(() => {
    const run = async () => {
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(
          window.location.href
        )
        if (error) {
          console.error('[AuthCallback] error:', error.message)
          setStatus('Error: ' + error.message)
          setTimeout(() => navigate('/login', { replace: true }), 3000)
          return
        }
        if (data && data.session) {
          navigate('/dashboard', { replace: true })
        } else {
          setStatus('Waiting for session...')
          const { data: authData } = supabase.auth.onAuthStateChange(
            (_event, session) => {
              if (session) {
                authData.subscription.unsubscribe()
                navigate('/dashboard', { replace: true })
              }
            }
          )
          setTimeout(() => {
            authData.subscription.unsubscribe()
            navigate('/login', { replace: true })
          }, 8000)
        }
      } catch (e) {
        console.error('[AuthCallback] unexpected error:', e)
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
