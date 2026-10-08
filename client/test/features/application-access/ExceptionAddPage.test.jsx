import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ExceptionAddPage } from '../../../src/features/application-access/pages/ExceptionAddPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
]

const group = {
  id: 'rule-1',
  application_id: 'exima',
  audience: 'EMPLOYEES',
  unit_ids: ['unit-1'],
  job_position_ids: [],
  job_level_ids: [],
  default_role_key: 'STAFF',
  organization_id: 'org_exima_a1b2c3',
  is_active: true,
  parent_group_id: null,
  units: [{ id: 'unit-1', name: 'MAD Lab' }],
  job_positions: [],
  job_levels: [],
  permissions: ['store.use'],
  exception_count: 0,
  blocked_count: 0,
}

const candidates = [
  { person_id: 'person-2', employee_id: '001', full_name: 'Alpha Person', email: 'alpha@millennia21.id', unit: 'MAD Lab', job_position: 'Developer', job_level: 'Senior', employment_type: 'FULL_TIME', inherited_role: 'STAFF', inherited_group_id: 'rule-1', own_access: null },
  { person_id: 'person-3', employee_id: '002', full_name: 'Beta Person', email: 'beta@millennia21.id', unit: 'MAD Lab', job_position: 'Designer', job_level: 'Junior', employment_type: 'CONTRACT', inherited_role: 'ADMIN', inherited_group_id: 'rule-2', own_access: null },
]

const routes = (extra = []) => [
  ...extra,
  { path: '/api/admin/application-access/apps/exima', method: 'GET', response: () => jsonResponse({ data: { application_id: 'exima', organization_id: 'org_exima_a1b2c3', groups: [group], other_count: 0 } }) },
  { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
  {
    path: /^\/api\/admin\/application-access\/candidates\?/,
    method: 'GET',
    response: () => jsonResponse({ data: candidates, paging: { current_page: 1, total_page: 1, total_item: 2, size: 10 } }),
  },
]

function renderPage(user = { role: 'SUPER_ADMIN' }, ruleId = 'rule-1') {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/:applicationId/groups/:ruleId/exceptions/new" element={<ExceptionAddPage />} />
        <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: `/application-access/apps/exima/groups/${ruleId}/exceptions/new` },
  )
}

