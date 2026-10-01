import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { TeacherAssignmentsSection } from '../../../src/features/academic/components/TeacherAssignmentsSection.jsx'
import { ClassDetailPage } from '../../../src/features/academic/pages/ClassDetailPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  academicYears,
  classFixture,
  enrollmentFixture,
  grades,
  paging,
  superAdminUser,
  teachingEmployees,
  viewerUser,
} from '../../fixtures/academic.js'

const activeAssignment = {
  id: 'assignment-1',
  role: 'HOMEROOM',
  subject: null,
  start_date: '2026-07-01T00:00:00.000Z',
  end_date: null,
  employee: {
    id: 'employee-home',
    employee_id: 'EMP-001',
    full_name: 'Hana Homeroom',
  },
}

function renderAcademic(ui, { user = superAdminUser } = {}) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </AuthContext.Provider>,
  )
}

function renderClassDetail(user = superAdminUser) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={['/academic/classes/class-1']}>
          <Routes>
            <Route path="/academic/classes/:classId" element={<ClassDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { withRouter: false },
  )
}

function classDetailRoutes({ klass = classFixture(), assignments = [activeAssignment] } = {}) {
  return [
    { path: '/api/admin/classes/class-1', response: jsonResponse({ data: klass }) },
    { path: '/api/admin/classes/class-1/teacher-assignments', response: jsonResponse({ data: assignments }) },
    { path: /^\/api\/admin\/enrollments\?.*class_id=class-1/, response: jsonResponse({ data: [enrollmentFixture()], paging }) },
    { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: jsonResponse({ data: grades }) },
    { path: /^\/api\/admin\/employees(?:\?.*)?$/, response: jsonResponse({ data: teachingEmployees, paging: { ...paging, total_item: teachingEmployees.length } }) },
    { path: /^\/api\/admin\/job-levels(?:\?.*)?$/, response: jsonResponse({ data: [{ id: 'level-1', name: 'Teacher', is_teaching_role: true }] }) },
    { path: /^\/api\/admin\/classes(?:\?.*)?$/, response: jsonResponse({ data: [klass] }) },
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears }) },
    { path: '/api/admin/support-assignments/caseload', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/support-assignments/active-student-ids?student_ids=student-1', response: jsonResponse({ data: [] }) },
  ]
}

