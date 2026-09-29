import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { EmployeePcActivityMentorshipsPanel } from '../../../src/features/employees/components/EmployeePcActivityMentorshipsPanel.jsx'
import { EmployeeSupportAssignmentsPanel } from '../../../src/features/employees/components/EmployeeSupportAssignmentsPanel.jsx'
import { EmployeeTeachingAssignmentsPanel } from '../../../src/features/employees/components/EmployeeTeachingAssignmentsPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const relationRoutes = ({ teaching = [], support = [], mentorships = [] } = {}) => [
  {
    path: '/api/admin/employees/employee-1/teaching-assignments',
    response: jsonResponse({ data: teaching }),
  },
  {
    path: '/api/admin/employees/employee-1/support-assignments',
    response: jsonResponse({ data: support }),
  },
  {
    path: '/api/admin/employees/employee-1/pc-activity-mentorships',
    response: jsonResponse({ data: mentorships }),
  },
]

function renderPanels({ isTeachingRole = true, canWrite = true } = {}) {
  return renderWithProviders(
    <ConfirmProvider>
      <EmployeeTeachingAssignmentsPanel
        employeeId="employee-1"
        isTeachingRole={isTeachingRole}
      />
      <EmployeeSupportAssignmentsPanel
        employeeId="employee-1"
        isTeachingRole={isTeachingRole}
        canWrite={canWrite}
      />
      <EmployeePcActivityMentorshipsPanel
        employeeId="employee-1"
        isTeachingRole={isTeachingRole}
      />
    </ConfirmProvider>,
  )
}

describe('employee relation panels', () => {
  it('renders loading states while relation requests are pending', () => {
    globalThis.fetch = createFetchRouter([
      {
        path: '/api/admin/employees/employee-1/teaching-assignments',
        response: new Promise(() => {}),
      },
      {
        path: '/api/admin/employees/employee-1/support-assignments',
        response: new Promise(() => {}),
      },
      {
        path: '/api/admin/employees/employee-1/pc-activity-mentorships',
        response: new Promise(() => {}),
      },
    ])

    renderPanels()

    expect(screen.getByText('Loading teaching assignments...')).toBeVisible()
    expect(screen.getByText('Loading support assignments...')).toBeVisible()
    expect(screen.getByText('Loading PC activity mentorships...')).toBeVisible()
  })

  it('shows teaching-role empty states and hides irrelevant empty panels', async () => {
    globalThis.fetch = createFetchRouter(relationRoutes())
    const { unmount } = renderPanels()

    expect(await screen.findByText('No teaching assignments found.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Student Support Assignments' })).toBeVisible()
    expect(screen.getByText('No PC Activity room mentorships.')).toBeVisible()
    unmount()

    const fetchMock = createFetchRouter(relationRoutes())
    globalThis.fetch = fetchMock
    renderPanels({ isTeachingRole: false })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Teaching Assignments' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Student Support Assignments' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'PC Activity Room History' })).not.toBeInTheDocument()
    })
  })

  it('renders assignment links and room mentorship rows', async () => {
    globalThis.fetch = createFetchRouter(relationRoutes({
      teaching: [{
        id: 'teaching-1',
        academic_year: { name: '2026/2027' },
        class: { id: 'class-1', name: 'Grade 6A' },
        grade: 'Grade 6',
        role: 'SUBJECT_TEACHER',
        subject: 'Science',
        start_date: '2026-07-01T00:00:00.000Z',
        end_date: null,
      }],
      support: [{
        id: 'support-1',
        role: 'SPECIAL_ED',
        start_date: '2026-07-01T00:00:00.000Z',
        end_date: null,
        student: { id: 'student-1', full_name: 'Ari Student', nis: 'NIS-1' },
      }],
      mentorships: [
        {
          id: 'mentor-1', room_id: 'room-1', room_name: 'Reading Club',
          activity_name: 'Reading Club', academic_year_name: '2026/2027',
          day: 'MONDAY',
          start_date: '2026-07-01T10:00:00.000Z', end_date: null,
        },
        {
          id: 'mentor-2', room_id: 'room-2', room_name: 'Chess Club',
          activity_name: 'Chess Club', academic_year_name: '2026/2027',
          day: 'TUESDAY',
          start_date: '2026-07-01T10:00:10.000Z', end_date: null,
        },
      ],
    }))

    renderPanels({ canWrite: false })

    expect(await screen.findByRole('link', { name: 'Grade 6A' })).toHaveAttribute(
      'href',
      '/academic/classes/class-1',
    )
    expect(screen.getByText('Science')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ari Student' })).toHaveAttribute(
      'href',
      '/students/student-1',
    )
    expect(screen.getByRole('link', { name: 'Reading Club' })).toHaveAttribute(
      'href',
      '/academic?tab=pc-activity-rooms&search=Reading%20Club',
    )
    expect(screen.getByRole('link', { name: 'Chess Club' })).toBeVisible()
    expect(screen.getByText('MONDAY / 2026/2027')).toBeVisible()
    expect(screen.getByText('TUESDAY / 2026/2027')).toBeVisible()
    expect(screen.getByRole('button', { name: 'End assignment' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Drop assignment' })).toBeDisabled()
  })
})
