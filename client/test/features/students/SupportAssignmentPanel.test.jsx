import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import {
  StudentSupportAssignmentPanel,
  SupportAssignmentDialog,
} from '../../../src/features/students/components/sensitivePanels/StudentSupportAssignmentPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const eligibleTeacher = {
  id: 'employee-1',
  identity: { full_name: 'Taylor SE Teacher', email: 'taylor@millennia21.id' },
  employment: {
    employee_id: 'EMP-1',
    unit: 'Elementary',
    job_level: 'SE Teacher',
    job_position: 'Special Education Teacher',
  },
}

const eligibleIntern = {
  id: 'intern-1',
  identity: { full_name: 'Rina SE Intern', email: 'rina@millennia21.id' },
  employment: {
    unit: 'Elementary',
    job_position: 'Special Education Teacher',
    is_teaching_position: true,
  },
}

function panelRoutes(assignments = [], interns = []) {
  return [
    { path: '/api/admin/students/student-1/support-assignments', response: ({ method }) => method === 'POST' ? jsonResponse({ data: { id: 'assignment-new' } }) : jsonResponse({ data: assignments }) },
    {
      path: /^\/api\/admin\/support-assignments\/candidates(?:\?.*)?$/,
      response: () => {
        const data = [
          { ...eligibleTeacher, workforce_type: 'EMPLOYEE', active_student_count: 2 },
          ...interns.map((intern) => ({ ...intern, workforce_type: 'INTERN', active_student_count: 0 })),
        ]
        return jsonResponse({ data, paging: { current_page: 1, total_page: 1, total_item: data.length, size: 10 } })
      },
    },
    { path: '/api/admin/support-assignments/caseload', response: jsonResponse({ data: [{ employee_id: 'employee-1', active_student_count: 2 }] }) },
    { path: '/api/admin/students/student-1/support-assignments/assignment-1/end', method: 'PATCH', response: jsonResponse({ data: { id: 'assignment-1' } }) },
    { path: '/api/admin/students/student-1/support-assignments/assignment-1/reactivate', method: 'PATCH', response: jsonResponse({ data: { id: 'assignment-1' } }) },
    { path: '/api/admin/students/student-1/support-assignments/delete/assignment-1', method: 'PATCH', response: jsonResponse({ data: { id: 'assignment-1' } }) },
  ]
}

describe('StudentSupportAssignmentPanel', () => {
  it('filters eligible teachers to the student unit and creates an assignment', async () => {
    const fetchMock = createFetchRouter(panelRoutes())
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <StudentSupportAssignmentPanel studentId="student-1" studentUnitName="Elementary" canWrite />
      </ConfirmProvider>,
    )
    expect(await screen.findByText('No Special Education teacher assigned yet.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Assign' }))

    expect(await screen.findByRole('radio', { name: /Taylor SE Teacher/ })).toBeVisible()
    expect(screen.queryByRole('radio', { name: /Jordan SE Teacher/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('radio', { name: /Taylor SE Teacher/ }))
    await user.type(screen.getByPlaceholderText(/Weekly reading support/), 'Reading support')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const confirmDialog = screen.getByRole('dialog', { name: 'Confirm teacher assignment' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Assign teacher' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/students/student-1/support-assignments' && options.method === 'POST',
    )).toBe(true))
  })

  it('lists an eligible intern and submits intern_id', async () => {
    const fetchMock = createFetchRouter(panelRoutes([], [eligibleIntern]))
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <StudentSupportAssignmentPanel studentId="student-1" studentUnitName="Elementary" canWrite />
      </ConfirmProvider>,
    )
    await screen.findByText('No Special Education teacher assigned yet.')
    await user.click(screen.getByRole('button', { name: 'Assign' }))
    await user.click(await screen.findByRole('radio', { name: /Rina SE Intern/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Confirm teacher assignment' })).getByRole('button', { name: 'Assign teacher' }),
    )

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, options]) =>
          url === '/api/admin/students/student-1/support-assignments' &&
          options.method === 'POST',
      )
      expect(JSON.parse(call[1].body)).toMatchObject({ intern_id: 'intern-1' })
    })
  })

  it('confirms ending, dropping, and reactivating assignments', async () => {
    const active = {
      id: 'assignment-1',
      role: 'SPECIAL_ED',
      start_date: '2026-09-01T00:00:00.000Z',
      end_date: null,
      notes: null,
      employee: eligibleTeacher.identity ? { id: 'employee-1', ...eligibleTeacher.identity } : null,
    }
    const fetchMock = createFetchRouter(panelRoutes([active]))
    globalThis.fetch = fetchMock
    const { user, unmount } = renderWithProviders(
      <ConfirmProvider>
        <StudentSupportAssignmentPanel studentId="student-1" studentUnitName="Elementary" canWrite />
      </ConfirmProvider>,
    )
    await screen.findByText('Taylor SE Teacher')

    await user.click(screen.getByRole('button', { name: 'End assignment' }))
    await user.click(within(screen.getByRole('dialog', { name: 'End assignment' })).getByRole('button', { name: 'End assignment' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/assignment-1/end'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Drop assignment' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Drop assignment' })).getByRole('button', { name: 'Drop assignment' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/delete/assignment-1'))).toBe(true))
    unmount()

    globalThis.fetch = createFetchRouter(panelRoutes([{ ...active, end_date: '2026-09-10T00:00:00.000Z' }]))
    const ended = renderWithProviders(
      <ConfirmProvider>
        <StudentSupportAssignmentPanel studentId="student-1" studentUnitName="Elementary" canWrite />
      </ConfirmProvider>,
    )
    await screen.findByText('Ended')
    await ended.user.click(screen.getByRole('button', { name: 'Reactivate assignment' }))
    await ended.user.click(screen.getByRole('button', { name: 'Reactivate' }))
  })
})

describe('SupportAssignmentDialog', () => {
  it('requires a teacher before submit', async () => {
    const onSubmit = () => { throw new Error('should not submit') }
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <SupportAssignmentDialog employees={[]} onClose={() => {}} onSubmit={onSubmit} />
      </ConfirmProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Special Education Teacher is required.')).toBeVisible()
  })
})
