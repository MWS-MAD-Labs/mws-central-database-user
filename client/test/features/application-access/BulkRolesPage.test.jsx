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

// The row's name carries its description too, so it is found by where it starts.
const perm = (key) => screen.getByLabelText(new RegExp(`^${key.replace(/\./g, '\\.')}`))

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
  it('adds several roles at once from the list and the permissions of each', async () => {
    const fetchMock = createFetchRouter(
      routes([{ path: '/api/admin/application-roles', method: 'POST', response: () => jsonResponse({ data: { id: 'new' } }) }]),
    )
    globalThis.fetch = fetchMock
    const { user } = renderPage()

    await user.type(await screen.findByLabelText('Role name'), 'Cashier')
    await user.click(perm('pos.checkout'))
    // What the permission needs comes along.
    expect(perm('pos.catalog.read')).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Add Another Role' }))
    await user.type(screen.getByLabelText('Role name'), 'Store Admin')
    await user.click(screen.getByLabelText(/Select all 3 matching permission/))

    await user.click(screen.getByRole('button', { name: 'Add 2 Roles' }))
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([url, options]) => url === '/api/admin/application-roles' && options?.method === 'POST')
      expect(posts).toHaveLength(2)
      expect(JSON.parse(posts[0][1].body)).toMatchObject({ key: 'CASHIER', label: 'Cashier', allows_employees: true, allows_students: false })
      expect(JSON.parse(posts[0][1].body).permissions.sort()).toEqual(['pos.catalog.read', 'pos.checkout'])
      expect(JSON.parse(posts[1][1].body)).toMatchObject({ key: 'STORE_ADMIN' })
      expect(JSON.parse(posts[1][1].body).permissions).toHaveLength(3)
    })
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('moves between the new roles and keeps what each one has', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await user.type(await screen.findByLabelText('Role name'), 'Cashier')
    await user.click(perm('pos.catalog.read'))
    await user.click(screen.getByRole('button', { name: 'Add Another Role' }))
    expect(screen.getByLabelText('Role name')).toHaveValue('')
    expect(perm('pos.catalog.read')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: /^Cashier/ }))
    expect(screen.getByLabelText('Role name')).toHaveValue('Cashier')
    expect(perm('pos.catalog.read')).toBeChecked()
  })

  it('pages the list of new roles when there are many', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByLabelText('Role name')
    for (let i = 0; i < 7; i += 1) await user.click(screen.getByRole('button', { name: 'Add Another Role' }))
    // Eight roles are two pages of six, and the newest is on the last one.
    expect(screen.getByText('2 / 2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Previous roles' }))
    expect(screen.getByText('1 / 2')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /Untitled role/ }).length).toBeGreaterThan(0)
  })

  it('copies the permissions of another role', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await user.type(await screen.findByLabelText('Role name'), 'Cashier')
    await user.click(perm('pos.catalog.read'))
    await user.click(screen.getByRole('button', { name: 'Add Another Role' }))
    await user.type(screen.getByLabelText('Role name'), 'Counter')
    await user.click(screen.getByRole('button', { name: 'Select a role' }))
    await user.click(await screen.findByRole('option', { name: 'Cashier' }))
    expect(perm('pos.catalog.read')).toBeChecked()
    // The same permissions as Cashier, so it is told to change them.
    expect(await screen.findByText(/CASHIER already has exactly these permissions/)).toBeVisible()
  })

  it('refuses a name that exists and permissions another role already has', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await user.type(await screen.findByLabelText('Role name'), 'Staff')
    expect(await screen.findByText('STAFF already exists.')).toBeVisible()
    await user.clear(screen.getByLabelText('Role name'))
    await user.type(screen.getByLabelText('Role name'), 'Counter')
    await user.click(perm('store.use'))
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
    await user.type(await screen.findByLabelText('Role name'), 'Cashier')
    await user.click(perm('pos.catalog.read'))
    await user.click(screen.getByRole('button', { name: 'Add Another Role' }))
    await user.type(screen.getByLabelText('Role name'), 'Counter')
    await user.click(perm('pos.checkout'))
    await user.click(screen.getByRole('button', { name: 'Add 2 Roles' }))
    expect(await screen.findByText('Role key already exists')).toBeVisible()
    expect(screen.getByLabelText('Role name')).toHaveValue('Counter')
    expect(screen.queryByText('App page')).toBeNull()
  })

  it('will not save a role that has no permission', async () => {
    const fetchMock = createFetchRouter(routes([{ path: '/api/admin/application-roles', method: 'POST', response: () => jsonResponse({ data: { id: 'new' } }) }]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(await screen.findByLabelText('Role name'), 'cashier')
    // The name is written with a capital as it is typed.
    expect(screen.getByLabelText('Role name')).toHaveValue('Cashier')
    await user.click(screen.getByRole('button', { name: 'Add Role' }))
    expect(await screen.findByText('Pick at least one permission.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    await user.click(perm('pos.catalog.read'))
    await waitFor(() => expect(screen.queryByText('Pick at least one permission.')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Add Role' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
  })

  it('is for Super Admin only', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })
})
