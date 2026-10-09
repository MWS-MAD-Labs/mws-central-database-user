import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { AppCreatePage } from '../../../src/features/application-access/pages/AppCreatePage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const SCOPES = {
  path: '/api/admin/application-integration-profiles/scopes',
  response: () =>
    jsonResponse({
      data: [
        { name: 'application_permissions:write', description: 'Publish permissions', is_sensitive: false },
        { name: 'application_entitlements:read', description: 'Read entitlements', is_sensitive: false },
        { name: 'employees:read', description: 'Read employees', is_sensitive: false },
        { name: 'students:read', description: 'Read students', is_sensitive: false },
        { name: 'students:health:read', description: 'Read health', is_sensitive: true },
      ],
    }),
}

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
    globalThis.fetch = createFetchRouter([SCOPES])
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('makes the application id from the name and does not let it be typed', async () => {
    globalThis.fetch = createFetchRouter([SCOPES])
    const { user } = renderPage()
    const id = screen.getByLabelText('Application ID')
    expect(id).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), 'MWS Hub')
    expect(id).toHaveValue('mws-hub')
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Café & Co. 2')
    expect(id).toHaveValue('cafe-co-2')
  })

  it('puts the scheme in front of the address from the environment', async () => {
    globalThis.fetch = createFetchRouter([SCOPES])
    const { user } = renderPage()
    const production = screen.getByRole('radio', { name: 'Production' })
    expect(production).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByText('https://')).toHaveLength(2)
    await user.click(screen.getByRole('radio', { name: 'Local' }))
    expect(screen.getAllByText('http://')).toHaveLength(2)
    // A pasted full address loses its scheme and sets the environment.
    await user.click(screen.getByRole('radio', { name: 'Production' }))
    await user.type(screen.getByLabelText('Launch URL'), 'http://localhost:3000/auth/sso')
    expect(screen.getByLabelText('Launch URL')).toHaveValue('localhost:3000/auth/sso')
    expect(screen.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true')
  })

  it('refuses spaces, symbols and a public address on Local, without calling the server', async () => {
    const fetchMock = createFetchRouter([SCOPES])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Bad <b>')
    await user.type(screen.getByLabelText('Description'), 'hello <script>')
    await user.type(screen.getByLabelText('Icon'), 'App Window')
    await user.type(screen.getByLabelText('Launch URL'), 'exa mple.com/auth')
    await user.click(screen.getByRole('radio', { name: 'Local' }))
    await user.type(screen.getByLabelText('Logout URL'), 'exima.mws.web.id/out')
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    expect(await screen.findByText(/Use letters, numbers, spaces and/)).toBeVisible()
    expect(screen.getByText('Leave out < and > from the description.')).toBeVisible()
    expect(screen.getByText(/letters and numbers only/)).toBeVisible()
    expect(screen.getByText('No spaces allowed.')).toBeVisible()
    expect(screen.getByText('Local addresses use http. Pick Production for a public address.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('switches the environment when the pasted address is the only one, and says so', async () => {
    globalThis.fetch = createFetchRouter([SCOPES])
    const { user } = renderPage()
    await user.click(screen.getByRole('radio', { name: 'Local' }))
    await user.click(screen.getByLabelText('Launch URL'))
    await user.paste('  HTTPS://Exima.MWS.web.id/auth')
    expect(screen.getByLabelText('Launch URL')).toHaveValue('exima.mws.web.id/auth')
    expect(screen.getByRole('radio', { name: 'Production' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Environment set to Production because the address started with https/)).toBeVisible()
  })

  it('refuses a pasted scheme that clashes with the environment when the other address is filled', async () => {
    const fetchMock = createFetchRouter([SCOPES])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Demo')
    await user.type(screen.getByLabelText('Launch URL'), 'demo.example.com/auth')
    await user.click(screen.getByLabelText('Logout URL'))
    await user.paste('http://demo.example.com/out')
    // The environment stays, so the first address does not change by itself.
    expect(screen.getByRole('radio', { name: 'Production' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    expect(await screen.findByText(/starts with http:\/\/ but the Environment is Production/)).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('marks the Hub itself: id hub, no card or addresses, and sends is_hub', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () => jsonResponse({ data: { application_id: 'hub', connection: { token: 'mws_a.b', env: [{ key: 'HUB_SSO_APP_ID', value: 'hub' }] } } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'MWS Hub')
    expect(screen.getByLabelText('Application ID')).toHaveValue('mws-hub')
    await user.click(screen.getByRole('checkbox', { name: /This is the Hub itself/ }))
    expect(screen.getByLabelText('Application ID')).toHaveValue('hub')
    expect(screen.queryByLabelText('Launch URL')).toBeNull()
    expect(screen.queryByText('Hub Card')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({ name: 'MWS Hub', is_hub: true, connect: true, scope_names: ['employees:read'] })
    })
  })

  it('tidies extra spaces when leaving the name', async () => {
    globalThis.fetch = createFetchRouter([SCOPES])
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), '  MWS    Hub  ')
    await user.tab()
    expect(screen.getByLabelText('Name')).toHaveValue('MWS Hub')
  })

  it('keeps the two required scopes on and marks sensitive data', async () => {
    globalThis.fetch = createFetchRouter([SCOPES])
    renderPage()
    const required = await screen.findByRole('checkbox', { name: /Publish an application's permissions/ })
    expect(required).toBeChecked()
    expect(required).toBeDisabled()
    expect(screen.getByText('Sensitive')).toBeVisible()
  })

  it('shows a preview of the Hub card that follows what is typed', async () => {
    globalThis.fetch = createFetchRouter([SCOPES])
    const { user } = renderPage()
    expect(screen.getByText('Application name')).toBeVisible()
    await user.type(screen.getByLabelText('Name'), 'Demo App')
    await user.type(screen.getByLabelText('Launch URL'), 'demo.example.com')
    expect(screen.getByText('Demo App')).toBeVisible()
    expect(screen.getByText('Opens https://demo.example.com')).toBeVisible()
  })

  it('creates the application with its details and opens the setup steps', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () =>
          jsonResponse({
            data: {
              application_id: 'demo',
              organization_id: 'org_demo_x',
              connection: {
                token: 'mws_abc.secretsecretsecret',
                env: [{ key: 'HUB_SSO_APP_ID', value: 'demo' }, { key: 'CENTRAL_DATA_API_TOKEN', value: 'mws_abc.secretsecretsecret' }],
              },
            },
          }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Demo App')
    await user.type(screen.getByLabelText('Launch URL'), 'demo.example.com/auth/sso')
    await user.click(await screen.findByRole('checkbox', { name: /View student profiles/ }))
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    // The .env values are handed over first, the setup page follows once they are copied.
    expect(await screen.findByText('Connection Created')).toBeVisible()
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        name: 'Demo App',
        description: '',
        icon: '',
        category: '',
        launch_url: 'https://demo.example.com/auth/sso',
        logout_url: '',
        connect: true,
        scope_names: ['employees:read', 'students:read'],
      })
    })
  })
})
