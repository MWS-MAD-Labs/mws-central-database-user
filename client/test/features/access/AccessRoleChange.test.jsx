import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AccessPage } from '../../../src/features/access/pages/AccessPage.jsx'
import { adminUsersApi } from '../../../src/features/access/api/accessApi.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const baseAdmin = {
  id: 'admin-2',
  full_name: 'Dummy Staff',
  admin_no: 'ADM-002',
  email: 'dummystaff@millennia21.id',
  role: 'DATABASE_ADMIN',
  is_active: true,
  is_protected: false,
  is_head_of_care: false,
  is_identifier_change_approver: false,
  can_view_student_data: true,
  can_view_employee_data: true,
  can_view_sensitive_data: false,
  can_view_employee_pii: false,
  can_view_employee_disciplinary_data: false,
  can_view_all_student_units: false,
  can_view_all_employee_units: false,
  student_view_unit_ids: [],
  employee_view_unit_ids: [],
  can_write_student_data: false,
  can_write_employee_data: true,
  can_manage_enrollments: false,
  can_manage_teacher_assignments: false,
  after_hours_write_until: null,
}

function accessRoutes(admins, approverStatus = { employee: true, student: true }) {
  return [
    {
      path: '/api/admin/identifier-change-requests/approver-status',
      response: jsonResponse({ data: approverStatus }),
    },
    {
      path: /^\/api\/admin\/admin-users(?:\?.*)?$/,
      response: jsonResponse({
        data: admins,
        paging: { current_page: 1, total_page: 1, total_item: admins.length, size: 10 },
      }),
    },
    {
      path: /^\/api\/admin\/employees(?:\?.*)?$/,
      response: jsonResponse({
        data: [],
        paging: { current_page: 1, total_page: 1, total_item: 0, size: 100 },
      }),
    },
  ]
}

function renderAccess(user) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <AccessPage />
      </ConfirmProvider>
    </AuthContext.Provider>,
  )
}

