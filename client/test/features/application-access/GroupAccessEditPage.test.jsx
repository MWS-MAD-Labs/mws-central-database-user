import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { GroupAccessEditPage } from '../../../src/features/application-access/pages/GroupAccessEditPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
]

const rule = {
  id: 'rule-1',
  application_id: 'exima',
  audience: 'EMPLOYEES',
  unit_ids: ['unit-1'],
  job_position_ids: [],
  job_level_ids: [],
  default_role_key: 'STAFF',
  organization_id: 'org_exima_a1b2c3',
  is_active: true,
}

function routes(extra = []) {
  return [
    ...extra,
    { path: '/api/admin/application-access-rules/rule-1', method: 'GET', response: () => jsonResponse({ data: rule }) },
    { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
    { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: [{ application_id: 'exima', organization_id: 'org_exima_a1b2c3' }] }) },
    { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }, { id: 'unit-2', name: 'Elementary' }] }) },
    { path: /^\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [{ id: 'pos-1', name: 'Developer' }] }) },
    { path: /^\/api\/admin\/job-levels/, response: () => jsonResponse({ data: [] }) },
    { path: /^\/api\/admin\/buildings/, response: () => jsonResponse({ data: [] }) },
  ]
}

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/:applicationId/groups/:ruleId" element={<GroupAccessEditPage />} />
        <Route path="/application-access/apps/:applicationId" element={<div>Access list</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/application-access/apps/exima/groups/rule-1' },
  )
}

describe('GroupAccessEditPage', () => {
  it('loads the group access with its units checked and the organization shown', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    expect(await screen.findByText('Edit All Active Employees')).toBeVisible()
    expect(await screen.findByLabelText('MAD Lab')).toBeChecked()
    expect(screen.getByLabelText('Elementary')).not.toBeChecked()
    expect(screen.getByLabelText('All Units')).not.toBeChecked()
    expect(screen.getByLabelText('All Positions')).toBeChecked()
    expect(await screen.findByText('org_exima_a1b2c3')).toBeVisible()
  })

  it('saves a new role and turns the group off without sending an organization id', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-access-rules/rule-1', method: 'PATCH', response: () => jsonResponse({ data: rule }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByLabelText('MAD Lab')

    await user.click(screen.getByRole('button', { name: /STAFF/ }))
    await user.click(screen.getByRole('option', { name: /ADMIN/ }))
    await user.click(screen.getByLabelText('Group access is on'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-access-rules/rule-1') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body)).toEqual({
        unit_ids: ['unit-1'],
        job_position_ids: [],
        job_level_ids: [],
        default_role_key: 'ADMIN',
        is_active: false,
      })
    })
    expect(await screen.findByText('Access list')).toBeVisible()
  })

  it('refuses a non Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })
})
