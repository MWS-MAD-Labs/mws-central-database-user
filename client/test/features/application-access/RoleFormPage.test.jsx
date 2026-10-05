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

function routes(extra = []) {
  return [
    ...extra,
    { path: '/api/admin/application-roles', method: 'GET', response: () => jsonResponse({ data: roles }) },
    { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: [{ application_id: 'exima', organization_id: 'org_exima_a1b2c3' }] }) },
  ]
}

function renderPage(path, user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/roles/new" element={<RoleFormPage />} />
        <Route path="/application-access/roles/:roleId" element={<RoleFormPage />} />
        <Route path="/application-access" element={<div>Access list</div>} />
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
    const { user } = renderPage('/application-access/roles/role-staff')

    expect(await screen.findByText('Edit STAFF')).toBeVisible()
    expect(screen.getByLabelText('store.use')).toBeChecked()
    expect(screen.getByLabelText('app.admin')).not.toBeChecked()

    await user.click(screen.getByLabelText('All permissions'))
    expect(screen.getByLabelText('app.admin')).toBeChecked()
    expect(screen.getByText(/3 active entitlement\(s\) hold this role/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-roles/role-staff') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body).permissions.sort()).toEqual(['app.admin', 'store.use'])
    })
    expect(await screen.findByText('Access list')).toBeVisible()
  })

  it('adds a role to an application with a new permission', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-roles', method: 'POST', response: () => jsonResponse({ data: { id: 'new' } }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage('/application-access/roles/new')

    expect(await screen.findByText('Add Role')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Select or type an application' }))
    await user.click(screen.getByRole('option', { name: 'exima' }))
    const textboxes = screen.getAllByRole('textbox')
    await user.type(textboxes.find((input) => !input.placeholder), 'CASHIER')
    await user.type(screen.getAllByRole('textbox').filter((input) => !input.placeholder)[1], 'Cashier')
    await user.type(screen.getByPlaceholderText(/Add a new permission/), 'pos.checkout')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('pos.checkout')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-roles' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        application_id: 'exima',
        key: 'CASHIER',
        label: 'Cashier',
        permissions: ['pos.checkout'],
      })
    })
  })

  it('refuses a non Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage('/application-access/roles/new', { role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })
})