describe('Access role change summary', () => {
  it('pages and searches promotable employees before submitting the selection', async () => {
    const fetchMock = createFetchRouter([
      ...accessRoutes([]),
      {
        path: /\/api\/admin\/admin-users\/promotable-employees\?page=1&size=10$/,
        response: jsonResponse({
          data: [{
            id: 'employee-1',
            full_name: 'Alpha Candidate',
            email: 'alpha@millennia21.id',
            employee_id: 'EMP-001',
            unit: 'Elementary',
          }],
          paging: { current_page: 1, total_page: 2, total_item: 11, size: 10 },
        }),
      },
      {
        path: /\/api\/admin\/admin-users\/promotable-employees\?page=2&size=10$/,
        response: jsonResponse({
          data: [{
            id: 'employee-2',
            full_name: 'Beta Candidate',
            email: 'beta@millennia21.id',
            employee_id: 'EMP-011',
            unit: 'Junior High',
          }],
          paging: { current_page: 2, total_page: 2, total_item: 11, size: 10 },
        }),
      },
      {
        path: /\/api\/admin\/admin-users\/promotable-employees\?page=1&size=10&search=Beta$/,
        response: jsonResponse({
          data: [{
            id: 'employee-2',
            full_name: 'Beta Candidate',
            email: 'beta@millennia21.id',
            employee_id: 'EMP-011',
            unit: 'Junior High',
          }],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
      {
        path: '/api/admin/admin-users/promote',
        method: 'POST',
        response: jsonResponse({ data: { id: 'admin-new' } }),
      },
    ])
    globalThis.fetch = fetchMock

    const { user } = renderAccess({ role: 'SUPER_ADMIN' })
    await user.click(await screen.findByRole('button', { name: 'Promote' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Alpha Candidate')).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(await within(dialog).findByText('Beta Candidate')).toBeVisible()

    const search = within(dialog).getByPlaceholderText('Search employees')
    await user.clear(search)
    await user.click(search)
    await user.paste('Beta')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) =>
        url.includes('/promotable-employees?page=1&size=10&search=Beta'),
      )).toBe(true)
    })

    await user.click(within(dialog).getByRole('radio', { name: /Beta Candidate/ }))
    expect(within(dialog).getAllByText('Junior High')).toHaveLength(2)
    await user.click(within(dialog).getByRole('button', { name: 'Promote' }))

    await waitFor(() => {
      const promoteCall = fetchMock.mock.calls.find(
        ([url, options]) => url === '/api/admin/admin-users/promote' && options.method === 'POST',
      )
      expect(JSON.parse(promoteCall[1].body)).toEqual({
        employee_id: 'employee-2',
        role: 'DATABASE_ADMIN',
      })
    })
  })

  it('maps the independent all-unit scope APIs', async () => {
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/admin-users/can-view-all-student-units/admin-2',
        method: 'PATCH',
        response: jsonResponse({ data: { id: 'admin-2' } }),
      },
      {
        path: '/api/admin/admin-users/can-view-all-employee-units/admin-2',
        method: 'PATCH',
        response: jsonResponse({ data: { id: 'admin-2' } }),
      },
    ])
    globalThis.fetch = fetchMock

    await adminUsersApi.setCanViewAllStudentUnits('admin-2', true)
    await adminUsersApi.setCanViewAllEmployeeUnits('admin-2', false)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      can_view_all_student_units: true,
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      can_view_all_employee_units: false,
    })
  })

  it('maps the disciplinary permission mutation API', async () => {
    const fetchMock = createFetchRouter([{
      path: '/api/admin/admin-users/can-view-employee-disciplinary-data/admin-2',
      method: 'PATCH',
      response: jsonResponse({
        data: { id: 'admin-2', can_view_employee_disciplinary_data: true },
      }),
    }])
    globalThis.fetch = fetchMock

    const result = await adminUsersApi.setCanViewEmployeeDisciplinaryData(
      'admin-2',
      true,
    )
    expect(result.can_view_employee_disciplinary_data).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      can_view_employee_disciplinary_data: true,
    })
  })

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
              can_view_employee_disciplinary_data: true,
               can_view_all_student_units: false,
               can_view_all_employee_units: false,
               student_view_unit_ids: [],
               employee_view_unit_ids: [],
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
    await user.click(screen.getByRole('button', { name: 'Actions for dummystaff@millennia21.id' }))
    await user.click(screen.getByRole('button', { name: 'Make Viewer' }))

    const dialog = screen.getByRole('dialog', { name: 'Change admin role' })
    expect(within(dialog).getByText('Will be cleared')).toBeVisible()
    expect(within(dialog).getByText('• Write Employee Data')).toBeVisible()
    expect(within(dialog).getByText('• Manage Teacher Assignments')).toBeVisible()
    expect(within(dialog).getByText('• After-hours Write Grant')).toBeVisible()
    expect(within(dialog).getByText('Will be kept (view only)')).toBeVisible()
    expect(within(dialog).getByText('• View Employees & Interns')).toBeVisible()
    expect(within(dialog).getByText('• Employee PII')).toBeVisible()
    expect(within(dialog).getByText('• Employee Disciplinary Data')).toBeVisible()
    expect(within(dialog).getByText('• View Students')).toBeVisible()
  })

  it('saves a custom student-unit checklist with all four scope fields', async () => {
    const admin = {
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
      can_view_employee_disciplinary_data: true,
      can_view_all_student_units: false,
      can_view_all_employee_units: false,
      student_view_unit_ids: [],
      employee_view_unit_ids: ['unit-office'],
      can_write_student_data: false,
      can_write_employee_data: false,
      can_manage_enrollments: false,
      can_manage_teacher_assignments: false,
      after_hours_write_until: null,
    }
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/admin-users(?:\?.*)?$/,
        response: jsonResponse({
          data: [admin],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
      {
        path: '/api/admin/grades?page=1&size=100',
        response: jsonResponse({
          data: [
            {
              id: 'grade-1',
              name: 'Grade 1',
              unit_id: 'unit-elementary',
              unit_name: 'Elementary',
            },
          ],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 100 },
        }),
      },
      {
        path: '/api/admin/admin-users/permissions/admin-2',
        method: 'PATCH',
        response: jsonResponse({
          data: { ...admin, student_view_unit_ids: ['unit-elementary'] },
        }),
      },
    ])
    globalThis.fetch = fetchMock

    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: { role: 'SUPER_ADMIN' } }}>
        <ConfirmProvider>
          <AccessPage />
        </ConfirmProvider>
      </AuthContext.Provider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Student Units: Own' }))
    const dialog = screen.getByRole('dialog', { name: 'Student Units' })
    await user.click(within(dialog).getByRole('radio', { name: /^Selected academic units/ }))
    await user.click(await within(dialog).findByLabelText('Elementary'))
    await user.click(within(dialog).getByRole('button', { name: 'Save Scope' }))

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([url, options]) =>
          url === '/api/admin/admin-users/permissions/admin-2' &&
          options.method === 'PATCH',
      )
      expect(request).toBeDefined()
      expect(JSON.parse(request[1].body)).toMatchObject({
        can_view_all_student_units: false,
        can_view_all_employee_units: false,
        student_view_unit_ids: ['unit-elementary'],
        employee_view_unit_ids: ['unit-office'],
        can_view_employee_disciplinary_data: true,
      })
    })
  })

  it('clears a custom list when all units is selected', async () => {
    const admin = {
      id: 'admin-2',
      full_name: 'Dummy Staff',
      admin_no: 'ADM-002',
      email: 'dummystaff@millennia21.id',
      role: 'VIEWER',
      is_active: true,
      is_protected: false,
      can_view_student_data: true,
      can_view_employee_data: false,
      can_view_sensitive_data: false,
      can_view_employee_pii: false,
      can_view_employee_disciplinary_data: false,
      can_view_all_student_units: false,
      can_view_all_employee_units: false,
      student_view_unit_ids: ['unit-elementary'],
      employee_view_unit_ids: [],
      can_write_student_data: false,
      can_write_employee_data: false,
      can_manage_enrollments: false,
      can_manage_teacher_assignments: false,
      after_hours_write_until: null,
    }
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/admin-users(?:\?.*)?$/,
        response: jsonResponse({
          data: [admin],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
      {
        path: '/api/admin/grades?page=1&size=100',
        response: jsonResponse({ data: [], paging: {} }),
      },
      {
        path: '/api/admin/admin-users/permissions/admin-2',
        method: 'PATCH',
        response: jsonResponse({ data: admin }),
      },
    ])
    globalThis.fetch = fetchMock

    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: { role: 'SUPER_ADMIN' } }}>
        <ConfirmProvider>
          <AccessPage />
        </ConfirmProvider>
      </AuthContext.Provider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Student Units: 1 selected' }))
    const dialog = screen.getByRole('dialog', { name: 'Student Units' })
    await user.click(within(dialog).getByRole('radio', { name: /^All units/ }))
    expect(within(dialog).getByRole('radio', { name: /^Selected academic units/ })).not.toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Save Scope' }))

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(
        ([url, options]) =>
          url === '/api/admin/admin-users/permissions/admin-2' &&
          options.method === 'PATCH',
      )
      expect(JSON.parse(request[1].body)).toMatchObject({
        can_view_all_student_units: true,
        student_view_unit_ids: [],
      })
    })
  })

  it('loads every unit page and keeps an unavailable selected unit visible', async () => {
    const admin = {
      id: 'admin-2', full_name: 'Dummy Staff', admin_no: 'ADM-002',
      email: 'dummystaff@millennia21.id', role: 'VIEWER', is_active: true,
      is_protected: false, can_view_student_data: true,
      can_view_employee_data: false, can_view_sensitive_data: false,
      can_view_employee_pii: false, can_view_employee_disciplinary_data: false,
      can_view_all_student_units: false, can_view_all_employee_units: false,
      student_view_unit_ids: ['unit-legacy'], employee_view_unit_ids: [],
      can_write_student_data: false, can_write_employee_data: false,
      can_manage_enrollments: false, can_manage_teacher_assignments: false,
      after_hours_write_until: null,
    }
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/admin-users(?:\?.*)?$/,
        response: jsonResponse({ data: [admin], paging: { total_page: 1 } }),
      },
      {
        path: '/api/admin/grades?page=1&size=100',
        response: jsonResponse({
          data: [{ id: 'grade-1', unit_id: 'unit-1', unit_name: 'Elementary' }],
          paging: { total_page: 2 },
        }),
      },
      {
        path: '/api/admin/grades?page=2&size=100',
        response: jsonResponse({
          data: [{ id: 'grade-2', unit_id: 'unit-2', unit_name: 'Junior High' }],
          paging: { total_page: 2 },
        }),
      },
    ])
    globalThis.fetch = fetchMock

    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: { role: 'SUPER_ADMIN' } }}>
        <ConfirmProvider><AccessPage /></ConfirmProvider>
      </AuthContext.Provider>,
    )
    await user.click(await screen.findByRole('button', { name: 'Student Units: 1 selected' }))
    const dialog = screen.getByRole('dialog', { name: 'Student Units' })
    await user.click(within(dialog).getByRole('radio', { name: /^Selected academic units/ }))

    expect(await within(dialog).findByLabelText('Junior High')).toBeVisible()
    expect(within(dialog).getByLabelText('Unavailable unit (unit-legacy)')).toBeChecked()
  })

  it('keeps History, Grant, role change and Demote inside one actions menu', async () => {
    globalThis.fetch = createFetchRouter(accessRoutes([{ ...baseAdmin }]))
    const { user } = renderAccess({ role: 'SUPER_ADMIN' })
    await screen.findByText('dummystaff@millennia21.id')

    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Demote' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions for dummystaff@millennia21.id' }))
    expect(screen.getByRole('button', { name: /History/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Grant after-hours write/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Make Viewer/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Demote/ })).toBeVisible()
  })

  it('shows the approver checklist only for a Head of CARE admin, and only to a protected Super Admin', async () => {
    globalThis.fetch = createFetchRouter(accessRoutes([
      { ...baseAdmin, id: 'admin-care', email: 'care@millennia21.id', is_head_of_care: true },
      { ...baseAdmin, id: 'admin-other', email: 'other@millennia21.id', is_head_of_care: false },
    ]))
    const { user } = renderAccess({ role: 'SUPER_ADMIN', is_protected: true })
    await screen.findByText('care@millennia21.id')

    const menus = screen.getAllByRole('button', { name: /^Employee/ })
    await user.click(menus[0])
    expect(screen.getByRole('button', { name: /Change Request Approver/ })).toBeVisible()
    await user.keyboard('{Escape}')
    await user.click(menus[1])
    expect(screen.queryByRole('button', { name: /Change Request Approver/ })).not.toBeInTheDocument()
  })

  it('warns Super Admins when no one can approve employee data changes', async () => {
    globalThis.fetch = createFetchRouter(accessRoutes([{ ...baseAdmin }], { employee: false, student: true }))
    renderAccess({ role: 'SUPER_ADMIN' })
    expect(await screen.findByText('No approver for employee data changes yet.')).toBeVisible()
    expect(screen.getByText(/Head of\s+CARE/)).toBeVisible()
  })

  it('stays quiet when an approver exists', async () => {
    globalThis.fetch = createFetchRouter(accessRoutes([{ ...baseAdmin }]))
    renderAccess({ role: 'SUPER_ADMIN' })
    await screen.findByText('dummystaff@millennia21.id')
    expect(screen.queryByText('No approver for employee data changes yet.')).not.toBeInTheDocument()
  })
})
