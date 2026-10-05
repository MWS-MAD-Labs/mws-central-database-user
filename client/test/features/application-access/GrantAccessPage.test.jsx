import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { GrantAccessPage } from '../../../src/features/application-access/pages/GrantAccessPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin', 'store.use'], is_active: true, active_entitlement_count: 1 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-old', application_id: 'exima', key: 'LEGACY', label: 'Legacy', permissions: [], is_active: false, active_entitlement_count: 0 },
]

const baselineRow = {
  kind: 'GROUP',
  id: 'rule-base',
  application_id: 'exima',
  role: 'STAFF',
  permissions: ['store.use'],
  organization_id: 'org_exima_a1b2c3',
  is_active: true,
  group: { audience: 'EMPLOYEES', units: [], job_positions: [], job_levels: [] },
  person: null,
}

const candidates = [
  { person_id: 'person-2', employee_id: '001', full_name: 'Alpha Person', email: 'alpha@millennia21.id', unit: 'MAD Lab', job_position: 'Developer', job_level: 'Senior', inherited_role: 'STAFF', inherited_group_id: 'rule-base', own_access: null },
  { person_id: 'person-3', employee_id: '002', full_name: 'Beta Person', email: 'beta@millennia21.id', unit: 'MAD Lab', job_position: 'Designer', job_level: 'Junior', inherited_role: null, inherited_group_id: null, own_access: { role: 'ADMIN', is_active: false } },
]

const routes = (extra = [], groups = [baselineRow]) => [
  ...extra,
  {
    path: /^\/api\/admin\/application-access\/candidates\?/,
    method: 'GET',
    response: () => jsonResponse({ data: candidates, paging: { current_page: 1, total_page: 1, total_item: 2, size: 10 } }),
  },
  {
    path: /^\/api\/admin\/application-access\?/,
    method: 'GET',
    response: () => jsonResponse({ data: groups, paging: { current_page: 1, total_page: 1, total_item: groups.length, size: 100 } }),
  },
  { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
  { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: [{ application_id: 'exima', organization_id: 'org_exima_a1b2c3' }] }) },
  { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }, { id: 'unit-2', name: 'Elementary' }] }) },
  { path: /^\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [{ id: 'pos-1', name: 'Developer' }, { id: 'pos-2', name: 'Designer' }] }) },
  { path: /^\/api\/admin\/job-levels/, response: () => jsonResponse({ data: [] }) },
  { path: /^\/api\/admin\/buildings/, response: () => jsonResponse({ data: [] }) },
]

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/grant" element={<GrantAccessPage />} />
        <Route path="/application-access" element={<div>Access list</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/application-access/grant' },
  )
}

async function chooseApplicationAndRole(user, roleName) {
  await user.click(screen.getByRole('button', { name: 'Select an application' }))
  await user.click(screen.getByRole('option', { name: 'exima' }))
  await user.click(screen.getByRole('button', { name: 'Select a role' }))
  await user.click(screen.getByRole('option', { name: roleName }))
}

const lastCandidateUrl = (fetchMock) =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/candidates')).at(-1)

