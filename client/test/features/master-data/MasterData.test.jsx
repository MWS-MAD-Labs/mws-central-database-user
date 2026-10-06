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
      { path: /^\/api\/admin\/majors\?.*$/, response: jsonResponse(listPayload([{ ...unit, id: 'major-1', name: 'Education' }])) },
    ]
    renderPage({
      user: { id: 'admin-2', type: 'admin', role: 'DATABASE_ADMIN' },
      route: '/master-data?tab=education',
      routes,
    })

    expect(await screen.findByText('University of Indonesia')).toBeVisible()
    expect(await screen.findByText('Education')).toBeVisible()
    expect(screen.getAllByText('Only Super Admin can create, edit, or delete master data.')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'New Institution' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New Major' })).toBeDisabled()
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
})
