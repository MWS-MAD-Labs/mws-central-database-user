import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentDetailPage } from '../../../src/features/students/pages/StudentDetailPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  elementaryDatabaseAdmin,
  studentFixture,
  studentFormOptions,
  superAdminUser,
} from '../../fixtures/students.js'

function detailRoutes({ student = studentFixture(), status = 200 } = {}) {
  return [
    {
      path: '/api/admin/students/student-1',
      response: ({ method }) => method === 'GET'
        ? jsonResponse(status === 200 ? { data: student } : { message: 'Unavailable' }, status)
        : jsonResponse({ data: student }),
    },
    { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: jsonResponse({ data: studentFormOptions.grades }) },
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: studentFormOptions.academicYears }) },
    { path: /^\/api\/admin\/classes(?:\?.*)?$/, response: jsonResponse({ data: [] }) },
    { path: '/api/admin/students/student-1/enrollments', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/students/student-1/mutation-history', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/students/student-1/parents?is_deleted=false', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/students/student-1/pc-activities?is_deleted=false', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/students/student-1/support-assignments', response: jsonResponse({ data: [] }) },
    { path: /^\/api\/admin\/employees(?:\?.*)?$/, response: jsonResponse({ data: [], paging: { total_page: 1 } }) },
    { path: '/api/admin/support-assignments/caseload', response: jsonResponse({ data: [] }) },
    { path: '/api/admin/students/student-1/deactivate', method: 'PATCH', response: jsonResponse({ data: { id: 'student-1', status: 'INACTIVE' } }) },
  ]
}

function renderDetail({ user = superAdminUser, routes = detailRoutes() } = {}) {
  const fetchMock = createFetchRouter(routes)
  globalThis.fetch = fetchMock
  return { ...renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={['/students/student-1']}>
          <Routes>
            <Route path="/students/:studentId" element={<StudentDetailPage />} />
            <Route path="/students" element={<p>Student list destination</p>} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { withRouter: false },
  ), fetchMock }
}

describe('StudentDetailPage', () => {
  it('renders loading, student identity, actions, and privacy gates', async () => {
    renderDetail()
    expect(screen.getByText('Loading student...')).toBeVisible()

    expect(await screen.findByRole('heading', { level: 1, name: 'Ari Student' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/students/student-1/edit')
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Change Photo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Show Health & Special Needs' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Show Vaccine Records' })).toBeVisible()
    expect(await screen.findByText('No mutation history found.')).toBeVisible()
  })

  it('renders a non-disclosing error state', async () => {
    renderDetail({ routes: detailRoutes({ status: 503 }) })
    expect(await screen.findByText('Student data is unavailable.')).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: 'Ari Student' })).not.toBeInTheDocument()
  })

  it('keeps an out-of-unit database admin read-only and hides sensitive panels', async () => {
    renderDetail({
      user: {
        ...elementaryDatabaseAdmin,
        can_write_student_data: true,
        can_view_sensitive_data: false,
      },
      routes: detailRoutes({
        student: studentFixture({ academic: { current_grade: 'Grade 7' } }),
      }),
    })
    await screen.findByRole('heading', { level: 1, name: 'Ari Student' })

    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change Photo' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/Restricted/).length).toBeGreaterThanOrEqual(2)
  })

  it('confirms and submits deactivation', async () => {
    const { user, fetchMock } = renderDetail()
    await screen.findByRole('heading', { level: 1, name: 'Ari Student' })

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    const dialog = screen.getByRole('dialog', { name: 'Deactivate student' })
    expect(dialog).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/students/student-1/deactivate' && options.method === 'PATCH',
    )).toBe(true))
    await act(async () => { await Promise.resolve() })
  })
})
