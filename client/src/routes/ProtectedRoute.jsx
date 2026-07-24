import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../features/auth/hooks/useAuth.js'

export function ProtectedRoute() {
  const location = useLocation()
  const { isAuthenticated, isSessionLoading } = useAuth()

  if (isSessionLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[#f7f7f2] text-[#24463f]">
        <LoaderCircle size={28} className="animate-spin" />
      </main>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
