import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { EmployeeDetailPage } from '../../../src/features/employees/pages/EmployeeDetailPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  elementaryDatabaseAdmin,
  employeeFixture,
  superAdminUser,
} from '../../fixtures/employees.js'

const PII_KEYS = ['gender', 'religion', 'religion_other', 'birth_place', 'birth_date', 'marital_status', 'nik', 'npwp', 'bank_account_number', 'bpjs_number', 'bpjs_employment_number', 'kpj_number']

// The detail endpoint leaves these out; only the reveal call returns them.
function splitPii(employee) {
  const identity = { ...employee.identity }
  const revealed = {}
  for (const key of PII_KEYS) {
    revealed[key] = identity[key]
    delete identity[key]
  }
  return { redacted: { ...employee, identity }, revealed }
}

function detailRoutes({ employee = employeeFixture(), status = 200, history = [] } = {}) {
  const { redacted, revealed } = splitPii(employee)
  return [
    {
      path: '/api/admin/employees/employee-1',
      response: ({ method }) => method === 'DELETE'
        ? jsonResponse({ data: { id: 'employee-1' } })
        : jsonResponse(status === 200 ? { data: redacted } : { message: 'Unavailable' }, status),
    },
    { path: '/api/admin/employees/employee-1/disciplinary-actions?page=1&size=10', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/employees/employee-1/disciplinary-actions/access', method: 'POST', response: jsonResponse({ data: true }) },
    { path: '/api/admin/employees/employee-1/mutation-history', response: jsonResponse({ data: history }) },
    { path: '/api/admin/employees/employee-1/teaching-assignments', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/employees/employee-1/support-assignments', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/employees/employee-1/pc-activity-mentorships', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/employees/employee-1/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: revealed }) },
    { path: '/api/admin/employees/employee-1/mutation-history/history-1/rollback', method: 'PATCH', response: jsonResponse({ data: {} }) },
  ]
}

function renderDetail({ user = superAdminUser, routes = detailRoutes() } = {}) {
  const fetchMock = createFetchRouter(routes)
  globalThis.fetch = fetchMock
  return {
    ...renderWithProviders(
      <AuthContext.Provider value={{ user }}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={['/employees/employee-1']}>
            <Routes>
              <Route path="/employees/:employeeId" element={<EmployeeDetailPage />} />
              <Route path="/employees" element={<p>Employee list destination</p>} />
            </Routes>
          </MemoryRouter>
        </ConfirmProvider>
      </AuthContext.Provider>,
      { withRouter: false },
    ),
    fetchMock,
  }
}

describe('EmployeeDetailPage', () => {
  it('renders loading, identity, actions, and sensitive-field privacy', async () => {
    renderDetail()
    expect(screen.getByText('Loading employee...')).toBeVisible()

    expect(await screen.findByRole('heading', { level: 1, name: 'Ari Employee' })).toBeVisible()
    expect(screen.getByText('12.34.567 / Elementary')).toBeVisible()
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/employees/employee-1/edit')
    expect(screen.getByRole('button', { name: 'Extend contract' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Change Photo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Show Sensitive Fields' })).toBeVisible()
    expect(screen.queryByText('1990')).not.toBeInTheDocument()
    expect(await screen.findByText('No mutation history found.')).toBeVisible()
  })

  it('renders a non-disclosing error state', async () => {
    renderDetail({ routes: detailRoutes({ status: 503 }) })
    expect(await screen.findByText('Employee data is unavailable.')).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: 'Ari Employee' })).not.toBeInTheDocument()
  })

  it('keeps an out-of-unit database admin read-only', async () => {
    const { user } = renderDetail({
      user: elementaryDatabaseAdmin,
      routes: [
        ...detailRoutes({ employee: employeeFixture({ employment: { unit: 'Junior High' } }) }),
        { path: '/api/admin/units/unit-elementary', response: jsonResponse({ data: { id: 'unit-elementary', name: 'Elementary' } }) },
      ],
    })
    await screen.findByRole('heading', { level: 1, name: 'Ari Employee' })
    // Disciplinary history is masked-by-default - reveal it before checking.
    await user.click(await screen.findByRole('button', { name: 'Show Disciplinary Actions' }))
    const revealDialog = await screen.findByRole('dialog', { name: 'View disciplinary history' })
    await user.click(within(revealDialog).getByRole('button', { name: 'View' }))
    await screen.findByText('No disciplinary actions on file.')

    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Extend contract' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change Photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Issue Record' })).not.toBeInTheDocument()
  })

  it('confirms and submits a lifecycle rollback mutation', async () => {
    const history = [{
      id: 'history-1',
      field: 'STATUS',
      value: 'ACTIVE',
      start_date: '2026-09-01T00:00:00.000Z',
      end_date: null,
      can_rollback: true,
    }]
    const { user, fetchMock } = renderDetail({ routes: detailRoutes({ history }) })
    await screen.findByRole('heading', { level: 1, name: 'Ari Employee' })

    await user.click(await screen.findByTitle('Undo this Status change'))
    const dialog = screen.getByRole('dialog', { name: 'Roll back change' })
    expect(dialog).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Roll back' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/employees/employee-1/mutation-history/history-1/rollback' && options.method === 'PATCH',
    )).toBe(true))
  })
})
