import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { AuthProvider } from '../../../src/features/auth/context/AuthContext.jsx'
import { AppShell } from '../../../src/components/layout/AppShell.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}{location.search}</p>
}

function renderShell(user) {
  const fetchMock = createFetchRouter([
    { path: '/api/auth/me', response: jsonResponse({ data: user }) },
    { path: '/api/auth/logout', method: 'POST', response: jsonResponse({ data: true }) },
    { path: '/api/auth/employee/logout', method: 'POST', response: jsonResponse({ data: true }) },
  ])
  globalThis.fetch = fetchMock
  const router = createMemoryRouter([
    {
      element: <AuthProvider><AppShell /></AuthProvider>,
      children: [
        { path: '/dashboard', element: <LocationProbe /> },
        { path: '/profile', element: <LocationProbe /> },
        { path: '/master-data', element: <LocationProbe /> },
      ],
    },
    { path: '/login', element: <p>Login screen</p> },
  ], { initialEntries: ['/dashboard'] })
  return {
    ...renderWithProviders(<RouterProvider router={router} />, { withRouter: false }),
    fetchMock,
    router,
  }
}

function scopedAdmin(overrides = {}) {
  return {
    id: 'admin-scoped',
    type: 'admin',
    role: 'DATABASE_ADMIN',
    full_name: 'Scoped Admin',
    email: 'scoped@example.test',
    can_view_student_data: true,
    can_view_employee_data: true,
    ...overrides,
  }
}

describe('AppShell', () => {
  it('shows super-admin navigation, profile identity, and closes the mobile menu after navigation', async () => {
    const { user, router } = renderShell({
      id: 'admin-1',
      type: 'admin',
      role: 'SUPER_ADMIN',
      full_name: 'Sam Admin',
      email: 'sam@example.test',
    })

    expect(await screen.findByText('Sam Admin')).toBeVisible()
    expect(screen.getByText('sam@example.test')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Master Data' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Access' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh all data' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Units' })).toHaveAttribute('href', '/master-data?tab=units')
    expect(screen.getByText('Super Admin')).toBeVisible()

    const sidebar = document.querySelector('aside')
    expect(sidebar).toHaveClass('-translate-x-full')
    await user.click(screen.getByRole('button', { name: 'Open Navigation' }))
    expect(sidebar).toHaveClass('translate-x-0')
    await user.click(screen.getByRole('link', { name: 'Profile' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(sidebar).toHaveClass('-translate-x-full')
  })

  it('limits employee navigation and logs out through the employee endpoint', async () => {
    const { user, fetchMock, router } = renderShell({
      id: 'employee-1',
      type: 'employee',
      identity: { full_name: 'Ari Employee', email: 'ari@example.test' },
    })

    expect(await screen.findByText('Ari Employee')).toBeVisible()
    expect(screen.getByRole('link', { name: 'My Profile' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Master Data' })).not.toBeInTheDocument()
    expect(screen.getByText('Employee')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Logout' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(screen.getByText('Login screen')).toBeVisible()
    expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/auth/employee/logout' && options.method === 'POST')).toBe(true)
  })

  it('keeps privileged groups hidden from database admins and uses admin logout', async () => {
    const { user, fetchMock, router } = renderShell(scopedAdmin({
      id: 'admin-2',
      full_name: 'Dana Admin',
      email: 'dana@example.test',
    }))

    expect(await screen.findByText('Dana Admin')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Employees' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('button', { name: 'Master Data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Access' })).not.toBeInTheDocument()
    expect(screen.getByText('Database Admin')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Logout' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/auth/logout' && options.method === 'POST')).toBe(true)
  })

  it('filters student and workforce navigation by domain access', async () => {
    renderShell({
      id: 'viewer-1',
      type: 'admin',
      role: 'VIEWER',
      full_name: 'Scoped Viewer',
      email: 'viewer@example.test',
      can_view_student_data: true,
      can_view_employee_data: false,
    })

    expect(await screen.findByText('Scoped Viewer')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Students' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Employees' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Academic' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Workspace' })).toBeVisible()
  })

  it('hides Workspace when Student access is disabled', async () => {
    renderShell(scopedAdmin({
      can_view_student_data: false,
      can_view_employee_data: true,
    }))

    expect(await screen.findByText('Scoped Admin')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Academic' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Workspace' })).not.toBeInTheDocument()
  })
})
