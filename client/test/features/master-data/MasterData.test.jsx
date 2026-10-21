import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import MasterData from '../../../src/features/master-data/pages/MasterData.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { superAdminUser } from '../../fixtures/employees.js'

const unit = {
  id: 'unit-1',
  name: 'Elementary',
  created_at: '2026-01-10T08:00:00.000Z',
}

function listPayload(items) {
  return {
    data: items,
    paging: { current_page: 1, total_page: 1, total_item: items.length, size: 10 },
  }
}

function renderPage({ user = superAdminUser, route = '/master-data', routes } = {}) {
  const fetchMock = createFetchRouter(routes || [
    { path: /^\/api\/admin\/units\?.*$/, method: 'GET', response: () => jsonResponse(listPayload([unit])) },
    { path: '/api/admin/units', method: 'POST', response: jsonResponse({ data: { id: 'unit-2', name: 'Junior High' } }) },
    { path: '/api/admin/units/unit-1', method: 'PATCH', response: jsonResponse({ data: { ...unit, name: 'Primary' } }) },
    { path: '/api/admin/units/unit-1', method: 'DELETE', response: jsonResponse({ data: unit }) },
  ])
  globalThis.fetch = fetchMock
  return {
    ...renderWithProviders(
      <AuthContext.Provider value={{ user }}>
        <ConfirmProvider><MasterData /></ConfirmProvider>
      </AuthContext.Provider>,
      { route },
    ),
    fetchMock,
  }
}

