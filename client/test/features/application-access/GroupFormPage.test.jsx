import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { GroupFormPage } from '../../../src/features/application-access/pages/GroupFormPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-old', application_id: 'exima', key: 'LEGACY', label: 'Legacy', permissions: [], is_active: false, active_entitlement_count: 0 },
  { id: 'role-other', application_id: 'hub', key: 'MEMBER', label: 'Member', permissions: [], is_active: true, active_entitlement_count: 0 },
]

const routes = (extra = []) => [
  ...extra,
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
        <Route path="/application-access/apps/:applicationId/groups/new" element={<GroupFormPage />} />
        <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/application-access/apps/exima/groups/new' },
  )
}

describe('GroupFormPage', () => {
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
    expect(screen.getByText('Permissions: store.use')).toBeVisible()
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

    expect(screen.getByLabelText('All Units')).toBeChecked()
    expect(screen.getByLabelText('MAD Lab')).toBeChecked()
    await user.click(screen.getByLabelText('Elementary'))
    expect(screen.getByLabelText('All Units')).not.toBeChecked()
    await user.click(screen.getByLabelText('Elementary'))
    expect(screen.getByLabelText('All Units')).toBeChecked()

    await user.click(screen.getByLabelText('All Units'))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(await screen.findByText('Pick at least one unit, or choose All Units.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)

    await user.click(screen.getByLabelText('All Units'))
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

    await user.click(screen.getByLabelText('All Units'))
    await user.click(screen.getByLabelText('Elementary'))
    await user.click(screen.getByLabelText('All Positions'))
    await user.click(screen.getByLabelText('Developer'))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
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

  it('hides job positions and levels when the audience is students', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('Add group to exima')
    expect(screen.getByLabelText('All Positions')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'All Active Employees' }))
    await user.click(screen.getByRole('option', { name: 'All Active Students' }))
    expect(screen.queryByLabelText('All Positions')).not.toBeInTheDocument()
    expect(screen.getByLabelText('All Units')).toBeVisible()
  })
})
