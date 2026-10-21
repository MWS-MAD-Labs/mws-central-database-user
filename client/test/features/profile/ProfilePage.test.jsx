import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ProfilePage } from '../../../src/features/profile/pages/ProfilePage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('ProfilePage access summary', () => {
  it('shows domain, sensitive, task, write, unit, and after-hours access under the Access tab', async () => {
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/units/unit-elementary', response: jsonResponse({ data: { id: 'unit-elementary', name: 'Elementary' } }) },
    ])
    const user = {
      id: 'admin-1',
      type: 'admin',
      role: 'DATABASE_ADMIN',
      admin_no: 'ADM-001',
      full_name: 'Dana Admin',
      email: 'dana@example.test',
      unit_id: 'unit-elementary',
      created_at: '2026-01-01T00:00:00.000Z',
      can_view_student_data: true,
      can_view_sensitive_data: false,
      can_manage_enrollments: true,
      can_write_student_data: false,
      can_view_employee_data: true,
      can_view_employee_pii: true,
      can_view_employee_disciplinary_data: true,
      can_manage_teacher_assignments: true,
      can_write_employee_data: false,
      can_view_all_student_units: false,
      can_view_all_employee_units: false,
      student_view_unit_ids: [],
      employee_view_unit_ids: [],
      after_hours_write_until: '2099-01-01T00:00:00.000Z',
    }

    const { user: person } = renderWithProviders(
      <AuthContext.Provider value={{ user }}>
        <ProfilePage />
      </AuthContext.Provider>,
    )

    await person.click(screen.getByRole('tab', { name: 'Access' }))
    expect(screen.getByRole('heading', { name: 'Effective Access' })).toBeVisible()
    expect(screen.getByText('View Students')).toBeVisible()
    expect(screen.getByText('Manage Enrollments')).toBeVisible()
    expect(screen.getByText('View Employees & Interns')).toBeVisible()
    expect(screen.getByText('Employee & Intern PII')).toBeVisible()
    expect(screen.getByText('Employee Disciplinary Data')).toBeVisible()
    expect(screen.getByText('Manage Teacher Assignments')).toBeVisible()
    expect(screen.getByText('Student Units')).toBeVisible()
    expect(screen.getByText('Employee Units')).toBeVisible()
    expect(screen.getAllByText('Assigned unit only.')).toHaveLength(2)
    expect(screen.getByText('After-hours Write Grant')).toBeVisible()
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
  })

  it('lets an employee change their own photo, and nobody else', () => {
    globalThis.fetch = createFetchRouter([])
    const employee = { id: 'e1', type: 'employee', full_name: 'Taylor Employee', email: 'taylor@example.test', employment: {} }
    const { unmount } = renderWithProviders(
      <AuthContext.Provider value={{ user: employee }}>
        <ProfilePage />
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeVisible()
    unmount()

    renderWithProviders(
      <AuthContext.Provider value={{ user: { id: 'a1', type: 'admin', role: 'SUPER_ADMIN', full_name: 'Root', email: 'root@example.test' } }}>
        <ProfilePage />
      </AuthContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: 'Change photo' })).not.toBeInTheDocument()
  })

  describe('the signed-in person\'s own employee record', () => {
    const record = {
      identity: { full_name: 'Dana Admin', nick_name: 'Dana', email: 'dana@millennia21.id', mobile_phone: '0812', can_view_pii: true, is_self: true, residential_address: 'Jl. Mawar 1' },
      employment: { employee_id: '99.99.001', unit: 'Elementary', job_position: 'Teacher', job_level: 'Staff', building: 'Main', join_date: '2024-01-02T00:00:00.000Z', is_pc_mentor_eligible: false },
      status_info: { status: 'ACTIVE', employment_type: 'PERMANENT', last_working_date: null, contract_end_date: null },
    }
    const revealed = {
      gender: 'FEMALE', religion: 'ISLAM', birth_place: 'Jakarta', birth_date: '1990-05-10T00:00:00.000Z', marital_status: 'MARRIED',
      nik: '3171000000000001', npwp: null, bank_account_number: null, bpjs_number: null, bpjs_employment_number: null, kpj_number: null,
      children: { mode: 'BIRTH_DATES', items: [{ birth_date: '2018-03-04T00:00:00.000Z', relation: 'BIOLOGICAL' }], summary: { total: 1, allowance_eligible: 1, under_23: 1, age_23_plus: 0 } },
    }
    const admin = { id: 'a1', type: 'admin', role: 'SUPER_ADMIN', full_name: 'Dana Admin', email: 'dana@millennia21.id', employee_id: 'emp-1' }

    it('gives an admin made from an employee their own record in tabs, with the sensitive details hidden until Show', async () => {
      globalThis.fetch = createFetchRouter([
        { path: '/api/admin/employees/emp-1', response: jsonResponse({ data: record }) },
        { path: '/api/admin/employees/emp-1/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: revealed }) },
      ])
      const { user } = renderWithProviders(
        <AuthContext.Provider value={{ user: admin }}><ProfilePage /></AuthContext.Provider>,
      )
      await user.click(await screen.findByRole('tab', { name: 'Personal' }))
      expect(await screen.findByText('Jl. Mawar 1')).toBeVisible()
      expect(screen.queryByText('3171000000000001')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Show Sensitive Fields' }))
      expect(await screen.findByText('3171000000000001')).toBeVisible()

      await user.click(screen.getByRole('tab', { name: 'Employment' }))
      expect(screen.getByText('99.99.001')).toBeVisible()
      expect(screen.getByText('Elementary')).toBeVisible()

      // The same reveal opens the family tab.
      await user.click(screen.getByRole('tab', { name: 'Family' }))
      expect(screen.getByText('1 Child')).toBeVisible()
      expect(screen.getByRole('link', { name: 'Request a Change' })).toHaveAttribute('href', '/change-requests/mine')
    })

    it('gives an employee who signs in their own record from their own route', async () => {
      globalThis.fetch = createFetchRouter([
        { path: '/api/auth/employee/me/detail', response: jsonResponse({ data: record }) },
        { path: '/api/auth/employee/me/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: revealed }) },
      ])
      const employee = { id: 'e1', type: 'employee', full_name: 'Dana Admin', email: 'dana@millennia21.id', employment: {} }
      const { user } = renderWithProviders(
        <AuthContext.Provider value={{ user: employee }}><ProfilePage /></AuthContext.Provider>,
      )
      await user.click(await screen.findByRole('tab', { name: 'Employment' }))
      expect(screen.getByText('99.99.001')).toBeVisible()
      expect(screen.queryByRole('tab', { name: 'Access' })).not.toBeInTheDocument()
    })

    it('shows an admin who is not linked to an employee only the account and access tabs', async () => {
      globalThis.fetch = createFetchRouter([])
      renderWithProviders(
        <AuthContext.Provider value={{ user: { ...admin, employee_id: null } }}><ProfilePage /></AuthContext.Provider>,
      )
      expect(screen.getByRole('tab', { name: 'Access' })).toBeVisible()
      expect(screen.queryByRole('tab', { name: 'Personal' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Request a Change' })).not.toBeInTheDocument()
    })
  })
})