describe('MasterData', () => {
  it('runs representative create, edit, and delete flows for a resource', async () => {
    const { user, fetchMock } = renderPage()
    expect(await screen.findByText('Elementary')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'New Unit' }))
    await user.type(screen.getByPlaceholderText('Enter unit name'), 'junior high')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/units' && options.method === 'POST' &&
      JSON.parse(options.body).name === 'Junior High')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Unit' })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Elementary actions' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const editDialog = screen.getByRole('dialog', { name: 'Edit Unit' })
    const nameInput = within(editDialog).getByDisplayValue('Elementary')
    await user.clear(nameInput)
    await user.type(nameInput, 'primary')
    await user.click(within(editDialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/units/unit-1' && options.method === 'PATCH' &&
      JSON.parse(options.body).name === 'Primary')).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Elementary actions' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete unit' })
    expect(within(confirm).getByText('"Elementary" will be deleted.')).toBeVisible()
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/units/unit-1' && options.method === 'DELETE')).toBe(true))
  })

  it('selects resources from the route and prevents non-super-admin writes', async () => {
    const routes = [
      { path: /^\/api\/admin\/institutions\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'institution-1', name: 'University of Indonesia' }])) },
      { path: /^\/api\/admin\/majors\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'major-1', name: 'Educational Technology' }])) },
    ]
    renderPage({
      user: { id: 'admin-2', type: 'admin', role: 'DATABASE_ADMIN' },
      route: '/master-data?tab=education',
      routes,
    })

    expect(await screen.findByText('University of Indonesia')).toBeVisible()
    expect(await screen.findByText('Educational Technology')).toBeVisible()
    expect(screen.getAllByText('Only Super Admin can create, edit, or delete master data.')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'New Institution' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New Major' })).toBeDisabled()
  })

  it('shows scopes and categories together on one tab', async () => {
    const routes = [
      { path: /^\/api\/admin\/application-scopes\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'scope-1', name: 'Safespace' }])) },
      { path: /^\/api\/admin\/application-categories\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'cat-1', name: 'Utilities' }])) },
    ]
    renderPage({ route: '/master-data?tab=scopes', routes })

    expect(await screen.findByText('Safespace')).toBeVisible()
    expect(await screen.findByText('Utilities')).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Scope' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'New Category' })).toBeEnabled()
  })

  it('filters job levels by unit and clears all filters', async () => {
    const routes = [
      { path: /^\/api\/admin\/job-levels\?.*$/, response: jsonResponse(listPayload([])) },
      { path: /^\/api\/admin\/units\?.*$/, response: jsonResponse(listPayload([
        unit,
        { ...unit, id: 'unit_unknown_legacy', name: 'Unknown / Legacy' },
      ])) },
    ]
    const { user, fetchMock } = renderPage({ route: '/master-data?tab=job-levels', routes })

    await user.click(await screen.findByRole('button', { name: 'All Units' }))
    await user.click(screen.getByRole('option', { name: 'Elementary' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('/api/admin/job-levels?') && String(url).includes('unit_id=unit-1'))).toBe(true))
    expect(screen.queryByRole('option', { name: 'Unknown / Legacy' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => {
      const value = String(url)
      return value.includes('/api/admin/job-levels?') && !value.includes('unit_id=')
    })).toBe(true))
  })

  it('filters job positions by unit and active holder limit', async () => {
    const routes = [
      { path: /^\/api\/admin\/job-positions\?.*$/, response: jsonResponse(listPayload([])) },
      { path: /^\/api\/admin\/units\?.*$/, response: jsonResponse(listPayload([unit])) },
    ]
    const { user, fetchMock } = renderPage({ route: '/master-data?tab=job-positions', routes })

    await user.click(await screen.findByRole('button', { name: 'All Units' }))
    await user.click(screen.getByRole('option', { name: 'Elementary' }))
    await user.click(screen.getByRole('button', { name: 'All Active Holder Limits' }))
    await user.click(screen.getByRole('option', { name: 'Per Unit' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => {
      const value = String(url)
      return value.includes('/api/admin/job-positions?') &&
        value.includes('unit_id=unit-1') && value.includes('capacity_scope=PER_UNIT')
    })).toBe(true))
  })

  it('keeps multi-unit table rows compact and opens the complete unit list', async () => {
    const position = {
      id: 'position-1',
      name: 'IT Support',
      is_teaching_position: false,
      units: [
        { id: 'unit-1', name: 'Elementary' },
        { id: 'unit-2', name: 'MAD Lab' },
        { id: 'unit-3', name: 'Junior High' },
      ],
      capacity_scope: null,
      max_active_holders: null,
      created_at: '2026-01-10T08:00:00.000Z',
    }
    const routes = [
      { path: /^\/api\/admin\/job-positions\?.*$/, response: jsonResponse(listPayload([position])) },
      { path: /^\/api\/admin\/units\?.*$/, response: jsonResponse(listPayload(position.units)) },
    ]
    const { user } = renderPage({ route: '/master-data?tab=job-positions', routes })

    await user.click(await screen.findByRole('button', { name: '3 Units' }))
    const dialog = screen.getByRole('dialog', { name: 'Units for IT Support' })
    expect(dialog).toHaveTextContent('Elementary')
    expect(dialog).toHaveTextContent('MAD Lab')
    expect(dialog).toHaveTextContent('Junior High')
  })

  it('uses title case for unit-wide scopes', async () => {
    const positions = [
      {
        id: 'position-all',
        name: 'Driver',
        is_teaching_position: false,
        units: [],
        capacity_scope: null,
        max_active_holders: null,
        created_at: '2026-01-10T08:00:00.000Z',
      },
      {
        id: 'position-academic',
        name: 'Art Teacher',
        is_teaching_position: true,
        units: [],
        capacity_scope: null,
        max_active_holders: null,
        created_at: '2026-01-10T08:00:00.000Z',
      },
    ]
    const routes = [
      { path: /^\/api\/admin\/job-positions\?.*$/, response: jsonResponse(listPayload(positions)) },
      { path: /^\/api\/admin\/units\?.*$/, response: jsonResponse(listPayload([unit])) },
    ]
    renderPage({ route: '/master-data?tab=job-positions', routes })

    const driverRow = (await screen.findByText('Driver')).closest('tr')
    const teacherRow = (await screen.findByText('Art Teacher')).closest('tr')
    expect(within(driverRow).getByText('All Units')).toBeVisible()
    expect(within(teacherRow).getByText('All Academic Units')).toBeVisible()
  })

  describe('Employment tab', () => {
    const rule = { max_children: 3, age_limit: 23, count_biological: true, count_adopted: true, count_step: true }
    const ruleRoutes = (extra = []) => [
      { path: '/api/admin/employee-settings/children-allowance', method: 'GET', response: jsonResponse({ data: rule }) },
      ...extra,
    ]

    it('opens Units first and moves between the sub tabs', async () => {
      const routes = [
        { path: /^\/api\/admin\/job-positions\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'jp-1', name: 'Teacher Aide' }])) },
        { path: /^\/api\/admin\/job-levels\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'jl-1', name: 'Supervisor' }])) },
        { path: /^\/api\/admin\/units\?.*$/, response: jsonResponse(listPayload([unit])) },
        ...ruleRoutes(),
      ]
      const { user } = renderPage({ route: '/master-data?tab=employment', routes })
      expect(await screen.findByText('Elementary')).toBeVisible()
      expect(screen.getByRole('tab', { name: 'Units' })).toHaveAttribute('aria-selected', 'true')
      await user.click(screen.getByRole('tab', { name: 'Job Positions' }))
      expect(await screen.findByText('Teacher Aide')).toBeVisible()
      await user.click(screen.getByRole('tab', { name: 'Job Levels' }))
      expect(await screen.findByText('Supervisor')).toBeVisible()
      await user.click(screen.getByRole('tab', { name: 'Children Allowance' }))
      expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('keeps the old links working', async () => {
      const routes = [
        { path: /^\/api\/admin\/job-levels\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'jl-1', name: 'Supervisor' }])) },
        { path: /^\/api\/admin\/units\?.*$/, response: jsonResponse(listPayload([unit])) },
      ]
      renderPage({ route: '/master-data?tab=job-levels', routes })
      expect(await screen.findByText('Supervisor')).toBeVisible()
      expect(screen.getByRole('tab', { name: 'Job Levels' })).toHaveAttribute('aria-selected', 'true')
    })

    it('saves a changed allowance rule, and Save stays off until something changes', async () => {
      const saved = { ...rule, max_children: 2 }
      const { user, fetchMock } = renderPage({
        route: '/master-data?tab=employment&section=children-allowance',
        routes: ruleRoutes([{ path: '/api/admin/employee-settings/children-allowance', method: 'PUT', response: jsonResponse({ data: saved }) }]),
      })
      const save = await screen.findByRole('button', { name: 'Save' })
      expect(save).toBeDisabled()
      const max = screen.getAllByRole('textbox')[0]
      await user.clear(max)
      await user.type(max, '2')
      expect(save).toBeEnabled()
      await user.click(save)
      await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
        String(url).endsWith('/children-allowance') && options.method === 'PUT' && JSON.parse(options.body).max_children === 2)).toBe(true))
    })

    it('refuses a rule with no kind of child, and shows it read only to anyone but a Super Admin', async () => {
      const { user } = renderPage({
        route: '/master-data?tab=employment&section=children-allowance',
        routes: ruleRoutes(),
      })
      await screen.findByRole('button', { name: 'Save' })
      for (const name of ['Biological', 'Adopted', 'Step']) await user.click(screen.getByRole('checkbox', { name }))
      expect(screen.getByText('Pick at least one kind of child.')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('has no Save for an admin who is not a Super Admin', async () => {
      renderPage({
        user: { id: 'admin-2', type: 'admin', role: 'DATABASE_ADMIN' },
        route: '/master-data?tab=employment&section=children-allowance',
        routes: ruleRoutes(),
      })
      expect(await screen.findByText('Only a Super Admin can change this.')).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  describe('Google Accounts tab', () => {
    const preview = {
      applied: false,
      linked: 0,
      matches: [
        { person_id: 'p1', full_name: 'Dummy Staff', email: 'dummystaff@millennia21.id', person_type: 'EMPLOYEE' },
        { person_id: 'p2', full_name: 'Intern One', email: 'intern.one@millennia21.id', person_type: 'INTERN' },
      ],
      skipped: { admin: 1, linked_elsewhere: 0, not_allowed: 0 },
      unlinked_total: 5,
      not_in_google: 2,
      not_checked: 4,
      linked_total: 9,
      failed: 1,
      suspended: 3,
      missing: 0,
    }
    const routes = (extra = []) => [
      { path: '/api/admin/google/link-existing', method: 'GET', response: jsonResponse({ data: preview }) },
      ...extra,
    ]

    it('shows how people stand against Google and who can be linked', async () => {
      renderPage({ route: '/master-data?tab=employment&section=google-accounts', routes: routes() })
      expect(await screen.findByText('In Google, Not Linked')).toBeVisible()
      expect(screen.getByText('Linked')).toBeVisible()
      expect(screen.getByText(/1 Workspace admin/)).toBeVisible()
      expect(screen.getByText('Not Checked')).toBeVisible()
      expect(screen.getByText(/may not look up from here/)).toBeVisible()
      expect(screen.getByRole('button', { name: 'Link' })).toBeEnabled()
    })

    it('asks first and then links', async () => {
      const { user, fetchMock } = renderPage({
        route: '/master-data?tab=employment&section=google-accounts',
        routes: routes([
          { path: '/api/admin/google/link-existing', method: 'POST', response: jsonResponse({ data: { ...preview, applied: true, linked: 2, matches: [] } }) },
        ]),
      })
      await user.click(await screen.findByRole('button', { name: 'Link' }))
      const dialog = await screen.findByRole('dialog', { name: 'Link Existing Accounts' })
      await user.click(within(dialog).getByRole('button', { name: 'Link' }))
      await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
        String(url).endsWith('/google/link-existing') && options.method === 'POST')).toBe(true))
    })

    it('does not break while the answer is not in yet, or when the reply is not a whole answer', async () => {
      const pending = renderPage({
        route: '/master-data?tab=employment&section=google-accounts',
        routes: [{ path: '/api/admin/google/link-existing', method: 'GET', response: () => new Promise(() => {}) }],
      })
      expect(await screen.findByText('Loading...')).toBeVisible()
      pending.unmount()

      renderPage({
        route: '/master-data?tab=employment&section=google-accounts',
        routes: [{ path: '/api/admin/google/link-existing', method: 'GET', response: jsonResponse({ data: 'ok' }) }],
      })
      expect(await screen.findByText('Loading...')).toBeVisible()
    })

    it('has nothing to link when everyone is already linked', async () => {
      renderPage({
        route: '/master-data?tab=employment&section=google-accounts',
        routes: [{ path: '/api/admin/google/link-existing', method: 'GET', response: jsonResponse({ data: { ...preview, matches: [] } }) }],
      })
      expect(await screen.findByText('In Google, Not Linked')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled()
    })
  })
})
