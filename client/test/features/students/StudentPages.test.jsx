import { describe, expect, it } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentCreatePage } from '../../../src/features/students/pages/StudentCreatePage.jsx'
import { StudentEditPage } from '../../../src/features/students/pages/StudentEditPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { studentFixture, studentFormOptions, superAdminUser } from '../../fixtures/students.js'

function optionsRoutes(status = 200) {
  return [
    { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: jsonResponse({ data: studentFormOptions.grades }, status) },
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: studentFormOptions.academicYears }, status) },
    { path: /^\/api\/admin\/classes(?:\?.*)?$/, response: jsonResponse({ data: [] }, status) },
  ]
}

function renderRoute(element, route, path) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user: superAdminUser }}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={element} />
            <Route path="/students/:studentId" element={<p>Student destination</p>} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { withRouter: false },
  )
}

describe('Student create and edit pages', () => {
  it('renders create loading and options error states', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    globalThis.fetch = createFetchRouter([
      ...optionsRoutes().map((route) => ({ ...route, response: async () => { await pending; return route.response } })),
    ])
    renderRoute(<StudentCreatePage />, '/students/new', '/students/new')
    expect(screen.getByText('Loading student form options...')).toBeVisible()
    release()
    expect(await screen.findByRole('button', { name: 'Create student' })).toBeVisible()

    globalThis.fetch = createFetchRouter(optionsRoutes(503))
    renderRoute(<StudentCreatePage />, '/students/new', '/students/new')
    expect(await screen.findByText('Student form options are unavailable.')).toBeVisible()
  })

  it('creates a student and navigates to its detail page', async () => {
    const fetchMock = createFetchRouter([
      ...optionsRoutes(),
      {
        path: '/api/admin/students',
        method: 'POST',
        response: jsonResponse({ data: { id: 'student-new' } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderRoute(<StudentCreatePage />, '/students/new', '/students/new')
    await screen.findByRole('button', { name: 'Create student' })

    const fields = (name) => document.querySelector(`[data-field="${name}"]`)
    await user.type(fields('full_name').querySelector('input'), 'ari student')
    await user.type(fields('nick_name').querySelector('input'), 'ari')
    await user.type(fields('email_local').querySelector('input'), 'ari.student')
    await user.click(screen.getByRole('button', { name: 'Select Gender' }))
    await user.click(screen.getByRole('option', { name: 'Male' }))
    await user.click(screen.getByRole('button', { name: 'Select Religion' }))
    await user.click(screen.getByRole('option', { name: 'Islam' }))
    await user.type(fields('birth_place').querySelector('input'), 'jakarta')
    await user.click(screen.getByRole('button', { name: 'Select Current Grade' }))
    await user.click(screen.getByRole('option', { name: 'Grade 1' }))
    await user.click(screen.getByRole('button', { name: 'Select Join Year' }))
    await user.click(screen.getByRole('option', { name: '2025/2026' }))
    await user.click(screen.getByRole('button', { name: 'Select Join Grade' }))
    await user.click(screen.getByRole('option', { name: 'Grade 1' }))

    const birthDate = fields('birth_date')
    await user.click(birthDate.querySelector('button'))
    await user.click(await screen.findByRole('gridcell', { name: '10' }))
    await user.click(screen.getByRole('button', { name: 'OK' }))
    fireEvent.submit(document.querySelector('form'))

    expect(await screen.findByText('Student destination')).toBeVisible()
    expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/students' && options.method === 'POST',
    )).toBe(true)
  })

  it('loads and updates an existing student', async () => {
    const fetchMock = createFetchRouter([
      ...optionsRoutes(),
      { path: '/api/admin/students/student-1', response: ({ method }) => method === 'PATCH'
        ? jsonResponse({ data: { id: 'student-1' } })
        : jsonResponse({ data: studentFixture() }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderRoute(<StudentEditPage />, '/students/student-1/edit', '/students/:studentId/edit')

    expect(screen.getByText('Loading student...')).toBeVisible()
    const name = await screen.findByDisplayValue('Ari Student')
    await user.clear(name)
    await user.type(name, 'Ari Updated')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Student destination')).toBeVisible()
    const patch = fetchMock.mock.calls.find(([url, options]) =>
      url === '/api/admin/students/student-1' && options.method === 'PATCH',
    )
    expect(JSON.parse(patch[1].body).full_name).toBe('Ari Updated')
  })

  it('renders edit error state when student data fails', async () => {
    globalThis.fetch = createFetchRouter([
      ...optionsRoutes(),
      { path: '/api/admin/students/student-1', response: jsonResponse({ message: 'Unavailable' }, 503) },
    ])
    renderRoute(<StudentEditPage />, '/students/student-1/edit', '/students/:studentId/edit')
    expect(await screen.findByText('Student data is unavailable.')).toBeVisible()
  })
})
