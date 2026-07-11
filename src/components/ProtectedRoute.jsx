import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute({ children, requiredRole }) {
  const { session, profile, profileError, loading } = useAuth()
  const location = useLocation()

  // Still loading auth state — show a spinner (avoids flash)
  if (loading) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <PyramidLogo size={40} />
          <div className="w-5 h-5 border-2 border-pyramid-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  // Not authenticated — redirect to login
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Authenticated with Microsoft, but no profile row yet. This means the person
  // signed in successfully but has not been loaded into the portal (no role).
  // Show a real message instead of a silent blank/stuck screen.
  if (profileError === 'NO_PROFILE') {
    return <NotProvisioned email={session?.user?.email} onSignOut={() => window.location.assign('/login')} />
  }

  // Role gate (optional)
  if (requiredRole && profile?.role !== requiredRole) {
    // Elevated roles can access everything
    const elevated = ['admin', 'director_of_operations']
    if (!elevated.includes(profile?.role)) {
      return <Navigate to="/dashboard" replace />
    }
  }

  return children
}

function NotProvisioned({ email, onSignOut }) {
  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center flex flex-col items-center gap-5">
        <PyramidLogo size={48} />
        <h1 className="text-xl font-semibold text-white">Account not set up yet</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          You signed in successfully{email ? ` as ${email}` : ''}, but your account
          hasn&apos;t been added to the Pyramid portal yet. An administrator needs to
          assign you a role before you can access projects.
        </p>
        <p className="text-sm text-slate-400">
          Please contact <a className="text-pyramid-500 underline" href="mailto:app@pyramidny.com">app@pyramidny.com</a>.
        </p>
        <button
          onClick={onSignOut}
          className="mt-2 text-xs text-slate-500 hover:text-slate-300 underline"
        >
          Sign in with a different account
        </button>
      </div>
    </div>
  )
}

function PyramidLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <polygon points="16,3 30,29 2,29" fill="#ea580c" opacity="0.9" />
      <polygon points="16,10 25,29 7,29" fill="#0F1923" opacity="0.4" />
    </svg>
  )
}
