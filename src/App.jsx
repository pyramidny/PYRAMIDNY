import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/context/AuthContext'
import { AuthCallback } from '@/pages/AuthCallback'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { MyTasks } from '@/pages/MyTasks'
import NewProject from '@/pages/NewProject'; // ← ADD THIS
import TeamManagement from '@/pages/TeamManagement'
import { Settings, Team } from '@/pages/Placeholders'
import ProjectDetail from '@/pages/ProjectDetail'
import { ProjectList } from '@/pages/ProjectList'
import { Navigate, Route, Routes } from 'react-router-dom'

export default function App() {
  const { loading } = useAuth()

    if (window.location.pathname === '/auth/callback' || window.location.search.includes('code=')) {
    return (
      <Routes>
                  <Route path="*" element={<AuthCallback />} />
      </Routes>
    )
  }

  if (loading) return null

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"      element={<Dashboard />} />
        <Route path="/projects"       element={<ProjectList />} />
        <Route path="/projects/new"   element={<NewProject />} />  {/* ← ADD THIS */}
        <Route path="/projects/:id"   element={<ProjectDetail />} />
        <Route path="/tasks"          element={<MyTasks />} />
                  <Route path="/team"         element={<TeamManagement />} />
        <Route path="/settings"       element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
