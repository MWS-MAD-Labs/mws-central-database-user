import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AppAccessPage } from '../../../src/features/application-access/pages/AppAccessPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin', 'store.use'], is_active: true, active_entitlement_count: 1 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
]

const exception = (extra = {}) => ({
  id: 'ent-1',
  person_id: 'person-1',
  full_name: 'Dummy Staff',
  email: 'dummystaff@millennia21.id',
  unit: 'MAD Lab',
  role: 'ADMIN',
  permissions: ['app.admin', 'store.use'],
  is_active: true,
  granted_at: '2026-10-01T00:00:00.000Z',
  ...extra,
})

const baselineGroup = (extra = {}) => ({
  id: 'rule-1',
  application_id: 'exima',
  audience: 'EMPLOYEES',
  unit_ids: [],
  job_position_ids: [],
  job_level_ids: [],
  default_role_key: 'STAFF',
  organization_id: 'org_exima_a1b2c3',
  is_active: true,
  parent_group_id: null,
  units: [],
  job_positions: [],
  job_levels: [],
  permissions: ['store.use'],
  exception_count: 1,
  blocked_count: 0,
  ...extra,
})

const narrowGroup = {
  ...baselineGroup(),
  id: 'rule-2',
  default_role_key: 'ADMIN',
  unit_ids: ['unit-1'],
  units: [{ id: 'unit-1', name: 'MAD Lab' }],
  parent_group_id: 'rule-1',
  permissions: ['app.admin'],
  exception_count: 0,
  blocked_count: 0,
}

const detail = (extra = {}) => ({
  application_id: 'exima',
  organization_id: 'org_exima_a1b2c3',
  groups: [baselineGroup(), narrowGroup],
  other_count: 0,
  ...extra,
})

// Exceptions by group id, served like the paged endpoint.
function routes(data = detail(), extra = [], exceptions = { 'rule-1': [exception()] }) {
  return [
    ...extra,
    {
      path: /\/api\/admin\/application-access\/apps\/exima\/exceptions/,
      method: 'GET',
      response: ({ url }) => {
        const rows = exceptions[new URL(url, 'http://x').searchParams.get('group_id')] || []
        return jsonResponse({ data: rows, paging: { current_page: 1, total_page: 1, total_item: rows.length, size: 10 } })
      },
    },
    { path: '/api/admin/application-access/apps/exima', method: 'GET', response: () => jsonResponse({ data }) },
    { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
  ]
}

function renderPage(user = { role: 'SUPER_ADMIN' }, route = '/application-access/apps/exima') {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access/apps/:applicationId" element={<AppAccessPage />} />
          <Route path="/application-access" element={<div>Applications list</div>} />
          <Route path="/application-access/apps/:applicationId/roles/new" element={<div>New role page</div>} />
          <Route path="/application-access/apps/:applicationId/roles/:roleId" element={<div>Edit role page</div>} />
          <Route path="/application-access/apps/:applicationId/groups/new" element={<div>New group page</div>} />
          <Route path="/application-access/apps/:applicationId/groups/:ruleId" element={<div>Edit group page</div>} />
          <Route path="/application-access/apps/:applicationId/groups/:ruleId/exceptions/new" element={<div>New exception page</div>} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route },
  )
}

