import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { Route, Routes } from 'react-router'
import { ApplicationAccessPage } from '../../../src/features/application-access/pages/ApplicationAccessPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin', 'store.use'], is_active: true, active_entitlement_count: 1 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-old', application_id: 'exima', key: 'LEGACY', label: 'Legacy', permissions: [], is_active: false, active_entitlement_count: 0 },
]

const personRow = {
  kind: 'PERSON',
  id: 'ent-1',
  application_id: 'exima',
  role: 'ADMIN',
  permissions: ['app.admin', 'store.use'],
  organization_id: 'mws',
  is_active: true,
  granted_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  group: null,
  person: { person_id: 'person-1', full_name: 'Dummy Staff', email: 'dummystaff@millennia21.id', unit: 'MAD Lab' },
}

const groupRow = {
  kind: 'GROUP',
  id: 'rule-1',
  application_id: 'exima',
  role: 'STAFF',
  permissions: ['store.use'],
  organization_id: 'mws',
  is_active: true,
  granted_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  group: {
    audience: 'EMPLOYEES',
    units: [{ id: 'unit-1', name: 'MAD Lab' }],
    job_positions: [],
    job_levels: [],
  },
  person: null,
}

const organizations = [
  { application_id: 'exima', organization_id: 'org_exima_a1b2c3' },
]

function baseRoutes(extra = []) {
  return [
    ...extra,
    { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: organizations }) },
    { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
    {
      path: /^\/api\/admin\/application-access(\?.*)?$/,
      method: 'GET',
      response: () => jsonResponse({
        data: [groupRow, personRow],
        paging: { current_page: 1, total_page: 1, total_item: 2, size: 10 },
      }),
    },
  ]
}

function renderPage(user = { role: 'SUPER_ADMIN' }, route = '/application-access') {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access" element={<ApplicationAccessPage />} />
          <Route path="/application-access/grant" element={<div>Grant page</div>} />
          <Route path="/application-access/groups/:ruleId" element={<div>Group edit page</div>} />
          <Route path="/application-access/roles/new" element={<div>New role page</div>} />
          <Route path="/application-access/roles/:roleId" element={<div>Edit role page</div>} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route },
  )
}

describe('ApplicationAccessPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('lists group access and people in one table', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    renderPage()
    expect(await screen.findByText('All Active Employees')).toBeVisible()
    expect(screen.getByText('Units: MAD Lab')).toBeVisible()
    const personTableRow = screen.getByText('Dummy Staff').closest('tr')
    expect(screen.getByText(/dummystaff@millennia21.id · MAD Lab/)).toBeVisible()
    expect(within(personTableRow).getByText('ADMIN')).toBeVisible()
    expect(within(personTableRow).getByText('Active')).toBeVisible()
  })

  it('opens the full pages for granting, editing a group and roles', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: 'Grant Access' }))
    expect(await screen.findByText('Grant page')).toBeVisible()
  })

  it('opens the group edit page from the row menu', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: /Actions for All Active Employees on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Group edit page')).toBeVisible()
  })

  it('confirms before revoking a person and turns a group off or deletes it', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      {
        path: '/api/admin/application-entitlements/revoke/ent-1',
        method: 'PATCH',
        response: () => jsonResponse({ data: { ...personRow, is_active: false } }),
      },
      {
        path: '/api/admin/application-access-rules/rule-1',
        method: 'PATCH',
        response: () => jsonResponse({ data: {} }),
      },
      {
        path: '/api/admin/application-access-rules/rule-1',
        method: 'DELETE',
        response: () => jsonResponse({ data: true }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: /Actions for Dummy Staff on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const revokeDialog = await screen.findByRole('dialog', { name: 'Revoke access' })
    await user.click(within(revokeDialog).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, options]) =>
        url.endsWith('/revoke/ent-1') && options.method === 'PATCH')).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: /Actions for All Active Employees on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-access-rules/rule-1') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body)).toEqual({ is_active: false })
    })

    await user.click(screen.getByRole('button', { name: /Actions for All Active Employees on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete group access' })
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, options]) =>
        url.endsWith('/application-access-rules/rule-1') && options.method === 'DELETE')).toBe(true)
    })
  })

  it('shows the registry and the generated organization ids on the Roles tab', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=roles')
    const row = (await screen.findByText('LEGACY')).closest('tr')
    expect(within(row).getByText('Inactive')).toBeVisible()
    const adminRow = screen.getByText('ADMIN').closest('tr')
    expect(within(adminRow).getByText('1')).toBeVisible()
    expect(screen.getByText('org_exima_a1b2c3')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Add Role' }))
    expect(await screen.findByText('New role page')).toBeVisible()
  })

  it('opens the role edit page from the row menu', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=roles')
    await screen.findByText('LEGACY')
    await user.click(screen.getByRole('button', { name: 'Actions for exima STAFF' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit role page')).toBeVisible()
  })

  it('switches between the Access and Roles tabs', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: 'Roles' }))
    expect(await screen.findByText('LEGACY')).toBeVisible()
    expect(screen.queryByText('Dummy Staff')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Access' }))
    expect(await screen.findByText('Dummy Staff')).toBeVisible()
  })
})
