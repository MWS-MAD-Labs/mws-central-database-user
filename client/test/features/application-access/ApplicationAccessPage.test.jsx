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

const entitlement = {
  id: 'ent-1',
  person_id: 'person-1',
  application_id: 'exima',
  organization_id: 'mws',
  role: 'ADMIN',
  permissions: ['app.admin', 'store.use'],
  version: 1,
  is_active: true,
  granted_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  person: { full_name: 'Dummy Staff', email: 'dummystaff@millennia21.id', unit: 'MAD Lab' },
}

function baseRoutes(extra = []) {
  return [
    ...extra,
    { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
    {
      path: /^\/api\/admin\/application-entitlements(\?.*)?$/,
      method: 'GET',
      response: () => jsonResponse({
        data: [entitlement],
        paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
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

  it('lists entitlements with the person, role and status', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    renderPage()
    expect(await screen.findByText('Dummy Staff')).toBeVisible()
    expect(screen.getByText(/dummystaff@millennia21.id · MAD Lab/)).toBeVisible()
    expect(within(screen.getByText('Dummy Staff').closest('tr')).getByText('ADMIN')).toBeVisible()
    expect(within(screen.getByText('Dummy Staff').closest('tr')).getByText('Active')).toBeVisible()
  })

  it('bulk grants the checked employees with only the active roles of the chosen application', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
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
      { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }] }) },
      { path: /^\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [] }) },
      { path: /^\/api\/admin\/job-levels/, response: () => jsonResponse({ data: [] }) },
      { path: /^\/api\/admin\/buildings/, response: () => jsonResponse({ data: [] }) },
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

  it('confirms before revoking access', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      {
        path: '/api/admin/application-entitlements/revoke/ent-1',
        method: 'PATCH',
        response: () => jsonResponse({ data: { ...entitlement, is_active: false } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: /Actions for dummystaff@millennia21.id on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('dialog', { name: 'Revoke access' })
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, options]) =>
        url.endsWith('/revoke/ent-1') && options.method === 'PATCH')).toBe(true)
    })
  })

  it('shows the registry on the Roles tab with how many entitlements use each role', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=roles')
    const row = (await screen.findByText('LEGACY')).closest('tr')
    expect(within(row).getByText('Inactive')).toBeVisible()
    const adminRow = screen.getByText('ADMIN').closest('tr')
    expect(within(adminRow).getByText('1')).toBeVisible()
    expect(screen.queryByText('Baseline access')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set Up' })).not.toBeInTheDocument()
  })

  it('switches between the Entitlements, Baseline Access and Roles tabs', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes([
      { path: '/api/admin/application-access-rules', response: () => jsonResponse({ data: [] }) },
      { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [] }) },
    ]))
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: 'Baseline Access' }))
    expect(await screen.findByText('Baseline access')).toBeVisible()
    expect(screen.queryByText('Dummy Staff')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Roles' }))
    expect(await screen.findByText('LEGACY')).toBeVisible()
    expect(screen.queryByText('Baseline access')).not.toBeInTheDocument()
  })

  it('sets a baseline rule for an application', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      { path: '/api/admin/application-access-rules', response: () => jsonResponse({ data: [] }) },
      { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }] }) },
      {
        path: '/api/admin/application-access-rules/exima',
        method: 'PUT',
        response: () => jsonResponse({ data: {} }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=baseline')
    expect(await screen.findByText('No baseline')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Set Up' }))
    const dialog = await screen.findByRole('dialog', { name: 'Baseline access for exima' })
    expect(within(dialog).getByRole('button', { name: 'All Active Employees' })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Select a role' }))
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    await user.type(within(dialog).getByRole('textbox'), 'mws')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-access-rules/exima' && options.method === 'PUT')
      expect(JSON.parse(call[1].body)).toEqual({
        audience: 'EMPLOYEES',
        unit_ids: [],
        default_role_key: 'STAFF',
        organization_id: 'mws',
        is_active: true,
      })
    })
  })

  it('edits permissions as a checklist with an all toggle', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      { path: '/api/admin/application-access-rules', response: () => jsonResponse({ data: [] }) },
      { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [] }) },
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
