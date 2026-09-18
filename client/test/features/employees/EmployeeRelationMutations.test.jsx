import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { EmployeeMutationHistoryPanel } from '../../../src/features/employees/components/EmployeeMutationHistoryPanel.jsx'
import { EmployeeSupportAssignmentsPanel } from '../../../src/features/employees/components/EmployeeSupportAssignmentsPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const mutationHistory = [{
  id: 'history-1',
  field: 'EMPLOYMENT_TYPE',
  value: 'CONTRACT',
  start_date: '2026-09-01T00:00:00.000Z',
  end_date: null,
  can_rollback: true,
}]

const activeSupportAssignment = {
  id: 'assignment-1',
  role: 'SPECIAL_ED',
  start_date: '2026-09-01T00:00:00.000Z',
  end_date: null,
  student: { id: 'student-1', full_name: 'Ari Student', nis: 'NIS-1' },
}

describe('EmployeeMutationHistoryPanel', () => {
  it('confirms rollback, sends the mutation, and refetches history', async () => {
    let historyReads = 0
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/employees/employee-1/mutation-history',
        response: () => {
          historyReads += 1
          return jsonResponse({ data: mutationHistory })
        },
      },
      {
        path: '/api/admin/employees/employee-1/mutation-history/history-1/rollback',
        method: 'PATCH',
        response: jsonResponse({ data: true }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <EmployeeMutationHistoryPanel employeeId="employee-1" canWrite />
      </ConfirmProvider>,
    )

    expect(await screen.findByText('Contract')).toBeVisible()
    await user.click(screen.getByTitle('Undo this Employment Type change'))
    const dialog = screen.getByRole('dialog', { name: 'Roll back change' })
    expect(dialog).toHaveTextContent('restore Employment Type to its previous value')
    await user.click(within(dialog).getByRole('button', { name: 'Roll back' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/history-1/rollback') && options.method === 'PATCH',
    )).toBe(true))
    await waitFor(() => expect(historyReads).toBeGreaterThanOrEqual(2))
  })

  it('renders empty history and hides rollback from read-only users', async () => {
    globalThis.fetch = createFetchRouter([{
      path: '/api/admin/employees/employee-1/mutation-history',
      response: jsonResponse({ data: [] }),
    }])

    renderWithProviders(
      <ConfirmProvider>
        <EmployeeMutationHistoryPanel employeeId="employee-1" canWrite={false} />
      </ConfirmProvider>,
    )

    expect(await screen.findByText('No mutation history found.')).toBeVisible()
    expect(screen.queryByTitle(/Undo/)).not.toBeInTheDocument()
  })
})

describe('EmployeeSupportAssignmentsPanel mutations', () => {
  it('confirms end and drop with student-scoped payloads and refetches assignments', async () => {
    let assignmentReads = 0
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/employees/employee-1/support-assignments',
        response: () => {
          assignmentReads += 1
          return jsonResponse({ data: [activeSupportAssignment] })
        },
      },
      {
        path: '/api/admin/students/student-1/support-assignments/assignment-1/end',
        method: 'PATCH',
        response: jsonResponse({ data: activeSupportAssignment }),
      },
      {
        path: '/api/admin/students/student-1/support-assignments/delete/assignment-1',
        method: 'PATCH',
        response: jsonResponse({ data: activeSupportAssignment }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <EmployeeSupportAssignmentsPanel
          employeeId="employee-1"
          isTeachingRole
          canWrite
        />
      </ConfirmProvider>,
    )

    await screen.findByText('Ari Student')
    await user.click(screen.getByRole('button', { name: 'End assignment' }))
    const endDialog = screen.getByRole('dialog', { name: 'End assignment' })
    expect(endDialog).toHaveTextContent('Ari Student')
    await user.click(within(endDialog).getByRole('button', { name: 'End assignment' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/students/student-1/support-assignments/assignment-1/end') &&
      options.method === 'PATCH',
    )).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Drop assignment' }))
    const dropDialog = screen.getByRole('dialog', { name: 'Drop assignment' })
    expect(dropDialog).toHaveTextContent("won't be kept in this student's assignment history")
    await user.click(within(dropDialog).getByRole('button', { name: 'Drop assignment' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/students/student-1/support-assignments/delete/assignment-1') &&
      options.method === 'PATCH',
    )).toBe(true))
    await waitFor(() => expect(assignmentReads).toBeGreaterThanOrEqual(3))
  })

  it('reactivates an ended assignment', async () => {
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/employees/employee-1/support-assignments',
        response: jsonResponse({
          data: [{ ...activeSupportAssignment, end_date: '2026-09-10T00:00:00.000Z' }],
        }),
      },
      {
        path: '/api/admin/students/student-1/support-assignments/assignment-1/reactivate',
        method: 'PATCH',
        response: jsonResponse({ data: activeSupportAssignment }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <EmployeeSupportAssignmentsPanel employeeId="employee-1" isTeachingRole canWrite />
      </ConfirmProvider>,
    )

    await screen.findByText('Ari Student')
    await user.click(screen.getByRole('button', { name: 'Reactivate assignment' }))
    await user.click(screen.getByRole('button', { name: 'Reactivate' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/students/student-1/support-assignments/assignment-1/reactivate') &&
      options.method === 'PATCH',
    )).toBe(true))
  })
})
