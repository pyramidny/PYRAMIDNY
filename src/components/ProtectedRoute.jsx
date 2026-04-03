import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute({ children, requiredRole }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  // Still loading auth state — show nothing (avoids flash)
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

function PyramidLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <polygon points="16,3 30,29 2,29" fill="#ea580c" opacity="0.9" />
      <polygon points="16,10 25,29 7,29" fill="#0F1923" opacity="0.4" />
    </svg>
  )
}
