import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { EmployeesPage } from '../../../src/features/employees/pages/EmployeesPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  elementaryDatabaseAdmin,
  employeeFormOptions,
  employeeListItem,
  superAdminUser,
} from '../../fixtures/employees.js'

function listPayload(employees = [employeeListItem()]) {
  return {
    data: employees,
    paging: { current_page: 1, total_page: 1, total_item: employees.length, size: 10 },
  }
}

function pageRoutes({ employees = [employeeListItem()], listStatus = 200 } = {}) {
  return [
    { path: /^\/api\/admin\/employees(?:\?.*)?$/, response: jsonResponse(listStatus === 200 ? listPayload(employees) : { message: 'Unavailable' }, listStatus) },
    { path: /^\/api\/admin\/units(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.units }) },
    { path: /^\/api\/admin\/job-positions(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.jobPositions }) },
    { path: /^\/api\/admin\/job-levels(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.jobLevels }) },
    { path: /^\/api\/admin\/buildings(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.buildings }) },
  ]
}

function renderPage({ user = superAdminUser, route = '/employees', routes = pageRoutes() } = {}) {
  const fetchMock = createFetchRouter(routes)
  globalThis.fetch = fetchMock
  return {
    ...renderWithProviders(
      <AuthContext.Provider value={{ user }}>
        <ConfirmProvider><EmployeesPage /></ConfirmProvider>
      </AuthContext.Provider>,
      { route },
    ),
    fetchMock,
  }
}

describe('EmployeesPage', () => {
  it('renders loading, loaded records, permissions, and bulk entry points', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const routes = pageRoutes()
    routes[0] = { ...routes[0], response: async () => { await pending; return jsonResponse(listPayload()) } }
    const { user } = renderPage({ routes })

    expect(screen.getByText('Preparing employee records...')).toBeVisible()
    await act(async () => release())
    expect(await screen.findByText('Ari Employee')).toBeVisible()
    expect(screen.getByRole('link', { name: /New Employee/ })).toHaveAttribute('href', '/employees/new')
    expect(screen.getByRole('button', { name: 'Bulk Photo Upload' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: 'Select Ari Employee' }))
    await user.click(screen.getByRole('button', { name: 'Bulk Actions' }))
    expect(screen.getByRole('button', { name: /Bulk edit/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Extend contracts/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Archive selected/ })).toBeEnabled()
  })

  it('renders a non-disclosing list error state', async () => {
    renderPage({ routes: pageRoutes({ listStatus: 503 }) })
    expect(await screen.findByText('Employee data is unavailable.')).toBeVisible()
    expect(screen.queryByText('No employees are ready to review.')).not.toBeInTheDocument()
  })

  it('applies search and filters through the URL-backed query', async () => {
    const { user, fetchMock } = renderPage()
    await screen.findByText('Ari Employee')

    await user.type(screen.getByPlaceholderText('Search Employees'), 'Ari')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('search=Ari'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'All Employment Types' }))
    await user.click(screen.getByRole('option', { name: 'Contract' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('employment_type=CONTRACT'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'All Units' }))
    await user.click(screen.getByRole('option', { name: 'Elementary' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('unit_id=unit-elementary'))).toBe(true))
  })

  it('keeps a read-only database admin away from write and bulk entry points', async () => {
    renderPage({
      user: {
        ...elementaryDatabaseAdmin,
        can_write_employee_data: false,
        can_view_employee_pii: false,
      },
    })
    await screen.findByText('Ari Employee')

    expect(screen.getByRole('button', { name: /New Employee/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Bulk Photo Upload' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select All Employees' })).not.toBeInTheDocument()
  })
})
