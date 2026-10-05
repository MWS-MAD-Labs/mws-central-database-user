import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
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

const masterRoutes = [
  { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }, { id: 'unit-2', name: 'Elementary' }] }) },
  { path: /^\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [{ id: 'pos-1', name: 'Developer' }] }) },
  { path: /^\/api\/admin\/job-levels/, response: () => jsonResponse({ data: [] }) },
  { path: /^\/api\/admin\/buildings/, response: () => jsonResponse({ data: [] }) },
]

function baseRoutes(extra = []) {
  return [
    ...extra,
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
        <ApplicationAccessPage />
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

  it('bulk grants the checked employees with only the active roles of the chosen application', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      ...masterRoutes,
      {
        path: /^\/api\/admin\/employees\?/,
        response: () => jsonResponse({
          data: [
            { id: 'emp-1', person_id: 'person-2', identity: { full_name: 'Alpha Person', email: 'alpha@millennia21.id' }, employment: { unit: 'MAD Lab', job_position: 'Developer' } },
            { id: 'emp-2', person_id: 'person-3', identity: { full_name: 'Beta Person', email: 'beta@millennia21.id' }, employment: { unit: 'MAD Lab', job_position: 'Designer' } },
          ],
          paging: { current_page: 1, total_page: 1, total_item: 2, size: 10 },
        }),
      },
      {
        path: '/api/admin/application-entitlements/bulk',
        method: 'POST',
        response: () => jsonResponse({ data: { total_count: 2, success_count: 2, failed_count: 0, items: [] } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: 'Grant Access' }))
    const dialog = await screen.findByRole('dialog', { name: 'Grant Access' })
    await user.click(await within(dialog).findByLabelText('Alpha Person'))
    await user.click(within(dialog).getByLabelText('Beta Person'))
    expect(within(dialog).getByText(/2 employees selected/)).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'Select an application' }))
    await user.click(screen.getByRole('option', { name: 'exima' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select a role' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('ADMIN'),
      expect.stringContaining('STAFF'),
    ])
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    expect(within(dialog).getByText('Permissions: store.use')).toBeVisible()
    await user.type(within(dialog).getAllByRole('textbox').find((input) => !input.placeholder), 'mws')
    await user.click(within(dialog).getByRole('button', { name: 'Grant' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-entitlements/bulk' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        person_ids: ['person-2', 'person-3'],
        application_id: 'exima',
        organization_id: 'mws',
        role: 'STAFF',
      })
    })
  })

  it('creates a group access with unit and position filters', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      ...masterRoutes,
      {
        path: '/api/admin/application-access-rules',
        method: 'POST',
        response: () => jsonResponse({ data: { id: 'rule-2' } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: 'Grant Access' }))
    const dialog = await screen.findByRole('dialog', { name: 'Grant Access' })
    await user.click(within(dialog).getByRole('button', { name: 'Specific People' }))
    await user.click(screen.getByRole('option', { name: 'A Group' }))

    await user.click(within(dialog).getByRole('button', { name: 'Select an application' }))
    await user.click(screen.getByRole('option', { name: 'exima' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select a role' }))
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    await user.type(within(dialog).getAllByRole('textbox').find((input) => !input.placeholder), 'mws')

    expect(within(dialog).getByRole('button', { name: 'All Active Employees' })).toBeVisible()
    expect(within(dialog).getByLabelText('All Units')).toBeChecked()
    await user.click(await within(dialog).findByLabelText('Elementary'))
    expect(within(dialog).getByLabelText('All Units')).not.toBeChecked()
    await user.click(within(dialog).getByLabelText('Developer'))
    await user.click(within(dialog).getByRole('button', { name: 'Grant' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-access-rules' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        application_id: 'exima',
        audience: 'EMPLOYEES',
        unit_ids: ['unit-2'],
        job_position_ids: ['pos-1'],
        job_level_ids: [],
        default_role_key: 'STAFF',
        organization_id: 'mws',
      })
    })
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

  it('shows the registry on the Roles tab with how many people use each role', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=roles')
    const row = (await screen.findByText('LEGACY')).closest('tr')
    expect(within(row).getByText('Inactive')).toBeVisible()
    const adminRow = screen.getByText('ADMIN').closest('tr')
    expect(within(adminRow).getByText('1')).toBeVisible()
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

  it('edits permissions as a checklist with an all toggle', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      {
        path: '/api/admin/application-roles/role-staff',
        method: 'PATCH',
        response: () => jsonResponse({ data: roles[1] }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=roles')
    await screen.findByText('LEGACY')

    await user.click(screen.getByRole('button', { name: 'Actions for exima STAFF' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit STAFF' })
    expect(within(dialog).getByLabelText('store.use')).toBeChecked()
    expect(within(dialog).getByLabelText('app.admin')).not.toBeChecked()

    await user.click(within(dialog).getByLabelText('All permissions'))
    expect(within(dialog).getByLabelText('app.admin')).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-roles/role-staff') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body).permissions.sort()).toEqual(['app.admin', 'store.use'])
    })
  })
})
