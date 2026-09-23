import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { DashboardPage } from '../../../src/features/dashboard/pages/DashboardPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('Dashboard permission metrics', () => {
  it('keeps all metric cards and marks inaccessible domains as restricted', async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: '/api/dashboard/summary',
        response: jsonResponse({
          data: {
            totals: { employees: 0, students: 12, classes: 3 },
            employees: { by_gender: {}, by_age_bucket: {}, birthdays_this_month: [] },
            students: { by_gender: {}, by_age_bucket: {} },
            classes: { by_grade: [] },
          },
        }),
      },
    ])

    renderWithProviders(
      <AuthContext.Provider value={{
        user: {
          type: 'admin',
          role: 'VIEWER',
          full_name: 'Student Viewer',
          can_view_student_data: true,
          can_view_employee_data: false,
        },
      }}>
        <DashboardPage />
      </AuthContext.Provider>,
    )

    expect(await screen.findByText('Total Employees')).toBeVisible()
    expect(screen.getByText('Total Students')).toBeVisible()
    expect(screen.getAllByText('Active Classes').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Restricted').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Employee & Intern access is required to view this metric.')).toBeVisible()
    expect(screen.getByText('Employee & Intern access is required to view this gender distribution.')).toBeVisible()
    expect(screen.getByText('Employee & Intern access is required to view this age distribution.')).toBeVisible()
    expect(screen.getByText('Employee & Intern access is required to view staff birthdays.')).toBeVisible()
    expect(await screen.findByText('12')).toBeVisible()
  })
})
