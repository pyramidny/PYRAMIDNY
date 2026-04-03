import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/context/AuthContext'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import {
  MyTasks,
  ProjectDetail,
  Settings,
  Team,
} from '@/pages/Placeholders'
import { ProjectList } from '@/pages/ProjectList'
import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

export default function App() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Soft redirect after OAuth callback
  useEffect(() => {
    if (!loading && session && location.search.includes('code=')) {
      navigate('/dashboard', { replace: true })
    }
  }, [session, loading, location])

  if (loading) return null

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Protected — all share the sidebar Layout */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"    element={<Dashboard />} />
        <Route path="/projects"     element={<ProjectList />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/tasks"        element={<MyTasks />} />
        <Route path="/team"         element={<Team />} />
        <Route path="/settings"     element={<Settings />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}