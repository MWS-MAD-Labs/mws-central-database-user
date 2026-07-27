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
    <main className="grid min-h-svh bg-[#fffafa] text-[var(--mws-charcoal)] lg:grid-cols-[1fr_460px]">
      <section className="flex min-h-[42svh] flex-col justify-between border-b border-[var(--mws-line)] bg-[var(--mws-burgundy)] p-6 text-white lg:min-h-svh lg:border-b-0 lg:border-r lg:border-[var(--mws-burgundy-dark)] lg:p-10">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/12">
            <Database size={22} />
          </div>
          <div>
            <p className="font-display text-sm font-bold">MWS Data Center</p>
            <p className="text-xs text-white/70">Central User Database</p>
          </div>
        </div>

        <div className="max-w-2xl py-12 lg:py-0">
          <p className="mb-4 font-display text-sm font-bold text-[#fff4d8]">
            Admin Panel
          </p>
          <h1 className="max-w-xl font-display text-4xl font-extrabold leading-tight sm:text-5xl">
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
        <div className="w-full max-w-sm rounded-3xl border border-[var(--mws-line)] bg-white p-6 shadow-[0_20px_60px_-44px_rgba(36,23,24,0.6)]">
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-[var(--mws-charcoal)]">Sign in</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--mws-muted)]">
              Use your MWS Google Workspace account.
            </p>
          </div>
    
          <GoogleLoginButton />

          {isSessionLoading ? (
            <p className="mt-4 text-xs text-[var(--mws-muted)]">Checking session...</p>
          ) : null}
        </div>
      </section>
    </main>
  )
}
