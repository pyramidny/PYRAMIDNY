import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/context/AuthContext'
import { AuthCallback } from '@/pages/AuthCallback'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { MyTasks } from '@/pages/MyTasks'
import NewProject from '@/pages/NewProject'
import TeamManagement from '@/pages/TeamManagement'
import { Settings, Team } from '@/pages/Placeholders'
import ProjectDetail from '@/pages/ProjectDetail'
import { ProjectList } from '@/pages/ProjectList'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

export default function App() {
  const { loading } = useAuth()
  const location = useLocation()

  // Supabase sometimes redirects ?code= to the root URL instead of /auth/callback.
  // Catch it here and forward to the proper handler before anything else renders.
  if (location.pathname === '/' && location.search.includes('code=')) {
    return <Navigate to={`/auth/callback${location.search}`} replace />
  }

  // Never block /auth/callback with the loading gate — it must mount immediately
  // so the PKCE exchange can run before the one-time code expires.
  const isCallback = location.pathname === '/auth/callback'
  if (loading && !isCallback) return null

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/new" element={<NewProject />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/tasks" element={<MyTasks />} />
        <Route path="/team" element={<TeamManagement />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
