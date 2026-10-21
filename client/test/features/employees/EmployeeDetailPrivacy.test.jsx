import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { EmployeeDetailPage } from '../../../src/features/employees/pages/EmployeeDetailPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const revealed = {
  gender: 'FEMALE',
  religion: 'OTHER',
  birth_place: 'Jakarta',
  birth_date: '1990-01-01T00:00:00.000Z',
  marital_status: 'MARRIED',
  children: {
    mode: 'BIRTH_DATES',
    summary: { total: 2, under_23: 1, age_23_plus: 1, allowance_eligible: 1 },
    items: [
      { id: 'c1', birth_date: '2000-01-01', relation: 'BIOLOGICAL' },
      { id: 'c2', birth_date: '2016-02-02', relation: 'ADOPTED' },
    ],
  },
  nik: '3171000000000001',
  npwp: 'NPWP-PRIVATE',
  bank_account_number: 'BANK-PRIVATE',
  bpjs_number: 'BPJS-PRIVATE',
  bpjs_employment_number: 'BPJSTK-PRIVATE',
  kpj_number: 'KPJ-PRIVATE',
}

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
    can_view_pii: true,
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
        response: jsonResponse({ data: revealed }),
      },
      { path: '/api/admin/employees/employee-1/disciplinary-actions?page=1&size=10', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/mutation-history', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/teaching-assignments', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/support-assignments', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/pc-activity-mentorships', response: jsonResponse({ data: [] }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Taylor Employee' })).toBeVisible()
    expect(screen.getByText('Sensitive details are hidden.')).toBeVisible()
    expect(screen.queryByText('3171000000000001')).not.toBeInTheDocument()
    expect(screen.queryByText('2 children')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/sensitive-fields/access'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Show Sensitive Fields' }))
    const dialog = screen.getByRole('dialog', { name: 'View sensitive fields' })
    expect(dialog).toHaveTextContent('This access is logged')
    await user.click(within(dialog).getByRole('button', { name: 'View' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/sensitive-fields/access') && options.method === 'POST',
    )).toBe(true))
    expect(await screen.findByText('3171000000000001')).toBeVisible()
    expect(screen.getByText('2 children')).toBeVisible()
    expect(screen.getByText('1 of 2')).toBeVisible()
    expect(sessionStorage.getItem('pii-reveal:employee:employee-1')).not.toBeNull()

    // Hiding forgets the reveal, so a reload starts hidden again.
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(sessionStorage.getItem('pii-reveal:employee:employee-1')).toBeNull()
    expect(screen.queryByText('3171000000000001')).not.toBeInTheDocument()
    expect(screen.queryByText('2 children')).not.toBeInTheDocument()
  })

  it('says when the children were recorded as numbers and that they need a review', async () => {
    const numbers = {
      ...revealed,
      children: {
        mode: 'COUNTS',
        summary: { total: 3, under_23: 2, age_23_plus: 1, allowance_eligible: 2 },
        items: [],
        counts: { under_23: 2, age_23_plus: 1, adopted: 0 },
        declared_at: '2025-01-05T00:00:00.000Z',
        needs_review: true,
      },
    }
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/employees/employee-1', response: jsonResponse({ data: employee }) },
      { path: '/api/admin/employees/employee-1/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: numbers }) },
      { path: '/api/admin/employees/employee-1/disciplinary-actions?page=1&size=10', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/mutation-history', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/teaching-assignments', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/support-assignments', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/employees/employee-1/pc-activity-mentorships', response: jsonResponse({ data: [] }) },
    ])
    const { user } = renderDetail()
    await screen.findByRole('heading', { level: 1, name: 'Taylor Employee' })
    await user.click(screen.getByRole('button', { name: 'Show Sensitive Fields' }))
    await user.click(within(screen.getByRole('dialog', { name: 'View sensitive fields' })).getByRole('button', { name: 'View' }))

    expect(await screen.findByText('3 children')).toBeVisible()
    expect(screen.getByText(/^As numbers on/)).toBeVisible()
    expect(screen.getByText(/Needs review/)).toBeVisible()
    expect(screen.queryByText('Children Born')).not.toBeInTheDocument()
  })
})
