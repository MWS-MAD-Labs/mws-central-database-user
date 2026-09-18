import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { LoginPage } from '../../../src/features/auth/pages/LoginPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

const loginStub = () => null

function renderLogin(authValue, initialEntry = '/login') {
  return renderWithProviders(
    <AuthContext.Provider value={{ loginWithGoogle: loginStub, isLoggingIn: false, ...authValue }}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/students" element={<p>Students destination</p>} />
          <Route path="/" element={<p>Home destination</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
    { withRouter: false },
  )
}

describe('LoginPage', () => {
  it('renders the Google sign-in entry point', () => {
    renderLogin({ isAuthenticated: false, isSessionLoading: false })

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
    expect(screen.queryByText('Checking session...')).not.toBeInTheDocument()
  })

  it('shows session checking feedback', () => {
    renderLogin({ isAuthenticated: false, isSessionLoading: true })
    expect(screen.getByText('Checking session...')).toBeVisible()
  })

  it('redirects authenticated users to their source route', () => {
    renderLogin(
      { isAuthenticated: true, isSessionLoading: false },
      { pathname: '/login', state: { from: { pathname: '/students' } } },
    )
    expect(screen.getByText('Students destination')).toBeVisible()
  })

  it('redirects authenticated users home without a source route', () => {
    renderLogin({ isAuthenticated: true, isSessionLoading: false })
    expect(screen.getByText('Home destination')).toBeVisible()
  })
})
