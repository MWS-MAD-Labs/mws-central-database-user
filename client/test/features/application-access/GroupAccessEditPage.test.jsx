import { describe, expect, it } from 'bun:test'
import { Route, Routes } from 'react-router'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { GroupAccessEditPage } from '../../../src/features/application-access/pages/GroupAccessEditPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

let unavailable = []

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
]

let rule = {
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
  { path: /\/api\/admin\/application-access\/apps\/exima\/role-options/, response: () => jsonResponse({ data: { unavailable } }) },
    { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: [{ application_id: 'exima', organization_id: 'org_exima_a1b2c3' }] }) },
    { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'MAD Lab' }, { id: 'unit-2', name: 'Elementary' }] }) },
    { path: /^\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [{ id: 'pos-1', name: 'Developer' }] }) },
    { path: /^\/api\/admin\/job-levels/, response: () => jsonResponse({ data: [] }) },
    { path: '/api/admin/application-access/scope-catalog', response: () => jsonResponse({ data: { units: [{ id: 'unit-1', name: 'MAD Lab' }, { id: 'unit-2', name: 'Elementary' }], job_positions: [{ id: 'pos-1', name: 'Developer', unit_ids: [] }], job_levels: [{ id: 'lvl-1', name: 'Staff', unit_ids: [] }], pairs: { 'pos-1': ['lvl-1'] } } }) },
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
    expect(await screen.findByRole('switch', { name: 'MAD Lab' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Elementary' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'All Units' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(await screen.findByText('org_exima_a1b2c3')).toBeVisible()
  })

  it('saves a new role and turns the group off without sending an organization id', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-access-rules/rule-1', method: 'PATCH', response: () => jsonResponse({ data: rule }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'MAD Lab' })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('switch', { name: 'All Positions' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Next' }))

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

  it('tells that a group of employees and students together should be split', async () => {
    const original = rule
    rule = { ...rule, audience: 'EMPLOYEES_AND_STUDENTS' }
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    expect(await screen.findByText(/covers employees and students together/)).toBeVisible()
    rule = original
  })

  it('shows Allow Exceptions for a group of students only and saves it', async () => {
    const original = rule
    rule = { ...rule, audience: 'STUDENTS', allows_exceptions: false }
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-access-rules/rule-1', method: 'PATCH', response: () => jsonResponse({ data: rule }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    const allow = await screen.findByLabelText(/Allow Exceptions/)
    expect(allow).not.toBeChecked()
    await user.click(allow)
    // Walk the scope steps until the review is reached and Save opens up.
    for (let step = 0; step < 4 && screen.getByRole('button', { name: 'Save' }).disabled; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
    }
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url.endsWith('/application-access-rules/rule-1') && options.method === 'PATCH')
      expect(call).toBeDefined()
      expect(JSON.parse(call[1].body).allows_exceptions).toBe(true)
    })
    rule = original
  })

  it('has no Allow Exceptions for a group of employees', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    await screen.findByLabelText('Group access is on')
    expect(screen.queryByLabelText(/Allow Exceptions/)).not.toBeInTheDocument()
  })
})
