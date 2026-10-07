import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { RoleFormPage } from '../../../src/features/application-access/pages/RoleFormPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin', 'store.use'], is_active: true, active_entitlement_count: 2 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 3 },
]

let registry = {
  application_id: 'exima',
  has_manifest: false,
  last_synced_at: null,
  permissions: [
    { key: 'app.admin', description: 'Opens the admin area', source: 'MANUAL', deprecated: false, role_count: 1 },
    { key: 'store.use', description: null, source: 'MANUAL', deprecated: false, role_count: 2 },
  ],
}

function routes(extra = []) {
  return [
    ...extra,
    { path: /\/api\/admin\/application-permissions\?application_id=exima/, method: 'GET', response: () => jsonResponse({ data: registry }) },
    { path: '/api/admin/application-permissions', method: 'POST', response: () => jsonResponse({ data: {} }) },
    { path: '/api/admin/application-roles', method: 'GET', response: () => jsonResponse({ data: roles }) },
    { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: [{ application_id: 'exima', organization_id: 'org_exima_a1b2c3' }] }) },
  ]
}

function renderPage(path, user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/:applicationId/roles/new" element={<RoleFormPage />} />
        <Route path="/application-access/apps/:applicationId/roles/:roleId" element={<RoleFormPage />} />
        <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: path },
  )
}

