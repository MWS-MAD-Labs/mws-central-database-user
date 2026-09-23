import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { EnrollmentDialog } from '../../../src/features/academic/components/EnrollmentDialog.jsx'
import { EnrollmentsPanel } from '../../../src/features/academic/components/EnrollmentsPanel.jsx'
import { EnrollmentHistoryPanel } from '../../../src/features/academic/components/EnrollmentHistoryPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  academicYears,
  classFixture,
  enrollmentFixture,
  grades,
  paging,
  studentCandidate,
  superAdminUser,
} from '../../fixtures/academic.js'

const options = {
  classes: [classFixture()],
  grades,
  academicYears,
  specialEducationTeachers: [],
  unitIdByGradeId: new Map(grades.map((grade) => [grade.id, grade.unit_id])),
}

function renderAcademic(ui) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user: superAdminUser }}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </AuthContext.Provider>,
  )
}

function optionRoutes(enrollments = [enrollmentFixture()]) {
  return [
    { path: /^\/api\/admin\/enrollments(?:\?.*)?$/, response: () => jsonResponse({ data: enrollments, paging }) },
    { path: /^\/api\/admin\/classes(?:\?.*)?$/, response: () => jsonResponse({ data: options.classes }) },
    { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: () => jsonResponse({ data: grades }) },
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: () => jsonResponse({ data: academicYears }) },
    { path: /^\/api\/admin\/employees(?:\?.*)?$/, response: () => jsonResponse({ data: [], paging: { ...paging, total_item: 0 } }) },
    { path: /^\/api\/admin\/interns(?:\?.*)?$/, response: () => jsonResponse({ data: [], paging: { ...paging, total_item: 0 } }) },
    { path: '/api/admin/support-assignments/caseload', response: () => jsonResponse({ data: [] }) },
  ]
}

