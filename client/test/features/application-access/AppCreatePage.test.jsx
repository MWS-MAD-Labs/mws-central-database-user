import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
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

const TAXONOMY = {
  path: '/api/admin/application-access/taxonomy',
  response: () =>
    jsonResponse({
      data: {
        categories: [
          { key: 'reporting', name: 'Reporting' },
          { key: 'utilities', name: 'Utilities' },
        ],
        scopes: [
          { key: 'safespace', name: 'Safespace' },
          { key: 'learnspace', name: 'Learnspace' },
        ],
      },
    }),
}

const KEY = {
  path: '/api/admin/application-access/secrets-status',
  response: () => jsonResponse({ data: { key_ready: true } }),
}

const HUB_OK = {
  path: /\/api\/admin\/application-access\/hub-address-check/,
  response: () => jsonResponse({ data: { verdict: 'ok' } }),
}

const SECRET_OK = {
  path: '/api/admin/application-access/hub-secret-check',
  method: 'POST',
  response: () => jsonResponse({ data: { verdict: 'ok' } }),
}

const APP_OK = {
  path: /\/api\/admin\/application-access\/application-address-check/,
  response: () => jsonResponse({ data: { verdict: 'ok' } }),
}

const NO_HUB = {
  path: /\/api\/admin\/application-access\/applications\?/,
  method: 'GET',
  response: () => jsonResponse({ data: [], paging: { current_page: 1, total_page: 1, total_item: 0, size: 20 } }),
}

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access/apps/new" element={<AppCreatePage />} />
          <Route path="/application-access/apps/:applicationId/setup" element={<div>Setup page</div>} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route: '/application-access/apps/new' },
  )
}

