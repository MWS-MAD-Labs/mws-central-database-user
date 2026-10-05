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

  it('offers only active roles of the chosen application in the grant dialog', async () => {
    const fetchMock = createFetchRouter(baseRoutes([
      {
        path: /^\/api\/admin\/employees\?/,
        response: () => jsonResponse({
          data: [{ id: 'emp-1', person_id: 'person-2', identity: { full_name: 'Alpha Person', email: 'alpha@millennia21.id' }, employment: { unit: 'MAD Lab' } }],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
      {
        path: '/api/admin/application-entitlements',
        method: 'POST',
        response: () => jsonResponse({ data: entitlement }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: 'Grant Access' }))
    const dialog = await screen.findByRole('dialog', { name: 'Grant Access' })
    await user.click(await within(dialog).findByLabelText(/Alpha Person/))
    const [applicationSelect, roleSelect] = within(dialog).getAllByRole('combobox')
    await user.selectOptions(applicationSelect, 'exima')

    const keys = within(roleSelect).getAllByRole('option').map((option) => option.textContent)
    expect(keys).toEqual(['Select a role', 'ADMIN', 'STAFF'])

    await user.selectOptions(roleSelect, 'STAFF')
    expect(within(dialog).getByText('Permissions: store.use')).toBeVisible()
    await user.type(within(dialog).getAllByRole('textbox').at(-1), 'mws')
    await user.click(within(dialog).getByRole('button', { name: 'Grant' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-entitlements' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        person_id: 'person-2',
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
  })
})
