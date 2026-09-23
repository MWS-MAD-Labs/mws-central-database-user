import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AccessPage } from '../../../src/features/access/pages/AccessPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('Access role change summary', () => {
  it('shows cleared task permissions and retained view permissions', async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/admin-users(?:\?.*)?$/,
        response: jsonResponse({
          data: [
            {
              id: 'admin-2',
              full_name: 'Dummy Staff',
              admin_no: 'ADM-002',
              email: 'dummystaff@millennia21.id',
              role: 'DATABASE_ADMIN',
              is_active: true,
              is_protected: false,
              can_view_student_data: true,
              can_view_employee_data: true,
              can_view_sensitive_data: false,
              can_view_employee_pii: true,
              can_view_all_units: false,
              can_write_student_data: false,
              can_write_employee_data: true,
              can_manage_enrollments: false,
              can_manage_teacher_assignments: true,
              after_hours_write_until: '2099-01-01T00:00:00.000Z',
            },
          ],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
      {
        path: /^\/api\/admin\/employees(?:\?.*)?$/,
        response: jsonResponse({
          data: [],
          paging: { current_page: 1, total_page: 1, total_item: 0, size: 100 },
        }),
      },
    ])

    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: { role: 'SUPER_ADMIN' } }}>
        <ConfirmProvider>
          <AccessPage />
        </ConfirmProvider>
      </AuthContext.Provider>,
    )

    expect(await screen.findByText('dummystaff@millennia21.id')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Make Viewer' }))

    const dialog = screen.getByRole('dialog', { name: 'Change admin role' })
    expect(within(dialog).getByText('Will be cleared')).toBeVisible()
    expect(within(dialog).getByText('• Write Employee Data')).toBeVisible()
    expect(within(dialog).getByText('• Manage Teacher Assignments')).toBeVisible()
    expect(within(dialog).getByText('• After-hours Write Grant')).toBeVisible()
    expect(within(dialog).getByText('Will be kept (view only)')).toBeVisible()
    expect(within(dialog).getByText('• View Employees & Interns')).toBeVisible()
    expect(within(dialog).getByText('• Employee PII')).toBeVisible()
    expect(within(dialog).getByText('• View Students')).toBeVisible()
  })
})
