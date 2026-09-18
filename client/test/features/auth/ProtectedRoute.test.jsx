import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ProtectedRoute } from '../../../src/routes/ProtectedRoute.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

function LoginDestination() {
  const location = useLocation()
  return <p>Login from {location.state?.from?.pathname || 'unknown'}</p>
}

function renderProtected(authValue) {
  return renderWithProviders(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/students']}>
        <Routes>
          <Route path="/login" element={<LoginDestination />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/students" element={<p>Protected students</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
    { withRouter: false },
  )
}

describe('ProtectedRoute', () => {
  it('shows a loading state before session resolution', () => {
    renderProtected({ isSessionLoading: true, isAuthenticated: false })

    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('Protected students')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated users and preserves the source route', () => {
    renderProtected({ isSessionLoading: false, isAuthenticated: false })

    expect(screen.getByText('Login from /students')).toBeVisible()
  })

  it('renders the protected outlet for authenticated users', () => {
    renderProtected({ isSessionLoading: false, isAuthenticated: true })

    expect(screen.getByText('Protected students')).toBeVisible()
  })
})
