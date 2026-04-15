import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallback() {
    const [status, setStatus] = useState('Completing sign in…')
    const navigate = useNavigate()

  useEffect(() => {
        const handleCallback = async () => {
                try {
                          // PKCE: exchange the ?code= in the URL for a real session
                  const { data, error } = await supabase.auth.exchangeCodeForSession(
                              window.location.href
                            )

                  if (error) {
                              console.error('[AuthCallback] exchange error:', error.message)
                              setStatus(`Error: ${error.message}`)
                              setTimeout(() => navigate('/login', { replace: true }), 3000)
                              return
                  }

                  if (data?.session) {
                              console.log('[AuthCallback] session established, going to dashboard')
                              navigate('/dashboard', { replace: true })
                  } else {
                              // Supabase sometimes handles it via onAuthStateChange — wait briefly
                            setStatus('Waiting for session…')
                              const { data: { subscription } } = supabase.auth.onAuthStateChange(
                                            (_event, session) => {
                                                            if (session) {
                                                                              subscription.unsubscribe()
                                                                              navigate('/dashboard', { replace: true })
                                                            }
                                            }
                                          )
                              // Fallback: if still nothing after 8s, send to login
                            setTimeout(() => {
                                          subscription.unsubscribe()
                                          navigate('/login', { replace: true })
                            }, 8000)
                  }
                } catch (e) {
                          console.error('[AuthCallback] unexpected error:', e)
                          navigate('/login', { replace: true })
                }
        }

                handleCallback()
  }, [navigate])

  return (
        <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100vh', backgroundColor: '#0f172a',
                color: '#94a3b8', fontFamily: 'system-ui, sans-serif', gap: '1rem',
        }}>
                <div style={{
                  width: '40px', height: '40px', border: '3px solid #334155',
                  borderTop: '3px solid #f97316', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
        }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>Signing you in…</p>
              <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.4 }}>{status}</p>
        </div>
      )
}</style>
