import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { AppCreatePage } from '../../../src/features/application-access/pages/AppCreatePage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/new" element={<AppCreatePage />} />
        <Route path="/application-access/apps/:applicationId/setup" element={<div>Setup page</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/application-access/apps/new' },
  )
}

describe('AppCreatePage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter([])
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('turns capital letters into lowercase as they are typed', async () => {
    globalThis.fetch = createFetchRouter([])
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Application ID'), 'ExIMa')
    expect(screen.getByLabelText('Application ID')).toHaveValue('exima')
  })

  it('turns spaces into underscores and drops other symbols', async () => {
    globalThis.fetch = createFetchRouter([])
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Application ID'), 'My App!')
    expect(screen.getByLabelText('Application ID')).toHaveValue('my_app')
  })

  it('rejects a badly formatted id, a missing name and a bad address without calling the server', async () => {
    const fetchMock = createFetchRouter([])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Application ID'), '9 lives')
    await user.type(screen.getByLabelText('Launch URL'), 'ftp://nope')
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    expect(await screen.findByText(/^Use lowercase letters/)).toBeVisible()
    expect(screen.getByText('Name is required.')).toBeVisible()
    expect(screen.getByText('Start with http:// or https://.')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a preview of the Hub card that follows what is typed', async () => {
    globalThis.fetch = createFetchRouter([])
    const { user } = renderPage()
    expect(screen.getByText('Application name')).toBeVisible()
    await user.type(screen.getByLabelText('Name'), 'Demo App')
    await user.type(screen.getByLabelText('Launch URL'), 'https://demo.example.com')
    expect(screen.getByText('Demo App')).toBeVisible()
    expect(screen.getByText('Opens https://demo.example.com')).toBeVisible()
  })

  it('creates the application with its details and opens the setup steps', async () => {
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () => jsonResponse({ data: { application_id: 'demo', organization_id: 'org_demo_x' } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Application ID'), 'demo')
    await user.type(screen.getByLabelText('Name'), 'Demo App')
    await user.type(screen.getByLabelText('Launch URL'), 'https://demo.example.com/auth/sso')
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    expect(await screen.findByText('Setup page')).toBeVisible()
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        application_id: 'demo',
        name: 'Demo App',
        description: '',
        icon: '',
        category: '',
        launch_url: 'https://demo.example.com/auth/sso',
        logout_url: '',
      })
    })
  })
})
