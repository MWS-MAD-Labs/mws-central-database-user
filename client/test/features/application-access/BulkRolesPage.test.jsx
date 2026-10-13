import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { BulkRolesPage } from '../../../src/features/application-access/pages/BulkRolesPage.jsx'
import { keyFromLabel, togglePermission, requiredBy } from '../../../src/features/application-access/utils/bulkRoles.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [{ id: 'r1', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true }]
const registry = {
  application_id: 'exima',
  has_manifest: true,
  permissions: [
    { key: 'pos.catalog.read', description: 'Browse the POS catalog', deprecated: false },
    { key: 'pos.checkout', description: 'Run the cashier checkout', deprecated: false, requires: ['pos.catalog.read'] },
    { key: 'store.use', description: null, deprecated: false },
  ],
}

function routes(extra = []) {
  return [
    ...extra,
    { path: /\/api\/admin\/application-permissions\?application_id=exima/, response: () => jsonResponse({ data: registry }) },
    { path: '/api/admin/application-roles', method: 'GET', response: () => jsonResponse({ data: roles }) },
  ]
}

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/:applicationId/roles/bulk" element={<BulkRolesPage />} />
        <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/application-access/apps/exima/roles/bulk' },
  )
}

describe('bulk role helpers', () => {
  it('makes a key from a name', () => {
    expect(keyFromLabel('Support Staff')).toBe('SUPPORT_STAFF')
    expect(keyFromLabel('2nd Shift')).toBe('ROLE_2ND_SHIFT')
    expect(keyFromLabel('  ')).toBe('')
  })

  it('ticks what a permission needs and keeps what another one needs', () => {
    const closure = requiredBy(registry.permissions)
    const ticked = togglePermission([], 'pos.checkout', closure)
    expect(ticked.sort()).toEqual(['pos.catalog.read', 'pos.checkout'])
    expect(togglePermission(ticked, 'pos.catalog.read', closure).sort()).toEqual(['pos.catalog.read', 'pos.checkout'])
    expect(togglePermission(ticked, 'pos.checkout', closure)).toEqual(['pos.catalog.read'])
  })
})

describe('BulkRolesPage', () => {
  it('adds several roles at once from one matrix', async () => {
    const fetchMock = createFetchRouter(
      routes([{ path: '/api/admin/application-roles', method: 'POST', response: () => jsonResponse({ data: { id: 'new' } }) }]),
    )
    globalThis.fetch = fetchMock
    const { user } = renderPage()

    await user.type(await screen.findByLabelText('Role 1 name'), 'Cashier')
    await user.click(screen.getByLabelText('Role 1 pos.checkout'))
    // What the permission needs comes along.
    expect(screen.getByLabelText('Role 1 pos.catalog.read')).toBeChecked()
    expect(screen.getByLabelText('Role 1 pos.catalog.read')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Add Another Role' }))
    await user.type(screen.getByLabelText('Role 2 name'), 'Store Admin')
    await user.click(screen.getByLabelText('Role 2 all permissions'))
    await user.selectOptions(screen.getByLabelText('Role 2 is for'), 'both')

    await user.click(screen.getByRole('button', { name: 'Add 2 Roles' }))
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([url, options]) => url === '/api/admin/application-roles' && options?.method === 'POST')
      expect(posts).toHaveLength(2)
      expect(JSON.parse(posts[0][1].body)).toMatchObject({ key: 'CASHIER', label: 'Cashier', allows_employees: true, allows_students: false })
      expect(JSON.parse(posts[0][1].body).permissions.sort()).toEqual(['pos.catalog.read', 'pos.checkout'])
      expect(JSON.parse(posts[1][1].body)).toMatchObject({ key: 'STORE_ADMIN', allows_employees: true, allows_students: true })
    })
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('refuses a name that exists and permissions another role already has', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await user.type(await screen.findByLabelText('Role 1 name'), 'Staff')
    expect(await screen.findByText('STAFF already exists.')).toBeVisible()
    await user.clear(screen.getByLabelText('Role 1 name'))
    await user.type(screen.getByLabelText('Role 1 name'), 'Counter')
    await user.click(screen.getByLabelText('Role 1 store.use'))
    expect(await screen.findByText(/STAFF already has exactly these permissions/)).toBeVisible()
  })

  it('keeps the role that failed and says why, after saving the others', async () => {
    let calls = 0
    globalThis.fetch = createFetchRouter(
      routes([
        {
          path: '/api/admin/application-roles',
          method: 'POST',
          response: () => {
            calls += 1
            return calls === 1 ? jsonResponse({ data: { id: 'ok' } }) : jsonResponse({ errors: 'Role key already exists' }, 409)
          },
        },
      ]),
    )
    const { user } = renderPage()
    await user.type(await screen.findByLabelText('Role 1 name'), 'Cashier')
    await user.click(screen.getByLabelText('Role 1 pos.catalog.read'))
    await user.click(screen.getByRole('button', { name: 'Add Another Role' }))
    await user.type(screen.getByLabelText('Role 2 name'), 'Counter')
    await user.click(screen.getByLabelText('Role 2 pos.checkout'))
    await user.click(screen.getByRole('button', { name: 'Add 2 Roles' }))
    expect(await screen.findByText('Role key already exists')).toBeVisible()
    expect(screen.getByLabelText('Role 1 name')).toHaveValue('Counter')
    expect(screen.queryByText('App page')).toBeNull()
  })

  it('is for Super Admin only', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })
})
