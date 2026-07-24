import { Navigate } from 'react-router'
import { DashboardPage } from '../features/dashboard/pages/DashboardPage.jsx'
import { useAuth } from '../features/auth/hooks/useAuth.js'

export function RoleHome() {
  const { user } = useAuth()

  if (user?.type === 'employee') {
    return <Navigate to="/profile" replace />
  }

  return <DashboardPage />
}