describe('EnrollmentDialog', () => {
  it('validates create requirements and submits selected students after confirmation', async () => {
    const fetchMock = createFetchRouter([
      { path: /^\/api\/admin\/students(?:\?.*)?$/, response: () => jsonResponse({ data: [studentCandidate], paging }) },
      { path: '/api/admin/enrollments/preview-backfill', method: 'POST', response: jsonResponse({ data: [] }) },
    ])
    globalThis.fetch = fetchMock
    let submitted
    const { user } = renderAcademic(
      <EnrollmentDialog
        dialog={{ mode: 'create' }}
        options={options}
        isSubmitting={false}
        onClose={() => {}}
        onSubmit={(value) => { submitted = value }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Class is required.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Select Class' }))
    await user.click(screen.getByRole('option', { name: /Grade 1A/ }))
    expect(await screen.findByText('Bela Student')).toBeVisible()
    await user.click(screen.getByText('Bela Student'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Enroll 1 student into Grade 1A?' })
    await user.click(within(confirm).getByRole('button', { name: 'Enroll' }))

    expect(submitted).toMatchObject({
      studentId: 'student-2',
      studentIds: ['student-2'],
      payload: {
        class_id: 'class-1',
        academic_year_id: 'year-2026',
        start_date: '2026-07-01T00:00:00.000Z',
      },
    })
  })

  it('submits transfer and close payloads', async () => {
    const targetClass = classFixture({ id: 'class-2', name: 'Grade 1B' })
    let submitted
    const enrollment = enrollmentFixture()
    const { user, unmount } = renderAcademic(
      <EnrollmentDialog
        dialog={{ mode: 'transfer', record: enrollment }}
        options={{ ...options, classes: [options.classes[0], targetClass] }}
        isSubmitting={false}
        onClose={() => {}}
        onSubmit={(value) => { submitted = value }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Select Class' }))
    await user.click(screen.getByRole('option', { name: /Grade 1B/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(submitted).toEqual({ class_id: 'class-2' })
    unmount()

    submitted = undefined
    const close = renderAcademic(
      <EnrollmentDialog
        dialog={{ mode: 'close', record: enrollment }}
        options={options}
        isSubmitting={false}
        onClose={() => {}}
        onSubmit={(value) => { submitted = value }}
      />,
    )
    await close.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(submitted).toMatchObject({ status: 'TRANSFERRED' })
  })
})

describe('EnrollmentsPanel', () => {
  it('moves an enrollment and sends the selected target class', async () => {
    const targetClass = classFixture({ id: 'class-2', name: 'Grade 1B' })
    const fetchMock = createFetchRouter([
      ...optionRoutes(),
      { path: '/api/admin/students/student-1/enrollments/enrollment-1/transfer', method: 'PATCH', response: jsonResponse({ data: enrollmentFixture({ class: { id: 'class-2', name: 'Grade 1B' } }) }) },
    ].map((route) => route.path instanceof RegExp && String(route.path).includes('classes')
      ? { ...route, response: jsonResponse({ data: [classFixture(), targetClass] }) }
      : route))
    globalThis.fetch = fetchMock
    const { user } = renderAcademic(<EnrollmentsPanel />)
    await screen.findByText('Ari Student')

    await user.click(screen.getByRole('button', { name: 'Move' }))
    await user.click(screen.getByRole('button', { name: 'Select Class' }))
    await user.click(screen.getByRole('option', { name: /Grade 1B/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, request]) =>
      url === '/api/admin/students/student-1/enrollments/enrollment-1/transfer' &&
      JSON.parse(request.body).class_id === 'class-2',
    )).toBe(true))
  })

  it('confirms removal and restores records from trash', async () => {
    const fetchMock = createFetchRouter([
      ...optionRoutes(),
      { path: '/api/admin/students/student-1/enrollments/delete/enrollment-1', method: 'PATCH', response: jsonResponse({ data: {} }) },
      { path: '/api/admin/students/student-1/enrollments/restore/enrollment-1', method: 'PATCH', response: jsonResponse({ data: {} }) },
    ])
    globalThis.fetch = fetchMock
    const { user, unmount } = renderAcademic(<EnrollmentsPanel />)
    await screen.findByText('Ari Student')

    const deleteButtons = screen.getAllByRole('button').filter((button) => button.querySelector('svg') && button.textContent === '')
    await user.click(deleteButtons.at(-1))
    const confirm = screen.getByRole('dialog', { name: 'Move to trash' })
    await user.click(within(confirm).getByRole('button', { name: 'Move to trash' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      url === '/api/admin/students/student-1/enrollments/delete/enrollment-1',
    )).toBe(true))

    unmount()
  })

  it('restores a deleted enrollment from the trash filter', async () => {
    const fetchMock = createFetchRouter([
      ...optionRoutes([enrollmentFixture({ is_deleted: true })]),
      { path: '/api/admin/students/student-1/enrollments/restore/enrollment-1', method: 'PATCH', response: jsonResponse({ data: {} }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderAcademic(<EnrollmentsPanel />)
    await screen.findByText('Ari Student')

    await user.click(screen.getByRole('button', { name: 'Active Records' }))
    await user.click(screen.getByRole('option', { name: 'Trash bin' }))
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      url === '/api/admin/students/student-1/enrollments/restore/enrollment-1',
    )).toBe(true))
  })
})

describe('EnrollmentHistoryPanel', () => {
  it('renders loading, history links, placeholder warnings, and empty state', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const history = enrollmentFixture({
      enrollment_status: 'COMPLETED',
      class: { id: 'legacy-class', name: 'Unknown (Legacy Import) Grade 1' },
      end_date: '2027-06-30T00:00:00.000Z',
    })
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/students/student-1/enrollments', response: async () => { await pending; return jsonResponse({ data: [history] }) } },
    ])
    const { unmount } = renderAcademic(<EnrollmentHistoryPanel studentId="student-1" />)
    expect(screen.getByText('Loading class history...')).toBeVisible()
    release()
    const link = await screen.findByRole('link', { name: 'Unknown (Legacy Import) Grade 1' })
    expect(link).toHaveAttribute('href', '/academic/classes/legacy-class')
    expect(link).toHaveAttribute('title', expect.stringContaining('Placeholder class'))
    unmount()

    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/students/student-1/enrollments', response: jsonResponse({ data: [] }) },
    ])
    renderAcademic(<EnrollmentHistoryPanel studentId="student-1" />)
    expect(await screen.findByText('No class history found.')).toBeVisible()
  })
})
