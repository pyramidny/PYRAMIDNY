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

  // Never block /auth/callback — it must mount immediately so the PKCE
  // exchange runs before the one-time code expires. All other routes wait
  // for auth state to resolve before rendering.
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
