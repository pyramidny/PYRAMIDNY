import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function Login() {
  const { session, signInWithMicrosoft } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  // Already logged in — bounce to dashboard
  useEffect(() => {
    if (session) navigate('/dashboard', { replace: true })
  }, [session, navigate])

  async function handleSignIn() {
    setLoading(true)
    setError(null)
    try {
      await signInWithMicrosoft()
      // Page will redirect to Azure AD; nothing more needed here
    } catch (err) {
      setError('Sign-in failed. Please try again or contact your administrator.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col">

      {/* Background texture */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            0deg, transparent, transparent 39px,
            rgba(255,255,255,1) 39px, rgba(255,255,255,1) 40px
          ),
          repeating-linear-gradient(
            90deg, transparent, transparent 39px,
            rgba(255,255,255,1) 39px, rgba(255,255,255,1) 40px
          )`
        }}
      />

      {/* Orange accent bar — top */}
      <div className="relative h-1 bg-gradient-to-r from-pyramid-700 via-pyramid-500 to-pyramid-700" />

      {/* Center card */}
      <div className="relative flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">

          {/* Logo mark */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <PyramidLogo size={72} />
              <div
                className="absolute -inset-4 rounded-full opacity-20"
                style={{ background: 'radial-gradient(circle, #ea580c 0%, transparent 70%)' }}
              />
            </div>
          </div>

          {/* Headings */}
          <div className="text-center mb-8">
            <h1 className="font-condensed font-bold text-white text-3xl tracking-widest uppercase mb-1">
              Pyramid Portal
            </h1>
            <p className="text-ink-500 text-sm tracking-wide">
              RESTORATION SPECIALISTS
            </p>
          </div>

          {/* Card */}
          <div className="bg-ink-900 rounded-2xl border border-white/8 p-8">
            <p className="text-ink-400 text-sm text-center mb-6 leading-relaxed">
              Sign in with your{' '}
              <span className="text-ink-200 font-medium">@pyramidny.com</span>{' '}
              Microsoft account to access the project portal.
            </p>

            {/* Microsoft Sign-In button */}
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5
                         bg-white hover:bg-ink-100 disabled:bg-ink-200
                         text-ink-900 font-semibold text-sm rounded-xl
                         transition-all duration-150 active:scale-98
                         shadow-sm disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-ink-400 border-t-ink-900 rounded-full animate-spin" />
              ) : (
                <MicrosoftLogo />
              )}
              {loading ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
            </button>

            {error && (
              <div className="mt-4 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-ink-700 text-xs mt-8">
            Access is restricted to authorized Pyramid Restoration personnel.
            <br />
            Contact{' '}
            <a
              href="mailto:support@kanepc.com"
              className="text-ink-500 hover:text-ink-300 transition-colors"
            >
              Kane PC
            </a>{' '}
            for access issues.
          </p>
        </div>
      </div>

      {/* Bottom division strip */}
      <div className="relative flex h-12 overflow-hidden">
        <div className="flex-1 bg-regular/20 flex items-center justify-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-regular" />
          <span className="text-regular text-xs font-condensed font-semibold tracking-widest uppercase">
            Regular Construction
          </span>
        </div>
        <div className="w-px bg-white/6" />
        <div className="flex-1 bg-ira/20 flex items-center justify-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-ira" />
          <span className="text-ira text-xs font-condensed font-semibold tracking-widest uppercase">
            IRA / Rope Access
          </span>
        </div>
      </div>
    </div>
  )
}

function PyramidLogo({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none">
      <polygon points="36,4 70,68 2,68" fill="#ea580c" />
      <polygon points="36,24 58,68 14,68" fill="#0F1923" opacity="0.45" />
    </svg>
  )
}

function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
      <rect x="1"  y="1"  width="9" height="9" fill="#f25022" />
      <rect x="11" y="1"  width="9" height="9" fill="#7fba00" />
      <rect x="1"  y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}
