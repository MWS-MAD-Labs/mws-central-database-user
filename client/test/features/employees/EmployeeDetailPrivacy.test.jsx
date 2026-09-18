import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { EmployeeDetailPage } from '../../../src/features/employees/pages/EmployeeDetailPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const employee = {
  id: 'employee-1',
  created_at: '2026-01-01T00:00:00.000Z',
  identity: {
    full_name: 'Taylor Employee',
    nick_name: 'Taylor',
    email: 'taylor@example.com',
    mobile_phone: '08123456789',
    photo_url: null,
    residential_address: 'Example Street',
    gender: 'FEMALE',
    religion: 'OTHER',
    birth_place: 'Jakarta',
    birth_date: '1990-01-01T00:00:00.000Z',
    marital_status: 'SINGLE',
    nik: '3171000000000001',
    npwp: 'NPWP-PRIVATE',
    bank_account_number: 'BANK-PRIVATE',
    bpjs_number: 'BPJS-PRIVATE',
    bpjs_employment_number: 'BPJSTK-PRIVATE',
    kpj_number: 'KPJ-PRIVATE',
    education_level: 'S1',
    institution_name: 'Example University',
    major: 'Education',
    graduation_year: 2012,
    is_self: false,
  },
  employment: {
    employee_id: 'EMP-1',
    unit: 'Elementary',
    job_position: 'Teacher',
    job_level: 'Teacher',
    building: 'A',
    join_date: '2020-01-01T00:00:00.000Z',
    is_teaching_role: false,
  },
  status_info: {
    status: 'ACTIVE',
    employment_type: 'CONTRACT',
    contract_end_date: '2027-01-01T00:00:00.000Z',
    last_working_date: null,
  },
  offboarding: { last_working_date: null, notes: null },
}

function renderDetail() {
  return renderWithProviders(
    <AuthContext.Provider value={{ user: { role: 'SUPER_ADMIN' } }}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={['/employees/employee-1']}>
          <Routes>
            <Route path="/employees/:employeeId" element={<EmployeeDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { withRouter: false },
  )
}

describe('EmployeeDetailPage sensitive reveal', () => {
  it('keeps PII hidden until confirmed and records the reveal before displaying it', async () => {
    const fetchMock = createFetchRouter([
      { path: '/api/admin/employees/employee-1', response: jsonResponse({ data: employee }) },
      {
        path: '/api/admin/employees/employee-1/sensitive-fields/access',
        method: 'POST',
        response: jsonResponse({ data: true }),
      },
      { path: '/api/admin/employees/employee-1/disciplinary-actions', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/mutation-history', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/teaching-assignments', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/support-assignments', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/pc-activity-mentorships', response: jsonResponse({ data: [] }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Taylor Employee' })).toBeVisible()
    expect(screen.getByText(/PII .* are hidden by default/)).toBeVisible()
    expect(screen.queryByText('3171000000000001')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/sensitive-fields/access'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Show Sensitive Fields' }))
    const dialog = screen.getByRole('dialog', { name: 'View sensitive fields' })
    expect(dialog).toHaveTextContent('This access is logged')
    await user.click(within(dialog).getByRole('button', { name: 'View' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/sensitive-fields/access') && options.method === 'POST',
    )).toBe(true))
    expect(await screen.findByText('3171000000000001')).toBeVisible()
    expect(sessionStorage.getItem('pii-reveal:employee:employee-1')).not.toBeNull()
  })
})