describe('AppAccessPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('shows the groups broad to narrow with their exceptions and the organization id', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    expect(await screen.findByRole('button', { name: 'Copy org_exima_a1b2c3' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    await screen.findByText('Dummy Staff')
    const cards = screen.getAllByRole('heading', { level: 2 })
    expect(cards).toHaveLength(2)
    expect(screen.getByText(/Inside All Active Employees/)).toBeVisible()
    const chips = within(screen.getAllByLabelText('Who this group covers')[1])
    expect(chips.getByText('MAD Lab')).toBeVisible()
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument()
    // The exception sits in the card of the group that covers it.
    const exceptionRow = (await screen.findByText('Dummy Staff')).closest('tr')
    expect(within(exceptionRow).getByText('ADMIN')).toBeVisible()
    expect(within(exceptionRow).getByText('Active')).toBeVisible()
    expect(screen.getByText(/No exceptions\. Everyone this group covers gets ADMIN\./)).toBeVisible()
  })

  it('disables Add group until the application has an active role', async () => {
    const data = detail({ groups: [] })
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/application-access/apps/exima', method: 'GET', response: () => jsonResponse({ data }) },
      { path: '/api/admin/application-roles', response: () => jsonResponse({ data: [] }) },
    ])
    renderPage()
    await screen.findByText(/No group access yet/)
    expect(screen.getByRole('button', { name: 'Add group' })).toBeDisabled()
  })

  it('has no exceptions to add before there is a group', async () => {
    globalThis.fetch = createFetchRouter(routes(detail({ groups: [] })))
    const { user } = renderPage()
    expect(await screen.findByText(/No group access yet/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add exception' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(await screen.findByText('New group page')).toBeVisible()
  })

  it('opens the pages for adding an exception and editing a group', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getAllByRole('button', { name: 'Add exception' })[0])
    expect(await screen.findByText('New exception page')).toBeVisible()
  })

  it('opens the group edit page from the group menu', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')
    await user.click(screen.getByRole('button', { name: /Actions for group All Active Employees, All Units/ }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit group page')).toBeVisible()
  })

  it('confirms before blocking or removing an exception, and turns a group off or deletes it', async () => {
    const fetchMock = createFetchRouter(routes(detail(), [
      { path: '/api/admin/application-entitlements/revoke/ent-1', method: 'PATCH', response: () => jsonResponse({ data: {} }) },
      { path: '/api/admin/application-entitlements/ent-1', method: 'DELETE', response: () => jsonResponse({ data: true }) },
      { path: '/api/admin/application-access-rules/rule-1', method: 'PATCH', response: () => jsonResponse({ data: {} }) },
      { path: '/api/admin/application-access-rules/rule-1', method: 'DELETE', response: () => jsonResponse({ data: true }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')

    await user.click(screen.getByRole('button', { name: /Actions for Dummy Staff on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Block access' }))
    const blockDialog = await screen.findByRole('dialog', { name: 'Block access' })
    await user.click(within(blockDialog).getByRole('button', { name: 'Block' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, options]) =>
        url.endsWith('/revoke/ent-1') && options.method === 'PATCH')).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: /Actions for Dummy Staff on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const removeDialog = await screen.findByRole('dialog', { name: 'Remove exception' })
    await user.click(within(removeDialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, options]) =>
        url.endsWith('/application-entitlements/ent-1') && options.method === 'DELETE')).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: /Actions for group All Active Employees, All Units/ }))
    await user.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-access-rules/rule-1') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body)).toEqual({ is_active: false })
    })

    await user.click(screen.getByRole('button', { name: /Actions for group All Active Employees, All Units/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete group access' })
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, options]) =>
        url.endsWith('/application-access-rules/rule-1') && options.method === 'DELETE')).toBe(true)
    })
  })

  it('unblocks a blocked exception and changes the role of an active one', async () => {
    const fetchMock = createFetchRouter(routes(
      detail({ groups: [baselineGroup({ exception_count: 2, blocked_count: 1 })] }),
      [
        { path: '/api/admin/application-entitlements', method: 'POST', response: () => jsonResponse({ data: {} }) },
        { path: '/api/admin/application-entitlements/ent-1', method: 'PATCH', response: () => jsonResponse({ data: {} }) },
      ],
      { 'rule-1': [exception(), exception({ id: 'ent-2', person_id: 'person-2', full_name: 'Blocked Person', email: 'blocked@millennia21.id', is_active: false })] },
    ))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Blocked Person')

    await user.click(screen.getByRole('button', { name: /Actions for Blocked Person on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Unblock' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-entitlements' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({ person_id: 'person-2', application_id: 'exima', role: 'ADMIN' })
    })

    await user.click(screen.getByRole('button', { name: /Actions for Dummy Staff on exima/ }))
    await user.click(screen.getByRole('button', { name: 'Change role' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change Role' })
    await user.click(within(dialog).getByRole('button', { name: /^ADMIN/ }))
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-entitlements/ent-1') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body)).toEqual({ role: 'STAFF' })
    })
  })

  it('lists older access no group covers apart, with Remove and Block only', async () => {
    globalThis.fetch = createFetchRouter(routes(
      detail({ other_count: 1 }),
      [],
      { 'rule-1': [exception()], other: [exception({ id: 'ent-9', person_id: 'person-9', full_name: 'Far Away', email: 'far@millennia21.id' })] },
    ))
    const { user } = renderPage()
    expect(await screen.findByText('Other access')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: /Actions for Far Away on exima/ }))
    expect(screen.queryByRole('button', { name: 'Change role' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Block access' })).toBeVisible()
  })

  it('has no exception table for a group without exceptions', async () => {
    globalThis.fetch = createFetchRouter(routes(detail({ groups: [baselineGroup({ exception_count: 0 })] }), [], {}))
    renderPage()
    expect(await screen.findByText(/No exceptions\. Everyone this group covers gets STAFF\./)).toBeVisible()
    expect(screen.queryByRole('columnheader', { name: 'Person' })).not.toBeInTheDocument()
  })

  it('pages the exceptions of a group on the server', async () => {
    const fetchMock = createFetchRouter([
      {
        path: /\/api\/admin\/application-access\/apps\/exima\/exceptions/,
        method: 'GET',
        response: () => jsonResponse({ data: [exception()], paging: { current_page: 1, total_page: 3, total_item: 25, size: 10 } }),
      },
      { path: '/api/admin/application-access/apps/exima', method: 'GET', response: () => jsonResponse({ data: detail({ groups: [baselineGroup({ exception_count: 25 })] }) }) },
      { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Dummy Staff')
    expect(screen.getByText(/Page 1 of 3/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url.includes('exceptions') && url.includes('page=2') && url.includes('group_id=rule-1'))).toBe(true)
    })
  })

  it('pages the group cards five at a time', async () => {
    const groups = Array.from({ length: 7 }, (_, index) => baselineGroup({ id: `rule-${index + 1}`, exception_count: 0, job_level_ids: [`level-${index}`], job_levels: [{ id: `level-${index}`, name: `Level ${index + 1}` }] }))
    globalThis.fetch = createFetchRouter(routes(detail({ groups }), [], {}))
    const { user } = renderPage()
    await screen.findByText(/Page 1 of 2/)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2))
  })

  describe('Roles tab', () => {
    const orderRoutes = [
      { path: '/api/admin/application-roles/order', method: 'PATCH', response: () => jsonResponse({ data: [] }) },
    ]

    it('lists the roles highest first with their usage and opens the role pages', async () => {
      globalThis.fetch = createFetchRouter(routes(detail(), orderRoutes))
      const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access/apps/exima?tab=roles')
      const admin = (await screen.findByText('ADMIN')).closest('tr')
      // Order 1 and one active entitlement.
      expect(within(admin).getAllByText('1')).toHaveLength(2)
      const body = screen.getAllByRole('row').slice(1)
      expect(within(body[0]).getByText('ADMIN')).toBeVisible()
      expect(within(body[1]).getByText('STAFF')).toBeVisible()
      expect(screen.queryByText('Dummy Staff')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Actions for exima STAFF' }))
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(await screen.findByText('Edit role page')).toBeVisible()
    })

    it('opens the add role page', async () => {
      globalThis.fetch = createFetchRouter(routes(detail(), orderRoutes))
      const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access/apps/exima?tab=roles')
      await screen.findByText('ADMIN')
      await user.click(screen.getByRole('button', { name: 'Add role' }))
      expect(await screen.findByText('New role page')).toBeVisible()
    })

    it('saves a new order when a role moves up or down', async () => {
      const fetchMock = createFetchRouter(routes(detail(), orderRoutes))
      globalThis.fetch = fetchMock
      const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access/apps/exima?tab=roles')
      await screen.findByText('ADMIN')
      expect(screen.getByRole('button', { name: 'Move ADMIN up' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move STAFF down' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Move STAFF up' }))
      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/application-roles/order'))
        expect(JSON.parse(call[1].body)).toEqual({ application_id: 'exima', role_ids: ['role-staff', 'role-admin'] })
      })
    })

    it('switches between the Access and Roles tabs', async () => {
      globalThis.fetch = createFetchRouter(routes(detail(), orderRoutes))
      const { user } = renderPage()
      await screen.findByText('Dummy Staff')
      await user.click(screen.getByRole('button', { name: 'Roles' }))
      expect(await screen.findByRole('button', { name: 'Add role' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Access' }))
      expect(await screen.findByText('Dummy Staff')).toBeVisible()
    })
  })
})