describe('ClassDetailPage', () => {
  it('loads class, teacher, roster, and option data with permission-aware actions', async () => {
    const fetchMock = createFetchRouter(classDetailRoutes())
    globalThis.fetch = fetchMock
    const { queryClient } = renderClassDetail()

    expect(screen.getByRole('heading', { level: 1, name: 'Class Detail' })).toBeVisible()
    expect(await screen.findByRole('heading', { level: 1, name: 'Grade 1A' })).toBeVisible()
    expect(screen.getAllByText('Hana Homeroom')).not.toHaveLength(0)
    expect(screen.getAllByText('Ari Student')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Edit class' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Enroll student' })).toBeEnabled()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/enrollments?class_id=class-1'))).toBe(true)
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  })

  it('hides mutations for viewers and renders empty related sections', async () => {
    globalThis.fetch = createFetchRouter([
      ...classDetailRoutes({ assignments: [] }).filter((route) => !String(route.path).includes('enrollments')),
      { path: /^\/api\/admin\/enrollments\?.*class_id=class-1/, response: jsonResponse({ data: [], paging: { ...paging, total_item: 0 } }) },
    ])
    const { queryClient } = renderClassDetail(viewerUser)

    expect(await screen.findByRole('heading', { level: 1, name: 'Grade 1A' })).toBeVisible()
    expect(screen.getByText('No teacher assigned to this class yet.')).toBeVisible()
    expect(screen.getByText('No students enrolled in this class.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit class' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign teacher' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll student' })).not.toBeInTheDocument()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  })

  it('shows student summary without fetching identities for workforce-only access', async () => {
    const fetchMock = createFetchRouter(classDetailRoutes())
    globalThis.fetch = fetchMock
    renderClassDetail({
      ...superAdminUser,
      role: 'DATABASE_ADMIN',
      unit_id: 'unit-elementary',
      can_view_student_data: false,
      can_view_employee_data: true,
      can_manage_teacher_assignments: true,
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Grade 1A' })).toBeVisible()
    expect(screen.getByText((content) => content.includes('1 active student') && content.includes('enrolled'))).toBeVisible()
    expect(screen.getByText(/Student identities require Student access/)).toBeVisible()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/enrollments?'))).toBe(false)
  })

  it('shows restricted teacher summary without fetching workforce for student-only access', async () => {
    const fetchMock = createFetchRouter(classDetailRoutes())
    globalThis.fetch = fetchMock
    renderClassDetail({
      ...superAdminUser,
      role: 'VIEWER',
      unit_id: 'unit-elementary',
      can_view_student_data: true,
      can_view_employee_data: false,
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Grade 1A' })).toBeVisible()
    expect(screen.getByText(/Teacher identities are hidden/)).toBeVisible()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/teacher-assignments'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/employees'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/interns'))).toBe(false)
  })
})

describe('TeacherAssignmentsSection', () => {
  it('lists teacher candidates from the server by role and derives subject payloads', async () => {
    const onAssign = mock(() => {})
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/classes\/class-1\/teacher-candidates(?:\?.*)?$/,
        response: ({ url }) => {
          const subject = url.includes('role=SUBJECT_TEACHER')
          const data = subject
            ? teachingEmployees.filter((employee) => employee.id !== 'employee-home')
            : teachingEmployees
          return jsonResponse({ data, paging: { current_page: 1, total_page: 1, total_item: data.length, size: 10 } })
        },
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderAcademic(
      <TeacherAssignmentsSection
        assignments={[]}
        currentClassId="class-1"
        academicYearStartDate="2026-07-01T00:00:00.000Z"
        canWrite
        onAssign={onAssign}
        onEnd={() => {}}
        onRemove={() => {}}
        onReopen={() => {}}
        onBulkMove={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Assign teacher' }))
    const dialog = screen.getByRole('dialog', { name: 'Assign Teacher' })
    expect(within(dialog).getByRole('button', { name: 'Add assignment' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Homeroom' }))
    await user.click(screen.getByRole('option', { name: 'Subject Teacher' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('role=SUBJECT_TEACHER'))).toBe(true),
    )
    await user.click(await screen.findByRole('radio', { name: /Sari Science/ }))
    expect(within(dialog).getByPlaceholderText('e.g. Visual Arts')).toHaveValue('Science')
    await user.click(within(dialog).getByRole('button', { name: 'Add assignment' }))
    const confirmDialog = screen.getByRole('dialog', { name: 'Confirm teacher assignment' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Add assignment' }))

    expect(onAssign).toHaveBeenCalledWith(
      expect.objectContaining({
        employee_id: 'employee-science',
        role: 'SUBJECT_TEACHER',
        subject: 'Science',
        start_date: '2026-07-01T00:00:00.000Z',
      }),
    )
  })

  it('shows an intern candidate returned for the Subject Teacher role', async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/classes\/class-1\/teacher-candidates(?:\?.*)?$/,
        response: () => jsonResponse({
          data: [
            {
              id: 'intern-art',
              workforce_type: 'INTERN',
              identity: { full_name: 'Ari Art' },
              employment: { job_position: 'Art Teacher', unit: 'Elementary', is_teaching_position: true },
            },
          ],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
        }),
      },
    ])
    const { user } = renderAcademic(
      <TeacherAssignmentsSection
        assignments={[]}
        currentClassId="class-1"
        academicYearStartDate="2026-07-01T00:00:00.000Z"
        canWrite
        onAssign={() => {}}
        onEnd={() => {}}
        onRemove={() => {}}
        onReopen={() => {}}
        onBulkMove={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Assign teacher' }))
    const dialog = screen.getByRole('dialog', { name: 'Assign Teacher' })
    await user.click(within(dialog).getByRole('button', { name: 'Homeroom' }))
    await user.click(screen.getByRole('option', { name: 'Subject Teacher' }))
    expect(await screen.findByRole('radio', { name: /Ari Art \(Intern\)/ })).toBeVisible()
  })

  it('uses bulk selection for teacher assignment actions and next-year promotion', async () => {
    const endedAssignment = { ...activeAssignment, id: 'assignment-2', end_date: '2026-08-31T00:00:00.000Z' }
    const onBulkMove = mock(() => {})
    const targetClass = classFixture({
      id: 'class-2',
      name: 'Grade 1B',
      academic_year: {
        id: 'year-2027',
        name: '2027/2028',
        status: 'UPCOMING',
      },
    })
    // The promote window only opens within 30 days of the source academic
    // year's end - give this test's current class an end date inside that
    // window instead of the shared fixture's far-future one.
    const soonEndingAcademicYears = [
      { ...academicYears[0], end_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() },
      academicYears[1],
    ]
    const { user } = renderAcademic(
      <TeacherAssignmentsSection
        assignments={[activeAssignment, endedAssignment]}
        teachingEmployees={teachingEmployees}
        canWrite
        currentClassId="class-1"
        moveTargetClassOptions={[classFixture(), targetClass]}
        academicYears={soonEndingAcademicYears}
        onAssign={() => {}}
        onBulkMove={onBulkMove}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Assignment Actions' })).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('checkbox', { name: 'Select Hana Homeroom' })[0])
    await user.click(screen.getByRole('button', { name: 'Bulk Actions' }))
    await user.click(screen.getByRole('button', { name: 'Promote to Next Class' }))
    const moveDialog = screen.getByRole('dialog', { name: 'Promote Teachers to Next Class' })
    await user.click(within(moveDialog).getByRole('button', { name: 'Select Class' }))
    await user.click(screen.getByRole('option', { name: /Grade 1B/ }))
    await user.click(within(moveDialog).getByRole('button', { name: 'Promote' }))
    expect(onBulkMove).toHaveBeenCalledWith(['assignment-1'], 'class-2')
  })

  it('submits bulk end and bulk remove from the Bulk Actions menu', async () => {
    const onBulkEnd = mock(() => {})
    const onBulkRemove = mock(() => {})
    const { user } = renderAcademic(
      <TeacherAssignmentsSection
        assignments={[activeAssignment]}
        teachingEmployees={teachingEmployees}
        canWrite
        currentClassId="class-1"
        moveTargetClassOptions={[classFixture()]}
        academicYears={academicYears}
        onAssign={() => {}}
        onBulkMove={() => {}}
        onBulkEnd={onBulkEnd}
        onBulkRemove={onBulkRemove}
        onBulkReopen={() => {}}
      />,
    )

    await user.click(screen.getAllByRole('checkbox', { name: 'Select Hana Homeroom' })[0])
    await user.click(screen.getByRole('button', { name: 'Bulk Actions' }))
    await user.click(screen.getByRole('button', { name: 'End selected' }))
    const endDialog = screen.getByRole('dialog', { name: 'End Assignments' })
    expect(within(endDialog).getByText('1 assignment(s) will end on the selected date.')).toBeVisible()
    await user.click(within(endDialog).getByRole('button', { name: 'End' }))
    expect(onBulkEnd).toHaveBeenCalledWith(
      ['assignment-1'],
      `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
    )

    await user.click(screen.getAllByRole('checkbox', { name: 'Select Hana Homeroom' })[0])
    await user.click(screen.getByRole('button', { name: 'Bulk Actions' }))
    await user.click(screen.getByRole('button', { name: 'Remove selected' }))
    const removeDialog = screen.getByRole('dialog', { name: 'Remove assignments' })
    await user.click(within(removeDialog).getByRole('button', { name: 'Remove' }))
    expect(onBulkRemove).toHaveBeenCalledWith(['assignment-1'])
  })

  it('submits bulk reopen from the Bulk Actions menu', async () => {
    const onBulkReopen = mock(() => {})
    const endedAssignment = { ...activeAssignment, end_date: '2026-08-01T00:00:00.000Z' }
    const { user } = renderAcademic(
      <TeacherAssignmentsSection
        assignments={[endedAssignment]}
        teachingEmployees={teachingEmployees}
        canWrite
        currentClassId="class-1"
        moveTargetClassOptions={[classFixture()]}
        academicYears={academicYears}
        onAssign={() => {}}
        onBulkMove={() => {}}
        onBulkEnd={() => {}}
        onBulkRemove={() => {}}
        onBulkReopen={onBulkReopen}
      />,
    )

    await user.click(screen.getAllByRole('checkbox', { name: 'Select Hana Homeroom' })[0])
    await user.click(screen.getByRole('button', { name: 'Bulk Actions' }))
    await user.click(screen.getByRole('button', { name: 'Reopen selected' }))
    const reopenDialog = screen.getByRole('dialog', { name: 'Reopen assignments' })
    await user.click(within(reopenDialog).getByRole('button', { name: 'Reopen' }))
    expect(onBulkReopen).toHaveBeenCalledWith(['assignment-1'])
  })
})