describe('RoleFormPage', () => {
  it('edits permissions as a checklist, warns about people holding the role and sends them', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-roles/role-staff', method: 'PATCH', response: () => jsonResponse({ data: roles[1] }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage('/application-access/apps/exima/roles/role-staff')

    expect(await screen.findByText('Edit STAFF')).toBeVisible()
    expect(await screen.findByLabelText('store.use')).toBeChecked()
    expect(screen.getByLabelText(/^app\.admin/)).not.toBeChecked()

    await user.type(await screen.findByPlaceholderText(/Add a new permission/), 'store.refund')
    await user.click(screen.getByRole('button', { name: 'Add Permission' }))
    expect(await screen.findByLabelText('store.refund')).toBeChecked()
    expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/application-permissions' && options.method === 'POST'
      && JSON.parse(options.body).key === 'store.refund')).toBe(true)
    expect(screen.getByText(/3 active entitlement\(s\) hold this role/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-roles/role-staff') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body).permissions.sort()).toEqual(['store.refund', 'store.use'])
    })
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('blocks saving a role whose permissions match another active role', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage('/application-access/apps/exima/roles/role-staff')
    await screen.findByText('Edit STAFF')
    await user.click(await screen.findByLabelText(/^app\.admin/))
    expect(screen.getByText(/ADMIN already has exactly these permissions/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByLabelText(/^app\.admin/))
    expect(screen.queryByText(/already has exactly these permissions/)).not.toBeInTheDocument()
  })

  it('adds a role to an application with a new permission', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-roles', method: 'POST', response: () => jsonResponse({ data: { id: 'new' } }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage('/application-access/apps/exima/roles/new')

    expect(await screen.findByText('Add Role to exima')).toBeVisible()
    expect(screen.queryByText('Application ID')).not.toBeInTheDocument()
    const textboxes = screen.getAllByRole('textbox')
    await user.type(textboxes.find((input) => !input.placeholder), 'CASHIER')
    // The label already follows the key as a suggestion.
    expect(screen.getAllByRole('textbox').filter((input) => !input.placeholder)[1]).toHaveValue('Cashier')
    await user.type(await screen.findByPlaceholderText(/Add a new permission/), 'pos.checkout')
    await user.click(screen.getByRole('button', { name: 'Add Permission' }))
    expect(await screen.findByLabelText('pos.checkout')).toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Students' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-roles' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        application_id: 'exima',
        key: 'CASHIER',
        label: 'Cashier',
        permissions: ['pos.checkout'],
        allows_employees: true,
        allows_students: true,
      })
    })
  })

  it('shows what a permission opens and offers only what is registered', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/new')
    await screen.findByText('Add Role to exima')
    expect(await screen.findByText('Opens the admin area')).toBeVisible()
    expect(await screen.findByLabelText('store.use')).not.toBeChecked()
  })

  it('does not let a new permission be typed for an application that publishes its own', async () => {
    registry = { ...registry, has_manifest: true }
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/new')
    await screen.findByText('Add Role to exima')
    expect(await screen.findByText(/publishes its own permissions/)).toBeVisible()
    expect(screen.queryByPlaceholderText(/Add a new permission/)).not.toBeInTheDocument()
    registry = { ...registry, has_manifest: false }
  })

  it('marks a permission the application dropped and keeps it on the role', async () => {
    registry = {
      ...registry,
      permissions: [
        ...registry.permissions,
        { key: 'store.old', description: null, source: 'MANIFEST', deprecated: true, role_count: 1 },
      ],
    }
    roles.push({ ...roles[1], id: 'role-old', key: 'OLD', permissions: ['store.use', 'store.old'] })
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/role-old')
    await screen.findByText('Edit OLD')
    expect(await screen.findByLabelText(/^store\.old/)).toBeChecked()
    expect(screen.getByText(/Dropped by the application/)).toBeVisible()
    roles.pop()
    registry = { ...registry, permissions: registry.permissions.slice(0, 2) }
  })

  it('ticks what a permission needs and keeps it while something still needs it', async () => {
    registry = {
      ...registry,
      permissions: [
        { key: 'inv.read', description: 'Opens the inventory tab', requires: [], source: 'MANIFEST', deprecated: false, role_count: 0 },
        { key: 'inv.manage', description: 'Edits items', requires: ['inv.read'], source: 'MANIFEST', deprecated: false, role_count: 0 },
      ],
    }
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage('/application-access/apps/exima/roles/new')
    await screen.findByText('Add Role to exima')
    await user.click(await screen.findByLabelText(/^inv\.manage/))
    expect(screen.getByLabelText(/^inv\.read/)).toBeChecked()
    expect(screen.getByText('Needed by inv.manage')).toBeVisible()
    expect(screen.getByLabelText(/^inv\.read/)).toBeDisabled()
    await user.click(screen.getByLabelText(/^inv\.manage/))
    expect(screen.getByLabelText(/^inv\.read/)).not.toBeDisabled()
    registry = { ...registry, permissions: registry.permissions.slice(0, 0) }
  })

  it('shortens what needs a permission when many do, and searches a long list', async () => {
    registry = {
      ...registry,
      permissions: [
        { key: 'inv.read', description: 'Opens the inventory tab', requires: [], source: 'MANIFEST', deprecated: false, role_count: 0 },
        ...['a', 'b', 'c'].map((letter) => ({ key: `inv.${letter}`, description: null, requires: ['inv.read'], source: 'MANIFEST', deprecated: false, role_count: 0 })),
        ...Array.from({ length: 10 }, (_, index) => ({ key: `other.item${index}`, description: null, requires: [], source: 'MANIFEST', deprecated: false, role_count: 0 })),
      ],
    }
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage('/application-access/apps/exima/roles/new')
    await screen.findByText('Add Role to exima')
    for (const letter of ['a', 'b', 'c']) await user.click(await screen.findByLabelText(new RegExp(`^inv\\.${letter}`)))
    expect(screen.getByText('Needed by 3 permissions')).toBeVisible()

    await user.type(screen.getByPlaceholderText('Search permissions'), 'other.item1')
    expect(screen.queryByLabelText(/^other\.item2/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^other\.item1/)).toBeVisible()
    registry = { ...registry, permissions: registry.permissions.slice(0, 0) }
  })

  it('writes the key in capitals and suggests a label until the label is edited', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage('/application-access/apps/exima/roles/new')
    await screen.findByText('Add Role to exima')
    const [keyInput, labelInput] = screen.getAllByRole('textbox').filter((input) => !input.placeholder)

    await user.type(keyInput, 'support staff-2!')
    expect(keyInput).toHaveValue('SUPPORT_STAFF_2')
    expect(labelInput).toHaveValue('Support Staff 2')
    expect(screen.getByText('Suggested from the role key. You can change it.')).toBeVisible()

    await user.clear(labelInput)
    await user.type(labelInput, 'Helpers')
    await user.type(keyInput, 'x')
    expect(keyInput).toHaveValue('SUPPORT_STAFF_2X')
    expect(labelInput).toHaveValue('Helpers')

    // Clearing the label hands it back to the suggestion.
    await user.clear(labelInput)
    await user.type(keyInput, 'y')
    expect(labelInput).toHaveValue('Support Staff 2xy')
  })

  it('does not suggest a label when editing a role', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/role-staff')
    await screen.findByText('Edit STAFF')
    expect(screen.getAllByRole('textbox').filter((input) => !input.placeholder)[0]).toHaveValue('Staff')
    expect(screen.queryByText('Suggested from the role key. You can change it.')).not.toBeInTheDocument()
  })

  it('warns that permissions typed by hand are not checked against the application', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/new')
    expect(await screen.findByText(/has not published its permissions/)).toBeVisible()
  })

  it('has no warning for an application that publishes its own permissions', async () => {
    registry = { ...registry, has_manifest: true }
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/new')
    await screen.findByText(/publishes its own permissions/)
    expect(screen.queryByText(/has not published its permissions/)).not.toBeInTheDocument()
    registry = { ...registry, has_manifest: false }
  })

  it('says when the role belongs to another application', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/hub/roles/role-staff')
    expect(await screen.findByText('This role could not be found.')).toBeVisible()
  })

  it('starts a new role for employees only and says so', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/new')
    await screen.findByText('Add Role to exima')
    expect(screen.getByRole('switch', { name: 'Employees' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Students' })).not.toBeChecked()
  })

  it('refuses a non Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/apps/exima/roles/new', { role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })
})
