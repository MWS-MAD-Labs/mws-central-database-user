import { Database } from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { GoogleLoginButton } from '../components/GoogleLoginButton.jsx'
import { useAuth } from '../hooks/useAuth.js'

export function LoginPage() {
  const location = useLocation()
  const { isAuthenticated, isSessionLoading } = useAuth()
  const targetPath = location.state?.from?.pathname || '/'

  if (isAuthenticated) {
    return <Navigate to={targetPath} replace />
  }

  return (
    <main className="grid min-h-svh bg-[#f7f7f2] text-[#23272b] lg:grid-cols-[1fr_460px]">
      <section className="flex min-h-[42svh] flex-col justify-between border-b border-[#deded7] bg-[#24463f] p-6 text-white lg:min-h-svh lg:border-b-0 lg:border-r lg:border-[#1d3833] lg:p-10">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-white/12">
            <Database size={22} />
          </div>
          <div>
            <p className="text-sm font-semibold">MWS Data Center</p>
            <p className="text-xs text-white/70">Central User Database</p>
          </div>
        </div>

        <div className="max-w-2xl py-12 lg:py-0">
          <p className="mb-4 text-sm font-semibold uppercase text-[#cde1d8]">
            Admin Panel
          </p>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">
            School user data in one controlled workspace.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/76">
            Employee, student, API client, and audit workflows for MWS internal
            systems.
          </p>
        </div>

        <p className="text-xs text-white/62">
          Access uses Google Workspace accounts.
        </p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-md border border-[#deded7] bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-[#202326]">Sign in</h2>
            <p className="mt-1 text-sm text-[#676c70]">
              Use your MWS Google Workspace account.
            </p>
          </div>
    
          <GoogleLoginButton />

          {isSessionLoading ? (
            <p className="mt-4 text-xs text-[#77736a]">Checking session...</p>
          ) : null}
        </div>
      </section>
    </main>
  )
}
