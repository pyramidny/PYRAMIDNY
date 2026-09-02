import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/context/AuthContext'
import { AuthCallback } from '@/pages/AuthCallback'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { MyTasks } from '@/pages/MyTasks'
import NewProject from '@/pages/NewProject'
import TeamManagement from '@/pages/TeamManagement'
import ToolControl from '@/pages/ToolControl'
import Settings from '@/pages/Settings'
import Notifications from '@/pages/Notifications'
import ProjectDetail from '@/pages/ProjectDetail'
import { ProjectList } from '@/pages/ProjectList'
import ClientList from '@/pages/ClientList'
import Guides from '@/pages/Guides'
import ClientDetail from '@/pages/ClientDetail'
import SiteDetail from '@/pages/SiteDetail'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

export default function App() {
  const { loading } = useAuth()
  const location = useLocation()

  if (location.pathname === '/' && location.search.includes('code=')) {
    return <Navigate to={`/auth/callback${location.search}`} replace />
  }

  const isCallback = location.pathname === '/auth/callback'
  if (loading && !isCallback) return null

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

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
        <Route path="/clients" element={<ClientList />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/sites/:id" element={<SiteDetail />} />
        <Route path="/tasks" element={<MyTasks />} />
        <Route path="/tools" element={<ToolControl />} />
        <Route path="/team" element={<TeamManagement />} />
        <Route path="/guides" element={<Guides />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/notifications" element={<Notifications />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
