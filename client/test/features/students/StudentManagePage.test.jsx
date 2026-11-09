import { expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentManagePage } from '../../../src/features/students/pages/StudentManagePage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { studentFixture, studentFormOptions, superAdminUser } from '../../fixtures/students.js'

it('loads student context and mounts the contacts management panel', async () => {
  globalThis.fetch = createFetchRouter([
    { path: '/api/admin/students/student-1', response: jsonResponse({ data: studentFixture() }) },
    { path: /^\/api\/admin\/grades/, response: jsonResponse({ data: studentFormOptions.grades }) },
    { path: /^\/api\/admin\/academic-years/, response: jsonResponse({ data: studentFormOptions.academicYears }) },
    { path: /^\/api\/admin\/classes/, response: jsonResponse({ data: [] }) },
    { path: '/api/admin/students/student-1/parents?is_deleted=false', response: jsonResponse({ data: [] }) },
  ])
  renderWithProviders(
    <AuthContext.Provider value={{ user: superAdminUser }}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={['/students/student-1/manage/contacts']}>
          <Routes>
            <Route path="/students/:studentId/manage/contacts" element={<StudentManagePage section="contacts" />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { withRouter: false },
  )

  expect(await screen.findByRole('heading', { level: 1, name: 'Manage Contacts' })).toBeVisible()
  expect(await screen.findByText('No parent or guardian records yet.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add Parent' })).toBeEnabled()
  expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/students/student-1?tab=family-consent')
})
