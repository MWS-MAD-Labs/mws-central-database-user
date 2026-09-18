import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentsPage } from '../../../src/features/students/pages/StudentsPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  elementaryDatabaseAdmin,
  studentFormOptions,
  studentListItem,
  superAdminUser,
} from '../../fixtures/students.js'

function listPayload(students = [studentListItem()]) {
  return {
    data: students,
    paging: { current_page: 1, total_page: 1, total_item: students.length, size: 10 },
  }
}

function pageRoutes({ students = [studentListItem()], bulkResult } = {}) {
  return [
    {
      path: /^\/api\/admin\/students(?:\?.*)?$/,
      response: ({ method }) => method === 'GET'
        ? jsonResponse(listPayload(students))
        : jsonResponse({ data: { id: 'student-new' } }),
    },
    { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: jsonResponse({ data: studentFormOptions.grades, paging: {} }) },
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: studentFormOptions.academicYears, paging: {} }) },
    {
      path: /^\/api\/admin\/classes(?:\?.*)?$/,
      response: jsonResponse({
        data: [{ id: 'class-1', name: 'Grade 1A', grade: { name: 'Grade 1' }, academic_year: { name: '2026/2027' } }],
        paging: {},
      }),
    },
    {
      path: '/api/admin/students/bulk/deactivate',
      method: 'PATCH',
      response: jsonResponse({ data: bulkResult || { success_count: 1, failed_count: 0, items: [] } }),
    },
  ]
}

function renderPage({ user = superAdminUser, route = '/students', routes = pageRoutes() } = {}) {
  globalThis.fetch = createFetchRouter(routes)
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <StudentsPage />
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route },
  )
}

describe('StudentsPage', () => {
  it('loads students and options into the list controls', async () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Students' })).toBeVisible()
    expect(await screen.findByText('Ari Student')).toBeVisible()
    expect(screen.getByText('Live')).toBeVisible()
    expect(screen.getByRole('link', { name: /New Student/ })).toHaveAttribute('href', '/students/new')
    expect(screen.getByRole('button', { name: 'Bulk Photo Upload' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })

  it('renders loading and empty states', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/students(?:\?.*)?$/,
        response: async () => {
          await pending
          return jsonResponse(listPayload([]))
        },
      },
      ...pageRoutes({ students: [] }).slice(1),
    ])
    renderWithProviders(
      <AuthContext.Provider value={{ user: superAdminUser }}>
        <ConfirmProvider><StudentsPage /></ConfirmProvider>
      </AuthContext.Provider>,
      { route: '/students' },
    )

    expect(screen.getByText('Preparing student records...')).toBeVisible()
    await act(async () => release())
    expect(await screen.findByText('No students are ready to review.')).toBeVisible()
  })

  it('applies search and filter values through the URL', async () => {
    const fetchMock = createFetchRouter(pageRoutes())
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: superAdminUser }}>
        <ConfirmProvider><StudentsPage /></ConfirmProvider>
      </AuthContext.Provider>,
      { route: '/students' },
    )
    await screen.findByText('Ari Student')

    await user.type(screen.getByPlaceholderText('Search Name, Email, NIS, Or NISN'), 'Ari')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('search=Ari'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Active' }))
    await user.click(screen.getByRole('option', { name: 'Inactive' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('status=INACTIVE'))).toBe(true))
  })

  it('hides privileged actions for a read-only database admin', async () => {
    renderPage({
      user: { ...elementaryDatabaseAdmin, can_write_student_data: false, can_view_sensitive_data: false },
    })
    await screen.findByText('Ari Student')

    expect(screen.getByRole('button', { name: /New Student/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Bulk Photo Upload' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select All Students' })).not.toBeInTheDocument()
  })

  it('confirms and submits a bulk deactivate action', async () => {
    const fetchMock = createFetchRouter(pageRoutes())
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: superAdminUser }}>
        <ConfirmProvider><StudentsPage /></ConfirmProvider>
      </AuthContext.Provider>,
      { route: '/students' },
    )
    await screen.findByText('Ari Student')

    await user.click(screen.getByRole('checkbox', { name: 'Select Ari Student' }))
    await user.click(screen.getByRole('button', { name: 'Bulk Actions' }))
    await user.click(screen.getByRole('button', { name: /Deactivate selected/ }))
    expect(screen.getByRole('dialog', { name: 'Deactivate students' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/students/bulk/deactivate' && options.method === 'PATCH',
    )).toBe(true))
  })

  it('opens and closes the bulk photo dialog', async () => {
    const { user } = renderPage()
    await screen.findByText('Ari Student')

    await user.click(screen.getByRole('button', { name: 'Bulk Photo Upload' }))
    expect(screen.getByRole('dialog', { name: 'Bulk Photo Upload' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close Dialog' }))
    expect(screen.queryByRole('dialog', { name: 'Bulk Photo Upload' })).not.toBeInTheDocument()
  })
})