describe('ExceptionAddPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('says when the group does not exist', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'SUPER_ADMIN' }, 'missing')
    expect(await screen.findByText('This group could not be found.')).toBeVisible()
  })

  it('lists only the people of this group and adds the checked ones as exceptions', async () => {
    const fetchMock = createFetchRouter(routes([
      {
        path: '/api/admin/application-entitlements/bulk',
        method: 'POST',
        response: () => jsonResponse({ data: { total_count: 1, success_count: 1, failed_count: 0, items: [] } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()

    expect(await screen.findByText('Add Exception to exima')).toBeVisible()
    expect(screen.getByText('Active Employees')).toBeVisible()
    expect(within(screen.getByLabelText('Who this group covers')).getByText('MAD Lab')).toBeVisible()
    const url = fetchMock.mock.calls.map(([callUrl]) => callUrl).find((callUrl) => callUrl.includes('/candidates'))
    expect(url).toContain('coverage=GROUP')
    expect(url).toContain('group_id=rule-1')
    expect(url).toContain('exclude_own_access=true')

    await user.click(screen.getByRole('button', { name: 'Select a role' }))
    await user.click(screen.getByRole('option', { name: /ADMIN/ }))
    // First is the group's own role, second the one picked here.
    await user.click(screen.getAllByRole('button', { name: '1 permission' })[1])
    expect(within(screen.getByRole('dialog', { name: 'Permissions' })).getByText('app.admin')).toBeVisible()
    await user.click(await screen.findByLabelText('Select Alpha Person'))
    await user.click(screen.getByRole('button', { name: 'Add Exception' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([callUrl, options]) =>
        callUrl === '/api/admin/application-entitlements/bulk' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({ person_ids: ['person-2'], application_id: 'exima', role: 'ADMIN' })
    })
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('blocks the checked people instead of giving them another role', async () => {
    const fetchMock = createFetchRouter(routes([
      {
        path: '/api/admin/application-entitlements/bulk',
        method: 'POST',
        response: () => jsonResponse({ data: { total_count: 1, success_count: 1, failed_count: 0, items: [] } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Add Exception to exima')

    await user.click(screen.getByRole('switch', { name: 'Blocked' }))
    expect(screen.queryByRole('button', { name: 'Select a role' })).not.toBeInTheDocument()
    expect(screen.getByText(/get no access to exima/)).toBeVisible()
    await user.click(await screen.findByLabelText('Select Alpha Person'))
    await user.click(screen.getByRole('button', { name: 'Block Access' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([callUrl, options]) =>
        callUrl === '/api/admin/application-entitlements/bulk' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({ person_ids: ['person-2'], application_id: 'exima', blocked: true })
    })
  })

  describe('for a group of students', () => {
    const studentGroup = { ...group, id: 'rule-s', audience: 'STUDENTS', unit_ids: [], units: [], allows_exceptions: true, default_role_key: 'STAFF' }
    const studentRoles = [
      { ...roles[0], key: 'LEADER', label: 'Leader', allows_students: true, allows_employees: false },
      { ...roles[1], allows_students: true, allows_employees: true },
      { id: 'role-teacher', application_id: 'exima', key: 'TEACHER_ONLY', label: 'Teacher only', permissions: [], is_active: true, active_entitlement_count: 0, allows_students: false, allows_employees: true },
    ]
    const students = [
      { person_id: 'stu-1', kind: 'STUDENT', nis: '24001', grade: 'Grade 5', class_name: 'Grade 5A', employee_id: '', full_name: 'Citra Student', email: 'citra@millennia21.id', unit: 'Elementary', job_position: '', job_level: '', employment_type: '', inherited_role: 'STAFF', inherited_group_id: 'rule-s', own_access: null },
    ]
    const studentRoutes = (extra = []) => [
      ...extra,
      { path: '/api/admin/application-access/apps/exima', method: 'GET', response: () => jsonResponse({ data: { application_id: 'exima', organization_id: 'org_exima_a1b2c3', groups: [studentGroup], other_count: 0 } }) },
      { path: '/api/admin/application-roles', response: () => jsonResponse({ data: studentRoles }) },
      { path: /^\/api\/admin\/grades/, response: () => jsonResponse({ data: [{ id: 'g5', name: 'Grade 5', level: 5 }], paging: { current_page: 1, total_page: 1, total_item: 1, size: 100 } }) },
      { path: /^\/api\/admin\/academic-years/, response: () => jsonResponse({ data: [{ id: 'y1', name: '2026/2027', status: 'ACTIVE' }], paging: { current_page: 1, total_page: 1, total_item: 1, size: 100 } }) },
      { path: /^\/api\/admin\/classes/, response: () => jsonResponse({ data: [{ id: 'c5a', name: 'Grade 5A', academic_year: { id: 'y1', name: '2026/2027' }, grade: { id: 'g5', name: 'Grade 5' } }, { id: 'c4a', name: 'Grade 4A OLD', academic_year: { id: 'y0', name: '2025/2026' }, grade: { id: 'g4', name: 'Grade 4' } }], paging: { current_page: 1, total_page: 1, total_item: 2, size: 100 } }) },
      { path: /^\/api\/admin\/application-access\/candidates\?/, method: 'GET', response: () => jsonResponse({ data: students, paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 } }) },
    ]

    it('lists the students with NIS, grade and class, offers only roles for students and sends the grant', async () => {
      const fetchMock = createFetchRouter(studentRoutes([
        { path: '/api/admin/application-entitlements/bulk', method: 'POST', response: () => jsonResponse({ data: { total_count: 1, success_count: 1, failed_count: 0, items: [] } }) },
      ]))
      globalThis.fetch = fetchMock
      const { user } = renderPage({ role: 'SUPER_ADMIN' }, 'rule-s')

      expect(await screen.findByText('Citra Student')).toBeVisible()
      const table = screen.getByRole('table')
      for (const heading of ['NIS', 'Grade', 'Class']) expect(within(table).getByRole('columnheader', { name: heading })).toBeVisible()
      expect(within(table).queryByRole('columnheader', { name: 'Job Position' })).not.toBeInTheDocument()
      expect(within(table).getByText('24001')).toBeVisible()
      expect(screen.getByPlaceholderText('Search name or NIS')).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'Select a role' }))
      expect(await screen.findByRole('option', { name: /LEADER/ })).toBeVisible()
      expect(screen.queryByRole('option', { name: /TEACHER_ONLY/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: /LEADER/ }))
      await user.click(screen.getByLabelText('Select Citra Student'))
      await user.click(screen.getByRole('button', { name: 'Add Exception' }))
      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([url, options]) => url === '/api/admin/application-entitlements/bulk' && options.method === 'POST')
        expect(JSON.parse(call[1].body)).toEqual({ person_ids: ['stu-1'], application_id: 'exima', role: 'LEADER' })
      })
    })

    it('filters by grade and by the classes of the running year', async () => {
      const fetchMock = createFetchRouter(studentRoutes())
      globalThis.fetch = fetchMock
      const { user } = renderPage({ role: 'SUPER_ADMIN' }, 'rule-s')
      await screen.findByText('Citra Student')

      await user.click(screen.getByRole('button', { name: 'All Classes' }))
      expect(await screen.findByRole('option', { name: /Grade 5A/ })).toBeVisible()
      expect(screen.queryByRole('option', { name: /Grade 4A OLD/ })).not.toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: /Grade 5A/ }))
      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('class_id=c5a'))).toBe(true)
      })
    })
  })

  it('shows the people as a table with their details and the roles highest first', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    const row = (await screen.findByText('Alpha Person')).closest('tr')
    expect(screen.getByText('alpha@millennia21.id')).toBeVisible()
    for (const header of ['Name', 'Unit', 'Job Position', 'Job Level', 'Employment Type', 'Current Role']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeVisible()
    }
    expect(within(row).getByText('MAD Lab')).toBeVisible()
    expect(within(row).getByText('Developer')).toBeVisible()
    expect(within(row).getByText('Senior')).toBeVisible()
    expect(within(row).getByText('Full Time')).toBeVisible()
    expect(within(row).getByText('STAFF')).toBeVisible()
    expect(row.textContent).not.toContain(' / ')

    await user.click(screen.getByRole('button', { name: 'Select a role' }))
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('ADMIN')
    expect(options[0]).not.toHaveTextContent('Highest')
    expect(options[1]).toHaveTextContent('STAFF')
  })

  it('filters candidates by unit, job position, job level and employment type', async () => {
    const fetchMock = createFetchRouter([
      { path: /\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }] }) },
      { path: /\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [{ id: 'pos-1', name: 'Developer' }] }) },
      { path: /\/api\/admin\/job-levels/, response: () => jsonResponse({ data: [{ id: 'lvl-1', name: 'Senior' }] }) },
      { path: /\/api\/admin\/buildings/, response: () => jsonResponse({ data: [] }) },
      ...routes(),
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('Alpha Person')
    for (const label of ['Unit', 'Job Position', 'Job Level', 'Employment Type']) {
      expect(screen.getByText(label, { selector: 'span' })).toBeVisible()
    }
    await user.click(await screen.findByRole('button', { name: 'All Units' }))
    await user.click(await screen.findByRole('option', { name: 'MAD Lab' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url.includes('/candidates') && url.includes('unit_id=unit-1'))).toBe(true)
    })
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeVisible()
  })

  it('says that people of narrower groups are not listed', async () => {
    const narrow = { ...group, id: 'rule-2', default_role_key: 'ADMIN', parent_group_id: 'rule-1', units: [], unit_ids: [] }
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/application-access/apps/exima', method: 'GET', response: () => jsonResponse({ data: { application_id: 'exima', organization_id: 'org_exima_a1b2c3', groups: [group, narrow], other_count: 0 } }) },
      ...routes().slice(1),
    ])
    renderPage()
    expect(await screen.findByText(/People in narrower groups are not listed here/)).toBeVisible()
  })

  it('cannot pick someone for the role they already get', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Select a role' }))
    await user.click(screen.getByRole('option', { name: /ADMIN/ }))

    await user.click(await screen.findByLabelText('Select Alpha Person'))
    expect(screen.getByLabelText('Select Alpha Person')).toBeChecked()
    // Beta already gets ADMIN, so is disabled for it.
    expect(screen.getByLabelText('Select Beta Person')).toBeDisabled()

    // Moving to STAFF drops Alpha, who already gets STAFF.
    await user.click(screen.getByRole('button', { name: /^ADMIN/ }))
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    expect(screen.getByLabelText('Select Alpha Person')).toBeDisabled()
    expect(screen.getByLabelText('Select Alpha Person')).not.toBeChecked()
    expect(screen.getByLabelText('Select Beta Person')).not.toBeDisabled()
  })
})
