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

describe('GrantAccessPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('bulk grants the checked employees and shows the generated organization id', async () => {
    const fetchMock = createFetchRouter(routes([
      {
        path: /^\/api\/admin\/employees\?/,
        response: () => jsonResponse({
          data: [
            { id: 'emp-1', person_id: 'person-2', identity: { full_name: 'Alpha Person', email: 'alpha@millennia21.id' }, employment: { unit: 'MAD Lab', job_position: 'Developer' } },
            { id: 'emp-2', person_id: 'person-3', identity: { full_name: 'Beta Person', email: 'beta@millennia21.id' }, employment: { unit: 'MAD Lab', job_position: 'Designer' } },
          ],
          paging: { current_page: 1, total_page: 1, total_item: 2, size: 10 },
        }),
      },
      {
        path: '/api/admin/application-entitlements/bulk',
        method: 'POST',
        response: () => jsonResponse({ data: { total_count: 2, success_count: 2, failed_count: 0, items: [] } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()

    await user.click(await screen.findByLabelText('Alpha Person'))
    await user.click(screen.getByLabelText('Beta Person'))
    expect(screen.getByText(/2 employees selected/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Select an application' }))
    await user.click(screen.getByRole('option', { name: 'exima' }))
    await user.click(screen.getByRole('button', { name: 'Select a role' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('ADMIN'),
      expect.stringContaining('STAFF'),
    ])
    await user.click(screen.getByRole('option', { name: /STAFF/ }))
    expect(screen.getByText('Permissions: store.use')).toBeVisible()
    expect(await screen.findByText('org_exima_a1b2c3')).toBeVisible()
    expect(screen.queryByText('Organization ID', { selector: 'label' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Grant' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/application-entitlements/bulk' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({
        person_ids: ['person-2', 'person-3'],
        application_id: 'exima',
        role: 'STAFF',
      })
    })
    expect(await screen.findByText('Access list')).toBeVisible()
  })

  it('keeps All and the checked items in step, and sends an empty list for All', async () => {
    const fetchMock = createFetchRouter(routes([
      {
        path: '/api/admin/application-access-rules',
        method: 'POST',
        response: () => jsonResponse({ data: { id: 'rule-2' } }),
      },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('button', { name: 'Specific People' })
    await user.click(screen.getByRole('button', { name: 'Specific People' }))
    await user.click(screen.getByRole('option', { name: 'A Group' }))
    await chooseApplicationAndRole(user, /STAFF/)

    // Starts as All, so every unit is checked.
    expect(screen.getByLabelText('All Units')).toBeChecked()
    expect(screen.getByLabelText('MAD Lab')).toBeChecked()
    expect(screen.getByLabelText('Elementary')).toBeChecked()

    // Unchecking one unit drops All.
    await user.click(screen.getByLabelText('Elementary'))
    expect(screen.getByLabelText('All Units')).not.toBeChecked()
    expect(screen.getByLabelText('MAD Lab')).toBeChecked()
    expect(screen.getByLabelText('Elementary')).not.toBeChecked()

    // Checking it again makes it All.
    await user.click(screen.getByLabelText('Elementary'))
    expect(screen.getByLabelText('All Units')).toBeChecked()

    // Unchecking All clears everything and asks for at least one.
    await user.click(screen.getByLabelText('All Units'))
    expect(screen.getByLabelText('MAD Lab')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Grant' }))
    expect(await screen.findByText('Pick at least one unit, or choose All Units.')).toBeVisible()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)

    // Checking All again selects every unit and sends no unit filter.
    await user.click(screen.getByLabelText('All Units'))
    expect(screen.getByLabelText('MAD Lab')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Grant' }))
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
    await screen.findByRole('button', { name: 'Specific People' })
    await user.click(screen.getByRole('button', { name: 'Specific People' }))
    await user.click(screen.getByRole('option', { name: 'A Group' }))
    await chooseApplicationAndRole(user, /ADMIN/)

    await user.click(screen.getByLabelText('All Units'))
    await user.click(screen.getByLabelText('Elementary'))
    await user.click(screen.getByLabelText('All Positions'))
    await user.click(screen.getByLabelText('Developer'))
    await user.click(screen.getByRole('button', { name: 'Grant' }))

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
})
