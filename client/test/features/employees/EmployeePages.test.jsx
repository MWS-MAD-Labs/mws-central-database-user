import { describe, expect, it, spyOn } from 'bun:test'
import toast from 'react-hot-toast'
import { fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { EmployeeCreatePage } from '../../../src/features/employees/pages/EmployeeCreatePage.jsx'
import { EmployeeEditPage } from '../../../src/features/employees/pages/EmployeeEditPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  employeeFixture,
  employeeFormOptions,
  superAdminUser,
} from '../../fixtures/employees.js'

function formOptionRoutes(status = 200) {
  return [
    { path: /^\/api\/admin\/units(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.units }, status) },
    { path: /^\/api\/admin\/job-positions(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.jobPositions }, status) },
    { path: /^\/api\/admin\/job-levels(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.jobLevels }, status) },
    { path: /^\/api\/admin\/buildings(?:\?.*)?$/, response: jsonResponse({ data: employeeFormOptions.buildings }, status) },
  ]
}

function formSuggestionRoutes() {
  return [
    { path: '/api/admin/employees/education-suggestions', response: jsonResponse({ data: { institution_names: [], majors: [] } }) },
    { path: /^\/api\/admin\/institutions(?:\?.*)?$/, response: jsonResponse({ data: [] }) },
    { path: /^\/api\/admin\/majors(?:\?.*)?$/, response: jsonResponse({ data: [] }) },
  ]
}

function renderRoute(element, route, path) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user: superAdminUser }}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={element} />
            <Route path="/employees/:employeeId" element={<p>Employee destination</p>} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { withRouter: false },
  )
}

describe('Employee create and edit pages', () => {
  it('renders create loading and options error states', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    globalThis.fetch = createFetchRouter(formOptionRoutes().map((route) => ({
      ...route,
      response: async () => { await pending; return route.response },
    })))
    renderRoute(<EmployeeCreatePage />, '/employees/new', '/employees/new')
    expect(screen.getByText('Loading employee form options...')).toBeVisible()
    release()
    expect(await screen.findByRole('button', { name: 'Create employee' })).toBeVisible()

    globalThis.fetch = createFetchRouter(formOptionRoutes(503))
    renderRoute(<EmployeeCreatePage />, '/employees/new', '/employees/new')
    expect(await screen.findByText('Employee form options are unavailable.')).toBeVisible()
  })

  it('creates an employee and navigates to its detail page', async () => {
    const fetchMock = createFetchRouter([
      ...formOptionRoutes(),
      ...formSuggestionRoutes(),
      { path: '/api/admin/employees', method: 'POST', response: jsonResponse({ data: { id: 'employee-new' } }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderRoute(<EmployeeCreatePage />, '/employees/new', '/employees/new')
    await screen.findByRole('button', { name: 'Create employee' })

    const field = (name) => document.querySelector(`[data-field="${name}"]`)
    await user.type(field('full_name').querySelector('input'), 'ari employee')
    await user.type(field('nick_name').querySelector('input'), 'ari')
    await user.type(field('email_local').querySelector('input'), 'ari.employee')
    await user.click(screen.getByRole('button', { name: 'Select Gender' }))
    await user.click(screen.getByRole('option', { name: 'Male' }))
    await user.click(screen.getByRole('button', { name: 'Select Religion' }))
    await user.click(screen.getByRole('option', { name: 'Islam' }))
    await user.type(field('birth_place').querySelector('input'), 'jakarta')
    fireEvent.change(field('birth_date').querySelector('input'), { target: { value: '10/05/1990' } })
    await user.type(field('employee_id').querySelector('input'), '1234567')
    await user.click(screen.getByRole('button', { name: 'Select unit' }))
    await user.click(screen.getByRole('option', { name: 'Elementary' }))
    await user.click(screen.getByRole('button', { name: 'Select level' }))
    await user.click(screen.getByRole('option', { name: 'Staff' }))
    await user.click(screen.getByRole('button', { name: 'Select position' }))
    await user.click(screen.getByRole('option', { name: 'Administrator' }))
    await user.click(screen.getByRole('button', { name: 'Select building' }))
    await user.click(screen.getByRole('option', { name: 'Main Building' }))
    fireEvent.change(field('join_date').querySelector('input'), { target: { value: '01/07/2020' } })
    fireEvent.change(field('contract_end_date').querySelector('input'), { target: { value: '01/07/2027' } })
    fireEvent.submit(document.querySelector('form'))

    const review = await screen.findByRole('dialog', { name: 'Review before creating' })
    await user.click(within(review).getByRole('button', { name: 'Create employee' }))

    expect(await screen.findByText('Employee destination')).toBeVisible()
    const post = fetchMock.mock.calls.find(([url, options]) =>
      url === '/api/admin/employees' && options.method === 'POST')
    expect(JSON.parse(post[1].body).full_name).toBe('Ari Employee')
  })

  it('loads, updates, and navigates from an existing employee', async () => {
    const fetchMock = createFetchRouter([
      ...formOptionRoutes(),
      ...formSuggestionRoutes(),
      { path: '/api/admin/employees/employee-1/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: {} }) },
      {
        path: '/api/admin/employees/employee-1',
        response: ({ method }) => method === 'PATCH'
          ? jsonResponse({ data: { id: 'employee-1' } })
          : jsonResponse({ data: employeeFixture() }),
      },
    ])
    globalThis.fetch = fetchMock
    const success = spyOn(toast, 'success').mockImplementation(() => '')
    const { user } = renderRoute(<EmployeeEditPage />, '/employees/employee-1/edit', '/employees/:employeeId/edit')

    expect(screen.getByText('Loading employee...')).toBeVisible()
    const name = await screen.findByDisplayValue('Ari Employee')
    await user.clear(name)
    await user.type(name, 'Ari Updated')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const review = await screen.findByRole('dialog', { name: 'Review changes before saving' })
    await user.click(within(review).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Employee destination')).toBeVisible()
    const patch = fetchMock.mock.calls.find(([url, options]) =>
      url === '/api/admin/employees/employee-1' && options.method === 'PATCH')
    expect(JSON.parse(patch[1].body).full_name).toBe('Ari Updated')
    expect(success).toHaveBeenCalledWith('Employee updated.')
    success.mockRestore()
  })

  it('renders edit error state when employee data fails', async () => {
    globalThis.fetch = createFetchRouter([
      ...formOptionRoutes(),
      { path: '/api/admin/employees/employee-1', response: jsonResponse({ message: 'Unavailable' }, 503) },
    ])
    renderRoute(<EmployeeEditPage />, '/employees/employee-1/edit', '/employees/:employeeId/edit')
    expect(await screen.findByText('Employee data is unavailable.')).toBeVisible()
  })
})
