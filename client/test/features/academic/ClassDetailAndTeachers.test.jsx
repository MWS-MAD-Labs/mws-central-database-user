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
})

describe('TeacherAssignmentsSection', () => {
  it('filters teacher choices by role and derives subject payloads', async () => {
    const onAssign = mock(() => {})
    const { user } = renderAcademic(
      <TeacherAssignmentsSection
        assignments={[]}
        teachingEmployees={teachingEmployees}
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
    await user.click(within(dialog).getByRole('button', { name: 'Select Teacher' }))
    expect(screen.queryByRole('option', { name: /Hana Homeroom/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Sari Science/ }))
    expect(within(dialog).getByRole('textbox')).toHaveValue('Science')
    await user.click(within(dialog).getByRole('button', { name: 'Add assignment' }))

    expect(onAssign).toHaveBeenCalledWith({
      employee_id: 'employee-science',
      role: 'SUBJECT_TEACHER',
      subject: 'Science',
    })
  })

  it('submits end, remove, reopen, and bulk move actions', async () => {
    const endedAssignment = { ...activeAssignment, id: 'assignment-2', end_date: '2026-08-31T00:00:00.000Z' }
    const onEnd = mock(() => {})
    const onRemove = mock(() => {})
    const onReopen = mock(() => {})
    const onBulkMove = mock(() => {})
    const targetClass = classFixture({ id: 'class-2', name: 'Grade 1B' })
    const { user } = renderAcademic(
      <TeacherAssignmentsSection
        assignments={[activeAssignment, endedAssignment]}
        teachingEmployees={teachingEmployees}
        canWrite
        currentClassId="class-1"
        moveTargetClassOptions={[classFixture(), targetClass]}
        onAssign={() => {}}
        onEnd={onEnd}
        onRemove={onRemove}
        onReopen={onReopen}
        onBulkMove={onBulkMove}
      />,
    )

    const actionButtons = screen.getAllByRole('button', { name: 'Assignment Actions' })
    await user.click(actionButtons[0])
    await user.click(screen.getByRole('button', { name: 'End' }))
    const endDialog = screen.getByRole('dialog', { name: 'End Assignment' })
    await user.click(within(endDialog).getByRole('button', { name: 'End' }))
    expect(onEnd).toHaveBeenCalledWith('assignment-1', '2026-09-18T00:00:00.000Z')

    await user.click(screen.getAllByRole('button', { name: 'Assignment Actions' })[0])
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const removeDialog = screen.getByRole('dialog', { name: 'Remove assignment' })
    await user.click(within(removeDialog).getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith('assignment-1')

    await user.click(screen.getAllByRole('button', { name: 'Assignment Actions' })[1])
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    const reopenDialog = screen.getByRole('dialog', { name: 'Reopen assignment' })
    await user.click(within(reopenDialog).getByRole('button', { name: 'Reopen' }))
    expect(onReopen).toHaveBeenCalledWith('assignment-2')

    await user.click(screen.getAllByRole('checkbox', { name: 'Select Hana Homeroom' })[0])
    await user.click(screen.getByRole('button', { name: 'Move to Class' }))
    const moveDialog = screen.getByRole('dialog', { name: 'Move to Class' })
    await user.click(within(moveDialog).getByRole('button', { name: 'Select Class' }))
    await user.click(screen.getByRole('option', { name: /Grade 1B/ }))
    await user.click(within(moveDialog).getByRole('button', { name: 'Move' }))
    expect(onBulkMove).toHaveBeenCalledWith(['assignment-1'], 'class-2')
  })
})
