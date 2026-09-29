import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ProfilePage } from '../../../src/features/profile/pages/ProfilePage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('ProfilePage access summary', () => {
  it('shows domain, sensitive, task, write, unit, and after-hours access', async () => {
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

    renderWithProviders(
      <AuthContext.Provider value={{ user }}>
        <ProfilePage />
      </AuthContext.Provider>,
    )

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
})