describe('GrantAccessPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('has no separate Who step and keeps exceptions off until the application has a group', async () => {
    globalThis.fetch = createFetchRouter(routes([], []))
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Select an application' })
    expect(screen.queryByText('Who')).not.toBeInTheDocument()
    expect(screen.getByText('Scope')).toBeVisible()

    await chooseApplicationAndRole(user, /STAFF/)
    expect(await screen.findByText(/Add a group for exima first/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Everyone in this scope' })).toBeVisible()

    // Even when asked for, people are not listed without a group.
    await user.click(screen.getByRole('button', { name: 'Everyone in this scope' }))
    await user.click(screen.getByRole('option', { name: 'Only the people I check' }))
    expect(screen.getByRole('button', { name: 'Everyone in this scope' })).toBeVisible()
    expect(screen.queryByText('People', { selector: 'h2' })).not.toBeInTheDocument()
  })

  it('lists only people the groups cover, inside the scope, and adds them as exceptions', async () => {
    const fetchMock = createFetchRouter(routes([
      {
        path: '/api/admin/application-entitlements/bulk',
        method: 'POST',
        response: () => jsonResponse({ data: { total_count: 2, success_count: 2, failed_count: 0, items: [] } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Select an application' })
    await chooseApplicationAndRole(user, /ADMIN/)

    await user.click(screen.getByRole('button', { name: 'Everyone in this scope' }))
    await user.click(screen.getByRole('option', { name: 'Only the people I check' }))

    await user.click(await screen.findByLabelText('Alpha Person'))
    await user.click(screen.getByLabelText('Beta Person'))
    expect(screen.getByText(/2 employees selected/)).toBeVisible()
    expect(screen.getByText(/Gets STAFF from a group/)).toBeVisible()
    expect(screen.queryByText(/Own access/)).not.toBeInTheDocument()
    expect(await screen.findByText('org_exima_a1b2c3')).toBeVisible()

    const url = lastCandidateUrl(fetchMock)
    expect(url).toContain('application_id=exima')
    expect(url).toContain('coverage=COVERED')
    expect(url).toContain('exclude_own_access=true')
    expect(url).not.toContain('unit_ids')

    // Narrowing the scope narrows the list.
    await user.click(screen.getByLabelText('Elementary'))
    await waitFor(() => expect(lastCandidateUrl(fetchMock)).toContain('unit_ids=unit-1'))

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([callUrl, options]) =>
        callUrl === '/api/admin/application-entitlements/bulk' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        person_ids: ['person-2', 'person-3'],
        application_id: 'exima',
        role: 'ADMIN',
      })
    })
    expect(await screen.findByText('Access list')).toBeVisible()
  })

  it('cannot pick someone for the role a group already gives them', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Select an application' })
    await chooseApplicationAndRole(user, /ADMIN/)
    await user.click(screen.getByRole('button', { name: 'Everyone in this scope' }))
    await user.click(screen.getByRole('option', { name: 'Only the people I check' }))

    await user.click(await screen.findByLabelText('Alpha Person'))
    expect(screen.getByLabelText('Alpha Person')).toBeChecked()

    // Moving to STAFF drops Alpha, who already gets STAFF from the group.
    await user.click(screen.getByRole('button', { name: 'ADMIN' }))
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    expect(screen.getByLabelText('Alpha Person')).toBeDisabled()
    expect(screen.getByLabelText('Alpha Person')).not.toBeChecked()
    expect(screen.getByLabelText('Beta Person')).not.toBeDisabled()
  })

  it('keeps students out of exceptions', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Select an application' })
    await chooseApplicationAndRole(user, /ADMIN/)
    await user.click(screen.getByRole('button', { name: 'Everyone in this scope' }))
    await user.click(screen.getByRole('option', { name: 'Only the people I check' }))
    expect(await screen.findByLabelText('Alpha Person')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'All Active Employees' }))
    await user.click(screen.getByRole('option', { name: 'All Active Students' }))
    expect(screen.queryByLabelText('Alpha Person')).not.toBeInTheDocument()
    expect(screen.getByText(/Exceptions are for employees/)).toBeVisible()
  })

  it('keeps All and the checked items in step, and sends an empty list for All', async () => {
    const fetchMock = createFetchRouter(routes([
      {
        path: '/api/admin/application-access-rules',
        method: 'POST',
        response: () => jsonResponse({ data: { id: 'rule-2' } }),
      },
    ], []))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Select an application' })
    await chooseApplicationAndRole(user, /STAFF/)

    // Starts as All, so every unit is checked.
    expect(screen.getByLabelText('All Units')).toBeChecked()
    expect(screen.getByLabelText('MAD Lab')).toBeChecked()
    expect(screen.getByLabelText('Elementary')).toBeChecked()

    // Unchecking one unit drops All.
    await user.click(screen.getByLabelText('Elementary'))
    expect(screen.getByLabelText('All Units')).not.toBeChecked()
    expect(screen.getByLabelText('MAD Lab')).toBeChecked()

    // Checking it again makes it All.
    await user.click(screen.getByLabelText('Elementary'))
    expect(screen.getByLabelText('All Units')).toBeChecked()

    // Unchecking All clears everything and asks for at least one.
    await user.click(screen.getByLabelText('All Units'))
    expect(screen.getByLabelText('MAD Lab')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Pick at least one unit, or choose All Units.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)

    // Checking All again selects every unit and sends no unit filter.
    await user.click(screen.getByLabelText('All Units'))
    expect(screen.getByLabelText('MAD Lab')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-access-rules' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        application_id: 'exima',
        audience: 'EMPLOYEES',
        unit_ids: [],
        job_position_ids: [],
        job_level_ids: [],
        default_role_key: 'STAFF',
      })
    })
  })

  it('sends the chosen units and positions for a narrower group', async () => {
    const fetchMock = createFetchRouter(routes([
      {
        path: '/api/admin/application-access-rules',
        method: 'POST',
        response: () => jsonResponse({ data: { id: 'rule-3' } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Select an application' })
    await chooseApplicationAndRole(user, /ADMIN/)

    await user.click(screen.getByLabelText('All Units'))
    await user.click(screen.getByLabelText('Elementary'))
    await user.click(screen.getByLabelText('All Positions'))
    await user.click(screen.getByLabelText('Developer'))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-access-rules' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        application_id: 'exima',
        audience: 'EMPLOYEES',
        unit_ids: ['unit-2'],
        job_position_ids: ['pos-1'],
        job_level_ids: [],
        default_role_key: 'ADMIN',
      })
    })
  })

  it('shows the groups of the application and what they give', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Select an application' })
    await chooseApplicationAndRole(user, /ADMIN/)

    expect(await screen.findByText(/Group access on exima \(employees\):/)).toBeVisible()
    expect(screen.getByText(/All Active Employees get STAFF/)).toBeVisible()
  })
})
