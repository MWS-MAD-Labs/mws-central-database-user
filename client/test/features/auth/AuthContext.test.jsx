import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { createClientSession, readClientSession } from '../../../src/lib/clientSession.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { useAuth } from '../../../src/features/auth/hooks/useAuth.js'
import { AuthProvider } from '../../../src/features/auth/context/AuthContext.jsx'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function authFetch({ currentUser, loginUser, logoutStatus = 200 }) {
  return mock(async (url, options = {}) => {
    if (url === '/api/auth/me') {
      return currentUser
        ? jsonResponse({ data: currentUser })
        : jsonResponse({ errors: 'Unauthorized' }, 401)
    }
    if (url === '/api/auth/refresh') {
      return jsonResponse({ errors: 'Unauthorized' }, 401)
    }
    if (url === '/api/auth/employee/me') {
      return jsonResponse({ errors: 'Unauthorized' }, 401)
    }
    if (url === '/api/auth/google' && options.method === 'POST') {
      return jsonResponse({ data: loginUser })
    }
    if (url === '/api/auth/logout' && options.method === 'POST') {
      return jsonResponse(
        logoutStatus === 200 ? { data: true } : { message: 'Network error' },
        logoutStatus,
      )
    }
    throw new Error(`Unexpected auth request: ${options.method || 'GET'} ${url}`)
  })
}

function AuthProbe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(auth.isSessionLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user">{auth.user?.email || 'none'}</span>
      <span data-testid="expiry">{auth.sessionExpiresAt || 'none'}</span>
      <button type="button" onClick={() => { void auth.loginWithGoogle('code-1') }}>Login</button>
      <button type="button" onClick={() => { void auth.logout().catch(() => {}) }}>Logout</button>
    </div>
  )
}

function renderAuth() {
  return renderWithProviders(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  )
}

describe('AuthProvider', () => {
  it('loads the current user and creates missing client metadata', async () => {
    globalThis.fetch = authFetch({
      currentUser: { id: 'admin-1', email: 'admin@millennia21.id', type: 'admin' },
    })

    renderAuth()

    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('admin@millennia21.id'))
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    expect(readClientSession()?.type).toBe('admin')
  })

  it('exposes an unauthenticated state', async () => {
    globalThis.fetch = authFetch({ currentUser: null })

    renderAuth()

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    expect(screen.getByTestId('user')).toHaveTextContent('none')
  })

  it('stores login results in the auth cache and session metadata', async () => {
    globalThis.fetch = authFetch({
      currentUser: null,
      loginUser: { id: 'admin-1', email: 'admin@millennia21.id', type: 'admin' },
    })
    const { user } = renderAuth()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    await user.click(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('admin@millennia21.id'))
    expect(readClientSession()?.type).toBe('admin')
  })

  it('clears auth state even when logout fails', async () => {
    createClientSession({ type: 'admin' })
    globalThis.fetch = authFetch({
      currentUser: { id: 'admin-1', email: 'admin@millennia21.id', type: 'admin' },
      logoutStatus: 503,
    })
    const { user } = renderAuth()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('admin@millennia21.id'))

    await user.click(screen.getByRole('button', { name: 'Logout' }))

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'))
    expect(readClientSession()).toBeNull()
  })

  it('expires the session and clears cached auth at the deadline', async () => {
    const now = Date.now()
    sessionStorage.setItem('mws.clientSession', JSON.stringify({
      type: 'admin',
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 300).toISOString(),
    }))
    globalThis.fetch = authFetch({
      currentUser: { id: 'admin-1', email: 'admin@millennia21.id', type: 'admin' },
    })

    renderAuth()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('admin@millennia21.id'))
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'))

    expect(readClientSession()).toBeNull()
  })

  it('drops cached data and remembered reveals on logout', async () => {
    globalThis.fetch = authFetch({
      currentUser: { id: 'admin-1', email: 'admin@millennia21.id', type: 'admin' },
    })
    sessionStorage.setItem('pii-reveal:employee:employee-1', String(Date.now()))
    const { user, queryClient } = renderAuth()
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'))
    queryClient.setQueryData(['employees', 'employee-1'], { identity: { full_name: 'Cached Person' } })

    await user.click(screen.getByRole('button', { name: 'Logout' }))
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'))

    expect(queryClient.getQueryData(['employees', 'employee-1'])).toBeUndefined()
    expect(sessionStorage.getItem('pii-reveal:employee:employee-1')).toBeNull()
  })
})
