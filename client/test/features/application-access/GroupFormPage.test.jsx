import { beforeEach, describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { GroupFormPage } from '../../../src/features/application-access/pages/GroupFormPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

let unavailable = []
const scopeCatalog = {
  units: [
    { id: 'unit-1', name: 'MAD Lab' },
    { id: 'unit-2', name: 'Elementary' },
  ],
  job_positions: [
    { id: 'pos-1', name: 'Developer', unit_ids: ['unit-1'] },
    { id: 'pos-2', name: 'Designer', unit_ids: [] },
  ],
  job_levels: [{ id: 'lvl-1', name: 'Staff', unit_ids: [] }],
  pairs: { 'pos-1': ['lvl-1'], 'pos-2': ['lvl-1'] },
}

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-old', application_id: 'exima', key: 'LEGACY', label: 'Legacy', permissions: [], is_active: false, active_entitlement_count: 0 },
  { id: 'role-other', application_id: 'hub', key: 'MEMBER', label: 'Member', permissions: [], is_active: true, active_entitlement_count: 0 },
]

const routes = (extra = []) => [
  ...extra,
  { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
  { path: '/api/admin/application-access/scope-catalog', response: () => jsonResponse({ data: scopeCatalog }) },
  { path: /\/api\/admin\/application-access\/apps\/exima\/role-options/, response: () => jsonResponse({ data: { unavailable } }) },
  { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: [{ application_id: 'exima', organization_id: 'org_exima_a1b2c3' }] }) },
  { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }, { id: 'unit-2', name: 'Elementary' }, { id: 'unit-9', name: 'Unknown / Legacy' }] }) },
  { path: /^\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [{ id: 'pos-1', name: 'Developer' }, { id: 'pos-2', name: 'Designer' }] }) },
  { path: /^\/api\/admin\/job-levels/, response: () => jsonResponse({ data: [{ id: 'lvl-1', name: 'Staff' }] }) },
  { path: /^\/api\/admin\/buildings/, response: () => jsonResponse({ data: [] }) },
]

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/:applicationId/groups/new" element={<GroupFormPage />} />
        <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/application-access/apps/exima/groups/new' },
  )
}

// The scope rules come with their own request, so wait until they are in before clicking.
async function rulesLoaded(fetchMock) {
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('scope-catalog'))).toBe(true)
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('GroupFormPage', () => {
  beforeEach(() => {
    unavailable = []
  })


  it('drops the roles the scope cannot take and says when none are left', async () => {
    unavailable = [{ role: 'STAFF', reason: 'Same as the broader group' }]
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('Add group to exima')
    await user.click(screen.getByRole('button', { name: 'Select a role' }))
    await waitFor(() => {
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([expect.stringContaining('ADMIN')])
    })
  })

  it('drops what only existed because of an unchecked unit and says so', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'Developer' })
    await rulesLoaded(fetchMock)
    // Pick only Developer, a position that exists only in MAD Lab.
    await user.click(screen.getByRole('switch', { name: 'All Positions' }))
    await user.click(screen.getByRole('switch', { name: 'Developer' }))
    expect(screen.getByRole('switch', { name: 'Developer' })).toBeChecked()
    // Leave MAD Lab out of the units: Developer has nowhere left to exist.
    await user.click(screen.getByRole('switch', { name: 'MAD Lab' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Positions: Developer'))
    expect(screen.queryByRole('switch', { name: 'Developer', checked: true })).not.toBeInTheDocument()
  })

  it('offers only the positions that exist in the chosen units', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'Developer' })
    await rulesLoaded(fetchMock)
    await user.click(screen.getByRole('switch', { name: 'MAD Lab' }))
    expect(screen.queryByRole('switch', { name: 'Developer' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Designer' })).toBeVisible()
  })

  it('does not offer the Unknown / Legacy unit', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    await screen.findByRole('switch', { name: 'MAD Lab' })
    expect(screen.queryByRole('switch', { name: 'Unknown / Legacy' })).not.toBeInTheDocument()
  })

  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('offers only the active roles of this application and shows the organization id', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    expect(await screen.findByText('Add group to exima')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Select a role' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('ADMIN'),
      expect.stringContaining('STAFF'),
    ])
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    await user.click(screen.getByRole('button', { name: '1 permission' }))
    expect(within(screen.getByRole('dialog', { name: 'Permissions' })).getByText('store.use')).toBeVisible()
    expect(await screen.findByText('org_exima_a1b2c3')).toBeVisible()
  })

  it('keeps All and the checked items in step, and sends an empty list for All', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-access-rules', method: 'POST', response: () => jsonResponse({ data: { id: 'rule-2' } }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Select a role' }))
    await user.click(screen.getByRole('option', { name: /STAFF/ }))

    expect(screen.getByRole('switch', { name: 'All Units' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'MAD Lab' })).toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Elementary' }))
    expect(screen.getByRole('switch', { name: 'All Units' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Elementary' }))
    expect(screen.getByRole('switch', { name: 'All Units' })).toBeChecked()

    await user.click(screen.getByRole('switch', { name: 'All Units' }))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(await screen.findByText('Pick at least one unit, or choose All Units.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)

    await user.click(screen.getByRole('switch', { name: 'All Units' }))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
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
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('sends the chosen units and positions, and hides positions for students', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-access-rules', method: 'POST', response: () => jsonResponse({ data: { id: 'rule-3' } }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Select a role' }))
    await user.click(screen.getByRole('option', { name: /ADMIN/ }))

    await user.click(screen.getByRole('switch', { name: 'All Units' }))
    await user.click(screen.getByRole('switch', { name: 'MAD Lab' }))
    await user.click(screen.getByRole('switch', { name: 'All Positions' }))
    await user.click(screen.getByRole('switch', { name: 'Developer' }))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-access-rules' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        application_id: 'exima',
        audience: 'EMPLOYEES',
        unit_ids: ['unit-1'],
        job_position_ids: ['pos-1'],
        job_level_ids: [],
        default_role_key: 'ADMIN',
      })
    })
  })

  it('hides job positions and levels when the audience is students', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('Add group to exima')
    expect(screen.getByRole('switch', { name: 'All Positions' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'All Active Employees' }))
    await user.click(screen.getByRole('option', { name: 'All Active Students' }))
    expect(screen.queryByRole('switch', { name: 'All Positions' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'All Units' })).toBeVisible()
  })
})