describe('AppCreatePage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('makes the application id from the name and does not let it be typed', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
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
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    const production = screen.getByRole('radio', { name: 'Production' })
    expect(production).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByText('https://')).toHaveLength(1)
    await user.click(screen.getByRole('radio', { name: 'Local' }))
    expect(screen.getAllByText('http://')).toHaveLength(1)
    // A pasted full address loses its scheme and sets the environment.
    await user.click(screen.getByRole('radio', { name: 'Production' }))
    await user.type(screen.getByLabelText('Application Address'), 'http://localhost:3000/auth/sso')
    // A pasted sign-in path is cut back to the address.
    expect(screen.getByLabelText('Application Address')).toHaveValue('localhost:3000')
    expect(screen.getByRole('radio', { name: 'Local' })).toHaveAttribute('aria-checked', 'true')
  })

  it('refuses spaces, symbols and a public address on Local, without calling the server', async () => {
    const fetchMock = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Bad <b>')
    await user.type(screen.getByLabelText('Description'), 'hello <script>')
    await user.click(screen.getByRole('button', { name: 'This application uses different paths' }))
    await user.type(screen.getByLabelText('Launch URL'), 'exa mple.com/auth')
    await user.click(screen.getByRole('radio', { name: 'Local' }))
    await user.type(screen.getByLabelText('Logout URL'), 'exima.mws.web.id/out')
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    expect(await screen.findByText(/Use letters, numbers, spaces and/)).toBeVisible()
    expect(screen.getByText('Leave out < and > from the description.')).toBeVisible()
    expect(screen.getByText('No spaces allowed.')).toBeVisible()
    expect(screen.getByText('Local addresses use http. Pick Production for a public address.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('switches the environment when the pasted address is the only one, and says so', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    await user.click(screen.getByRole('radio', { name: 'Local' }))
    await user.click(screen.getByLabelText('Application Address'))
    await user.paste('  HTTPS://Exima.MWS.web.id')
    expect(screen.getByLabelText('Application Address')).toHaveValue('exima.mws.web.id')
    expect(screen.getByRole('radio', { name: 'Production' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Environment set to Production because the address started with https/)).toBeVisible()
  })

  it('refuses a pasted scheme that clashes with the environment when the other address is filled', async () => {
    const fetchMock = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Demo')
    await user.click(screen.getByRole('button', { name: 'This application uses different paths' }))
    await user.type(screen.getByLabelText('Launch URL'), 'demo.example.com/auth')
    await user.click(screen.getByLabelText('Logout URL'))
    await user.paste('http://demo.example.com/out')
    // The environment stays, so the first address does not change by itself.
    expect(screen.getByRole('radio', { name: 'Production' })).toHaveAttribute('aria-checked', 'true')
    expect(await screen.findByText('The application answers.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    expect(await screen.findByText(/starts with http:\/\/ but the Environment is Production/)).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('marks the Hub itself and adds it through the wizard, sending is_hub with what the steps gathered', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      KEY,
      HUB_OK,
      SECRET_OK,
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () => jsonResponse({ data: { application_id: 'hub', connection: { token: 'mws_a.b', env: [{ key: 'HUB_SSO_APP_ID', value: 'hub', secret: false, group: 0, line: 'HUB_SSO_APP_ID="hub"' }] } } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'MWS Hub')
    expect(screen.getByLabelText('Application ID')).toHaveValue('mws-hub')
    await user.click(screen.getByRole('checkbox', { name: /This is the Hub itself/ }))
    expect(screen.getByLabelText('Application ID')).toHaveValue('hub')
    // The Hub is always called HUB, and neither the name nor the id can be changed.
    expect(screen.getByLabelText('Name')).toHaveValue('HUB')
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Application ID')).toBeDisabled()
    expect(screen.queryByLabelText('Launch URL')).toBeNull()
    expect(screen.queryByText('Hub Card')).toBeNull()
    // No way to add it before the last step.
    expect(screen.queryByRole('button', { name: 'Add Application' })).toBeNull()

    // 1. Address, which has to be there to go on.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    // 2. Secret. A new one is the way on without typing anything.
    expect(await screen.findByRole('radio', { name: /Make A New Secret/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    // 3. Sign-in.
    expect(screen.getByRole('radio', { name: /Warn/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    // 4. Review. The Hub checkbox is gone once past step 1.
    expect(screen.queryByRole('checkbox', { name: /This is the Hub itself/ })).toBeNull()
    expect(screen.getByText('https://app.mws.web.id')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Add the Hub' })
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    await user.click(within(confirmDialog).getByRole('button', { name: 'Add Hub' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        name: 'HUB',
        is_hub: true,
        connect: true,
        scope_names: ['employees:read'],
        env_settings: { hub_access_mode: 'warn', hub_bypass_emails: [] },
        hub_base_url: 'https://app.mws.web.id',
      })
    })
  })

  it('keeps the secret the Hub runs with when it is pasted, and blocks the step without the key', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      KEY,
      HUB_OK,
      SECRET_OK,
      { path: '/api/admin/application-access/applications', method: 'POST', response: () => jsonResponse({ data: { application_id: 'hub', connection: null } }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.click(screen.getByRole('checkbox', { name: /This is the Hub itself/ }))
    await user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('radio', { name: /Use The Hub's Current Secret/ }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.type(screen.getByLabelText('Existing Hub secret'), 'kept-from-the-hub-env-0123')
    // Not on until the Hub has said it is the right one.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Test This Secret' }))
    expect(await screen.findByText('The Hub accepts this secret.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Add the Hub' })).getByRole('button', { name: 'Add Hub' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) => options?.method === 'POST' && String(url).endsWith('/applications'))
      expect(JSON.parse(call[1].body).hub_secret).toBe('kept-from-the-hub-env-0123')
    })
  })

  it('stops at the secret step when Central has no key to keep it with', async () => {
    globalThis.fetch = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      { path: '/api/admin/application-access/secrets-status', response: () => jsonResponse({ data: { key_ready: false } }) },
      HUB_OK,
      SECRET_OK,
    ])
    const { user } = renderPage()
    await user.click(screen.getByRole('checkbox', { name: /This is the Hub itself/ }))
    await user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Central cannot keep a secret yet.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('picks the icon from the list the Hub knows and shows it on the preview', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () => jsonResponse({ data: { application_id: 'demo' } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Demo')
    await user.type(screen.getByLabelText('Application Address'), 'demo.example.com')
    await user.click(screen.getByRole('button', { name: 'Icon' }))
    expect(screen.getByRole('option', { name: 'Wallet' })).toBeVisible()
    await user.type(screen.getByLabelText('Search icons'), 'wall')
    expect(screen.queryByRole('option', { name: 'Archive' })).toBeNull()
    await user.click(screen.getByRole('option', { name: 'Wallet' }))
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveTextContent('Wallet')
    expect(await screen.findByText('The application answers.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body).icon).toBe('Wallet')
    })
  })

  it('starts on the default icon', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    renderPage()
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveTextContent('Default (AppWindow)')
  })

  it('stops the description at 50 characters and counts them', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Description'), 'x'.repeat(80))
    expect(screen.getByLabelText('Description')).toHaveValue('x'.repeat(50))
    expect(screen.getByText(/50\/50/)).toBeVisible()
  })

  it('keeps a very long name and description inside the preview card', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'A'.repeat(60))
    await user.type(screen.getByLabelText('Description'), 'y'.repeat(50))
    const name = screen.getAllByText('A'.repeat(60)).find((node) => node.tagName === 'P')
    expect(name.className).toContain('truncate')
    expect(name).toHaveAttribute('title', 'A'.repeat(60))
    const description = screen.getAllByText('y'.repeat(50)).find((node) => node.tagName === 'P')
    expect(description.className).toContain('line-clamp-2')
    expect(description.className).toContain('break-all')
  })

  it('asks how the Hub signs people in only when the Hub is chosen, on its own step', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, KEY, HUB_OK])
    const { user } = renderPage()
    expect(screen.queryByLabelText('Hub Address')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: /This is the Hub itself/ }))
    await user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('radio', { name: /Warn/ })).toHaveAttribute('aria-checked', 'true')
    // The emergency list is only for Enforce.
    expect(screen.queryByLabelText('Add an email that always gets in')).toBeNull()
    await user.click(screen.getByRole('radio', { name: /Enforce/ }))
    await user.click(screen.getByLabelText('Add an email that always gets in'))
    await user.paste('nope@gmail.com')
    expect(screen.getByText(/Only millennia21.id emails/)).toBeVisible()
    expect(screen.getByLabelText('Add an email that always gets in')).toHaveValue('nope')
    await user.click(screen.getByRole('radio', { name: /Warn/ }))
    expect(screen.queryByLabelText('Add an email that always gets in')).toBeNull()
  })

  it('adds up to three emergency emails one by one, keeping only characters an email name can have', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, KEY, HUB_OK])
    const { user } = renderPage()
    await user.click(screen.getByRole('checkbox', { name: /This is the Hub itself/ }))
    await user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('radio', { name: /Enforce/ }))
    const input = screen.getByLabelText('Add an email that always gets in')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await user.type(input, 'Me!# x{Enter}')
    expect(screen.getByRole('button', { name: 'Remove mex@millennia21.id' })).toBeVisible()
    await user.click(input)
    await user.paste('mex@millennia21.id')
    await user.keyboard('{Enter}')
    expect(screen.getByText('Each email only once.')).toBeVisible()
    await user.clear(input)
    await user.type(input, '.bad{Enter}')
    expect(screen.getByText(/cannot start or end with a dot or dash/)).toBeVisible()
    await user.clear(input)
    await user.type(input, 'boss')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(input, 'third{Enter}')
    expect(input).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remove mex@millennia21.id' }))
    expect(screen.queryByRole('button', { name: 'Remove mex@millennia21.id' })).toBeNull()
    expect(input).not.toBeDisabled()
  })

  it('offers the scopes and categories of the master data and a local example when the environment is Local', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    expect(screen.getByLabelText('Application Address')).toHaveAttribute('placeholder', 'exima.mws.web.id')
    await user.click(screen.getByRole('radio', { name: /Local/ }))
    expect(screen.getByLabelText('Application Address')).toHaveAttribute('placeholder', 'localhost:3000')
    await user.click(screen.getByRole('button', { name: 'This application uses different paths' }))
    expect(screen.getByLabelText('Launch URL')).toHaveAttribute('placeholder', 'localhost:3000/auth/sso')
    expect(screen.getByLabelText('Logout URL')).toHaveAttribute('placeholder', 'localhost:3000/auth/logout')
    await user.click(await screen.findByRole('button', { name: 'No scope' }))
    for (const name of ['No scope', 'Safespace', 'Learnspace']) {
      expect(await screen.findByRole('option', { name })).toBeVisible()
    }
    await user.click(screen.getByRole('option', { name: 'Learnspace' }))
    await user.click(screen.getByRole('button', { name: 'No category' }))
    for (const name of ['No category', 'Reporting', 'Utilities']) {
      expect(screen.getByRole('option', { name })).toBeVisible()
    }
  })

  it('shows which endpoints each data access scope opens', async () => {
    globalThis.fetch = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      {
        path: '/api/admin/api-clients/internal-endpoints',
        response: () =>
          jsonResponse({
            data: [
              { method: 'GET', path: '/api/internal/employees', scope: 'employees:read', title: 'List employees' },
              { method: 'GET', path: '/api/internal/employees/lookup?email=e@x.id', scope: 'employees:read', title: 'Find one employee' },
              { method: 'GET', path: '/api/internal/persons/lookup?email=p@x.id', scope: 'employees:read', also_scopes: ['students:read'], title: 'Find one person' },
            ],
          }),
      },
    ])
    const { user } = renderPage()
    expect(await screen.findByRole('button', { name: '3 endpoints' })).toBeVisible()
    expect(screen.getByRole('button', { name: '1 endpoint' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'No endpoint uses this scope yet' }).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: '3 endpoints' }))
    expect(screen.getByText('GET /api/internal/employees')).toBeVisible()
    expect(screen.getByText('GET /api/internal/persons/lookup')).toBeVisible()
    expect(screen.queryByText(/email=/)).toBeNull()
  })

  it('asks for the address only and fills in the standard sign-in and sign-out paths', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    expect(screen.queryByLabelText('Launch URL')).toBeNull()
    expect(screen.queryByLabelText('Logout URL')).toBeNull()
    await user.type(screen.getByLabelText('Application Address'), 'localhost:3000')
    expect(screen.getByText(/The Hub opens \/auth\/sso and signs out through \/auth\/logout/)).toBeVisible()
    // Different paths carry the address over, and back again.
    await user.click(screen.getByRole('button', { name: 'This application uses different paths' }))
    expect(screen.getByLabelText('Launch URL')).toHaveValue('localhost:3000/auth/sso')
    expect(screen.getByLabelText('Logout URL')).toHaveValue('localhost:3000/auth/logout')
    await user.clear(screen.getByLabelText('Launch URL'))
    await user.type(screen.getByLabelText('Launch URL'), 'localhost:3000/sign-in')
    await user.click(screen.getByRole('button', { name: 'Use the standard paths again' }))
    expect(screen.getByLabelText('Application Address')).toHaveValue('localhost:3000')
  })

  it('lets an application opt out of the Hub lines, and not for a plain link', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      { path: '/api/admin/application-access/applications', method: 'POST', response: () => jsonResponse({ data: { application_id: 'solo', connection: null } }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Solo')
    await user.click(screen.getByRole('button', { name: 'Single Sign-On' }))
    await user.click(screen.getByRole('option', { name: /Plain Link/ }))
    expect(screen.queryByRole('checkbox', { name: /Signs in through the Hub/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Plain Link' }))
    await user.click(screen.getByRole('option', { name: /Single Sign-On/ }))
    await user.click(screen.getByRole('checkbox', { name: /Signs in through the Hub/ }))
    await user.type(screen.getByLabelText('Application Address'), 'solo.example.com')
    expect(await screen.findByText('The application answers.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body).uses_hub).toBe(false)
    })
  })

  it('hides the Hub choice once a Hub exists', async () => {
    globalThis.fetch = createFetchRouter([
      SCOPES,
      { ...NO_HUB, response: () => jsonResponse({ data: [{ application_id: 'hub', is_hub: true }], paging: {} }) },
    ])
    renderPage()
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes('search=hub'))).toBe(true))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /This is the Hub itself/ })).toBeNull())
  })

  it('tidies extra spaces when leaving the name', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), '  MWS    Hub  ')
    await user.tab()
    expect(screen.getByLabelText('Name')).toHaveValue('MWS Hub')
  })

  it('keeps the two required scopes on and marks sensitive data', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    renderPage()
    const required = await screen.findByRole('checkbox', { name: /Publish an application's permissions/ })
    expect(required).toBeChecked()
    expect(required).toBeDisabled()
    expect(screen.getByText('Sensitive')).toBeVisible()
  })

  it('shows a preview of the Hub card that follows what is typed', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    expect(screen.getByText('Application name')).toBeVisible()
    await user.type(screen.getByLabelText('Name'), 'Demo App')
    await user.type(screen.getByLabelText('Application Address'), 'demo.example.com')
    expect(screen.getByText('Demo App')).toBeVisible()
    expect(screen.getByText('Opens https://demo.example.com/auth/sso')).toBeVisible()
  })

  it('creates the application with its details and opens the setup steps', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () =>
          jsonResponse({
            data: {
              application_id: 'demo',
              organization_id: 'org_demo_x',
              connection: {
                hub_lines_missing: true,
                token: 'mws_abc.secretsecretsecret',
                env: [{ key: 'HUB_SSO_APP_ID', value: 'demo', secret: false, group: 0, line: 'HUB_SSO_APP_ID="demo"', heading: 'This application. Fixed when it is added.' }, { key: 'CENTRAL_DATA_API_TOKEN', value: 'mws_abc.secretsecretsecret', secret: true, group: 0, line: 'CENTRAL_DATA_API_TOKEN="mws_abc.secretsecretsecret"' }],
              },
            },
          }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Demo App')
    await user.type(screen.getByLabelText('Application Address'), 'demo.example.com')
    await user.click(await screen.findByRole('checkbox', { name: /View student profiles/ }))
    expect(await screen.findByText('The application answers.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    // The .env values are handed over first, the setup page follows once they are copied.
    expect(await screen.findByText('Connection Created')).toBeVisible()
    expect(screen.getByText('The Hub lines are not here yet.')).toBeVisible()
    expect(screen.getByText('# This application. Fixed when it is added.')).toBeVisible()
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        name: 'Demo App',
        description: '',
        hub_keywords: [],
        hub_status: 'active',
        icon: '',
        category: '',
        launch_url: 'https://demo.example.com/auth/sso',
        logout_url: 'https://demo.example.com/auth/logout',
        scope: '',
        launch_mode: 'sso',
        uses_hub: true,
        connect: true,
        scope_names: ['employees:read', 'students:read'],
      })
    })
  })

  it('adds a plain link without a connection or data access', async () => {
    const fetchMock = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      APP_OK,
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () => jsonResponse({ data: { application_id: 'sheet', organization_id: 'org_sheet_x', connection: null } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Sheet')
    expect(screen.getByText(/People sign in once in the Hub/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Single Sign-On' }))
    await user.click(screen.getByRole('option', { name: /Plain Link/ }))
    expect(screen.getByText(/The card just opens the address/)).toBeVisible()
    // A plain link is any address, with no sign-in or sign-out path and no logout.
    expect(screen.queryByLabelText('Application Address')).toBeNull()
    expect(screen.queryByLabelText('Logout URL')).toBeNull()
    await user.type(screen.getByLabelText('Launch URL'), 'docs.example.com/sheet')
    expect(screen.queryByText('Data Access')).toBeNull()
    expect(await screen.findByText('The application answers.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      const body = JSON.parse(call[1].body)
      expect(body.launch_mode).toBe('link')
      expect(body.launch_url).toBe('https://docs.example.com/sheet')
      expect(body.logout_url).toBe('')
      expect(body.connect).toBeUndefined()
      expect(body.scope_names).toBeUndefined()
    })
  })

  it('holds Add Application until something answers at the address, and lets an unreachable one through after a confirm', async () => {
    let verdict = 'unreachable'
    const fetchMock = createFetchRouter([
      SCOPES,
      NO_HUB,
      TAXONOMY,
      { path: /\/api\/admin\/application-access\/application-address-check/, response: () => jsonResponse({ data: { verdict } }) },
      { path: '/api/admin/application-access/applications', method: 'POST', response: () => jsonResponse({ data: { application_id: 'demo', connection: null } }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Demo')
    await user.type(screen.getByLabelText('Application Address'), 'demo.example.com')
    expect(await screen.findByText(/Nothing answers at this address/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add Application' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Use It Anyway' }))
    const buttons = await screen.findAllByRole('button', { name: 'Use It Anyway' })
    await user.click(buttons.at(-1))
    expect(await screen.findByText('Used as typed, not checked.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add Application' })).toBeEnabled()
    verdict = 'ok'
  })

  it('says the application answers and opens Add Application', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    await user.type(screen.getByLabelText('Name'), 'Demo')
    await user.type(screen.getByLabelText('Application Address'), 'demo.example.com')
    expect(screen.getByRole('button', { name: 'Add Application' })).toBeDisabled()
    expect(await screen.findByText('The application answers.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add Application' })).toBeEnabled()
  })

  it('keeps Add Application off until the name and the address are filled', async () => {
    globalThis.fetch = createFetchRouter([SCOPES, NO_HUB, TAXONOMY, APP_OK])
    const { user } = renderPage()
    const add = screen.getByRole('button', { name: 'Add Application' })
    expect(add).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), 'Demo')
    expect(add).toBeDisabled()
    await user.type(screen.getByLabelText('Application Address'), 'demo.example.com')
    expect(await screen.findByText('The application answers.')).toBeVisible()
    expect(add).toBeEnabled()
    await user.clear(screen.getByLabelText('Name'))
    expect(add).toBeDisabled()
  })
})
