import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { AppSetupPage } from '../../../src/features/application-access/pages/AppSetupPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const APP = {
  application_id: 'demo',
  name: 'Demo App',
  description: null,
  icon: null,
  category: null,
  launch_url: 'https://demo.example.com/auth/sso',
  logout_url: null,
  published: false,
}

function makeSetup(overrides = {}) {
  return {
    application: APP,
    organization_id: 'org_demo_abcdefghijklmnopqrst',
    connection: { client_id: null, created: false, last_used_at: null },
    permissions: { count: 0, synced_at: null },
    roles: { active_count: 0 },
    groups: { active_count: 0 },
    can_publish: false,
    missing: ['permissions', 'roles', 'groups'],
    is_hub: false,
    data_access: { scope_names: ['application_entitlements:read', 'application_permissions:write'], editable: true },
    ...overrides,
  }
}

function renderPage(routes, user = { role: 'SUPER_ADMIN' }) {
  globalThis.fetch = createFetchRouter(routes)
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access/apps/:applicationId/setup" element={<AppSetupPage />} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route: '/application-access/apps/demo/setup' },
  )
}

const setupRoute = (setup) => ({
  path: '/api/admin/application-access/apps/demo/setup',
  response: () => jsonResponse({ data: setup }),
})

const stepOf = (name) => screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('li')

