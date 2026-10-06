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

    expect(await screen.findByText('Add exception to exima')).toBeVisible()
    expect(screen.getByText(/Inside All Active Employees: Units: MAD Lab/)).toBeVisible()
    const url = fetchMock.mock.calls.map(([callUrl]) => callUrl).find((callUrl) => callUrl.includes('/candidates'))
    expect(url).toContain('coverage=GROUP')
    expect(url).toContain('group_id=rule-1')
    expect(url).toContain('exclude_own_access=true')

    await user.click(screen.getByRole('button', { name: 'Select a role' }))
    await user.click(screen.getByRole('option', { name: /ADMIN/ }))
    expect(screen.getByText('Permissions: app.admin')).toBeVisible()
    await user.click(await screen.findByLabelText('Select Alpha Person'))
    await user.click(screen.getByRole('button', { name: 'Add exception' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([callUrl, options]) =>
        callUrl === '/api/admin/application-entitlements/bulk' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({ person_ids: ['person-2'], application_id: 'exima', role: 'ADMIN' })
    })
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('shows the people as a table with their details and the roles highest first', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    const row = (await screen.findByText('Alpha Person')).closest('tr')
    expect(screen.getByText('alpha@millennia21.id')).toBeVisible()
    for (const header of ['Name', 'Unit', 'Job Position', 'Job Level', 'Employment Type', 'Current role']) {
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