describe('AppSetupPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    renderPage([], { role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('opens at Connect with the later steps locked', async () => {
    renderPage([setupRoute(makeSetup())])
    expect(await screen.findByText('1 of 6 steps done.', { exact: false })).toBeVisible()
    expect(stepOf('About')).toHaveAttribute('data-status', 'done')
    expect(stepOf('Connect')).toHaveAttribute('data-status', 'current')
    for (const name of ['Permissions', 'Roles', 'Groups', 'Show in Hub']) {
      expect(stepOf(name)).toHaveAttribute('data-status', 'locked')
    }
    expect(screen.getByRole('button', { name: 'Create Connection' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Show In Hub' })).toBeNull()
  })

  it('creates the connection and hands over the .env values behind a masked token', async () => {
    const token = 'mws_47d0b31fa20c.0123456789abcdef0123456789abcdef'
    const { user } = renderPage([
      setupRoute(makeSetup()),
      {
        path: '/api/admin/application-access/apps/demo/connect',
        method: 'POST',
        response: () =>
          jsonResponse({
            data: {
              token,
              client: { token },
              env: [
                { key: 'HUB_SSO_APP_ID', value: 'demo' },
                { key: 'CENTRAL_DATA_API_BASE_URL', value: 'https://db.example.com' },
                { key: 'CENTRAL_DATA_API_TOKEN', value: token },
                { key: 'CENTRAL_ORGANIZATION_ID', value: 'org_demo_abcdefghijklmnopqrst' },
              ],
            },
          }),
      },
    ])
    await user.click(await screen.findByRole('button', { name: 'Create Connection' }))
    expect(await screen.findByText('Connection Created')).toBeVisible()
    expect(screen.getByText(/HUB_SSO_APP_ID=demo/)).toBeVisible()
    expect(screen.getByText(/CENTRAL_DATA_API_TOKEN=mws_47d0b3/)).toBeVisible()
    expect(screen.queryByText(new RegExp(token.slice(-12)))).toBeNull()
  })

  it('shows that it is waiting for the application to send permissions', async () => {
    renderPage([setupRoute(makeSetup({ connection: { client_id: 'c1', created: true, last_used_at: null } }))])
    expect(await screen.findByText('Waiting for the application. Deploy it with the .env values and its permission sync.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Rotate Token' })).toBeVisible()
    // Tells what to do next instead of leaving the person guessing.
    expect(screen.getByText('Do This Next')).toBeVisible()
    expect(screen.getByText('Deploy it, or run it locally with those values.')).toBeVisible()
    expect(screen.queryByText(/Still nothing after 10 minutes/)).toBeNull()
  })

  it('adds a troubleshooting note when nothing called Central for ten minutes', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString()
    renderPage([setupRoute(makeSetup({ connection: { client_id: 'c1', created: true, created_at: old, last_used_at: null } }))])
    expect(await screen.findByText(/Still nothing after 10 minutes/)).toBeVisible()
  })

  it('offers an Admin role with every permission once permissions arrived', async () => {
    const created = []
    const { user } = renderPage([
      setupRoute(
        makeSetup({
          connection: { client_id: 'c1', created: true, last_used_at: new Date().toISOString() },
          permissions: { count: 2, synced_at: new Date().toISOString() },
        }),
      ),
      {
        path: '/api/admin/application-permissions?application_id=demo',
        response: () =>
          jsonResponse({
            data: {
              permissions: [
                { key: 'app.use', deprecated: false },
                { key: 'app.admin', deprecated: false },
                { key: 'old.thing', deprecated: true },
              ],
            },
          }),
      },
      {
        path: '/api/admin/application-roles',
        method: 'POST',
        response: ({ options }) => {
          created.push(JSON.parse(options.body))
          return jsonResponse({ data: {} })
        },
      },
    ])
    await user.click(await screen.findByRole('button', { name: 'Create Admin Role' }))
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toEqual({
      application_id: 'demo',
      key: 'ADMIN',
      label: 'Admin',
      permissions: ['app.use', 'app.admin'],
      allows_employees: true,
    })
  })

  it('publishes once everything before it is done, and can hide it again', async () => {
    const ready = makeSetup({
      connection: { client_id: 'c1', created: true, last_used_at: new Date().toISOString() },
      permissions: { count: 2, synced_at: new Date().toISOString() },
      roles: { active_count: 1 },
      groups: { active_count: 1 },
      can_publish: true,
      missing: [],
    })
    let published = false
    const calls = []
    const { user } = renderPage([
      {
        path: '/api/admin/application-access/apps/demo/setup',
        response: () => jsonResponse({ data: { ...ready, application: { ...APP, published } } }),
      },
      {
        path: '/api/admin/application-access/apps/demo/publish',
        method: 'POST',
        response: () => {
          published = true
          calls.push('publish')
          return jsonResponse({ data: { ...APP, published: true } })
        },
      },
      {
        path: '/api/admin/application-access/apps/demo/unpublish',
        method: 'POST',
        response: () => {
          published = false
          calls.push('unpublish')
          return jsonResponse({ data: { ...APP, published: false } })
        },
      },
    ])
    await user.click(await screen.findByRole('button', { name: 'Show In Hub' }))
    await user.click(await screen.findByRole('button', { name: 'Hide From Hub' }))
    await waitFor(() => expect(calls).toEqual(['publish', 'unpublish']))
    // The button is usable again after the first action finished.
    expect(await screen.findByRole('button', { name: 'Show In Hub' })).toBeEnabled()
  })
  it('removes the application without a second error toast from the page it leaves', async () => {
    let removed = false
    const requests = []
    globalThis.fetch = createFetchRouter([
      {
        path: '/api/admin/application-access/apps/demo/setup',
        response: () => {
          requests.push('setup')
          return removed
            ? jsonResponse({ errors: 'Application demo not found' }, 404)
            : jsonResponse({ data: makeSetup() })
        },
      },
      {
        path: '/api/admin/application-access/apps/demo/removal',
        response: () => jsonResponse({ data: { can_remove: true, blockers: [], will_delete: { roles: 0, groups: 0, permissions: 0, clients: 0 } } }),
      },
      {
        path: '/api/admin/application-access/apps/demo',
        method: 'DELETE',
        response: () => {
          removed = true
          return jsonResponse({ data: true })
        },
      },
    ])
    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: { role: 'SUPER_ADMIN' } }}>
        <Routes>
          <Route path="/application-access/apps/:applicationId/setup" element={<AppSetupPage />} />
          <Route path="/application-access" element={<div>List page</div>} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/application-access/apps/demo/setup' },
    )
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('button', { name: 'Delete Application' }))
    await user.type(await screen.findByLabelText('Type demo to confirm'), 'demo')
    const before = requests.length
    await user.click(screen.getAllByRole('button', { name: 'Delete Application' }).at(-1))
    expect(await screen.findByText('List page')).toBeVisible()
    // Nothing asked for the removed application again.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(requests.length).toBe(before)
  })
  it('has no Show in Hub step for the Hub itself', async () => {
    renderPage([setupRoute(makeSetup({ is_hub: true }))])
    expect(await screen.findByText('1 of 5 steps done.', { exact: false })).toBeVisible()
    expect(screen.queryByRole('heading', { name: /Show in Hub/ })).toBeNull()
  })

  it('changes the data access from the menu', async () => {
    const saved = []
    const { user } = renderPage([
      setupRoute(makeSetup()),
      {
        path: '/api/admin/application-integration-profiles/scopes',
        response: () =>
          jsonResponse({
            data: [
              { name: 'application_permissions:write', description: '', is_sensitive: false },
              { name: 'application_entitlements:read', description: '', is_sensitive: false },
              { name: 'students:read', description: '', is_sensitive: false },
            ],
          }),
      },
      {
        path: '/api/admin/application-access/apps/demo/connection-scopes',
        method: 'PATCH',
        response: ({ options }) => {
          saved.push(JSON.parse(options.body))
          return jsonResponse({ data: { scope_names: [], editable: true } })
        },
      },
    ])
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('button', { name: 'Change Data Access' }))
    await user.click(await screen.findByRole('checkbox', { name: /View student profiles/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].scope_names.sort()).toEqual(['application_entitlements:read', 'application_permissions:write', 'students:read'])
  })
  it('rotates the token of the connection from the setup page', async () => {
    const rotations = []
    const { user } = renderPage([
      setupRoute(makeSetup({ connection: { client_id: 'c1', created: true, created_at: new Date().toISOString(), last_used_at: new Date().toISOString() }, permissions: { count: 1, synced_at: null } })),
      {
        path: '/api/admin/application-access/apps/demo/rotate',
        method: 'POST',
        response: ({ options }) => {
          rotations.push(JSON.parse(options.body))
          return jsonResponse({
            data: {
              token: 'mws_new.secret',
              credentials: [],
              env: [
                { key: 'HUB_SSO_APP_ID', value: 'demo' },
                { key: 'CENTRAL_DATA_API_BASE_URL', value: 'https://db.example.com' },
                { key: 'CENTRAL_DATA_API_TOKEN', value: 'mws_new.secretsecretsecret' },
                { key: 'CENTRAL_ORGANIZATION_ID', value: 'org_demo_abc' },
              ],
            },
          })
        },
      },
    ])
    await user.click(await screen.findByRole('button', { name: 'Rotate Token' }))
    await user.click(await screen.findByRole('button', { name: 'Rotate' }))
    await user.click(await screen.findByRole('button', { name: 'Start Rotation' }))
    expect(await screen.findByText('Rotated Credentials')).toBeVisible()
    // All four values come back, not only the token.
    expect(screen.getByText(/HUB_SSO_APP_ID=demo/)).toBeVisible()
    expect(screen.getByText(/CENTRAL_ORGANIZATION_ID=org_demo_abc/)).toBeVisible()
    expect(screen.getByText(/CENTRAL_DATA_API_BASE_URL=https:\/\/db.example.com/)).toBeVisible()
    expect(rotations).toEqual([{ immediate: false, grace_hours: 24 }])
  })
})
