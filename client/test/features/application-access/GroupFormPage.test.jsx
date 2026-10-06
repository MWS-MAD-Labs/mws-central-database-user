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
    { id: 'pos-1', name: 'Head of IT', unit_ids: ['unit-1'] },
    { id: 'pos-3', name: 'IT Support', unit_ids: ['unit-1', 'unit-2'] },
    { id: 'pos-4', name: 'Junior Fullstack Developer', unit_ids: ['unit-1'] },
    { id: 'pos-5', name: 'Tutor', unit_ids: ['unit-2'] },
    { id: 'pos-2', name: 'Designer', unit_ids: [] },
  ],
  job_levels: [{ id: 'lvl-1', name: 'Staff', unit_ids: [] }],
  pairs: { 'pos-1': ['lvl-1'], 'pos-2': ['lvl-1'], 'pos-3': ['lvl-1'], 'pos-4': ['lvl-1'], 'pos-5': ['lvl-1'] },
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
  { path: /^\/api\/admin\/job-positions/, response: () => jsonResponse({ data: [
    { id: 'pos-1', name: 'Head of IT' },
    { id: 'pos-2', name: 'Designer' },
    { id: 'pos-3', name: 'IT Support' },
    { id: 'pos-4', name: 'Junior Fullstack Developer' },
    { id: 'pos-5', name: 'Tutor' },
  ] }) },
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

async function next(user, count = 1) {
  for (let index = 0; index < count; index += 1) {
    await user.click(screen.getByRole('button', { name: 'Next' }))
  }
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
    await screen.findByRole('switch', { name: 'MAD Lab' })
    await rulesLoaded(fetchMock)
    await next(user, 2)
    // Pick only Head of IT, a position that exists only in MAD Lab.
    await user.click(screen.getByRole('switch', { name: 'All Positions' }))
    await user.click(screen.getByRole('switch', { name: 'Head of IT' }))
    expect(screen.getByRole('switch', { name: 'Head of IT' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    // Leave MAD Lab out of the units: Head of IT has nowhere left to exist.
    await user.click(screen.getByRole('switch', { name: 'MAD Lab' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Positions: Head of IT'))
    await next(user, 2)
    expect(screen.getByRole('switch', { name: 'Head of IT' })).toBeDisabled()
    expect(screen.getAllByText('Needs MAD Lab').length).toBeGreaterThan(0)
  })

  it('does not change units or levels when positions are unchecked', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'MAD Lab' })
    await rulesLoaded(fetchMock)
    await next(user, 2)

    await user.click(screen.getByRole('switch', { name: 'Head of IT' }))
    await user.click(screen.getByRole('switch', { name: 'IT Support' }))
    await user.click(screen.getByRole('switch', { name: 'Junior Fullstack Developer' }))

    expect(screen.getByRole('switch', { name: 'Designer' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Tutor' })).toBeChecked()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await next(user)
    expect(within(screen.getByLabelText('Scope review')).getByText('All Units')).toBeVisible()
    expect(within(screen.getByLabelText('Scope review')).getByText('All Levels')).toBeVisible()
  })

  it('keeps a multi-unit position when one of its units is unchecked', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'MAD Lab' })
    await rulesLoaded(fetchMock)
    await next(user, 2)
    await user.click(screen.getByRole('switch', { name: 'All Positions' }))
    await user.click(screen.getByRole('switch', { name: 'IT Support' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('switch', { name: 'MAD Lab' }))

    expect(screen.getByRole('switch', { name: 'Elementary' })).toBeChecked()
    await next(user, 2)
    expect(screen.getByRole('switch', { name: 'IT Support' })).toBeChecked()
  })

  it('shows a compact review and only goes back one step at a time', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'MAD Lab' })
    await rulesLoaded(fetchMock)
    await next(user, 2)

    await user.click(screen.getByRole('switch', { name: 'All Positions' }))
    await user.click(screen.getByRole('switch', { name: 'Head of IT' }))
    await user.click(screen.getByRole('switch', { name: 'IT Support' }))
    await user.click(screen.getByRole('switch', { name: 'Junior Fullstack Developer' }))
    await user.click(screen.getByRole('switch', { name: 'Tutor' }))
    await next(user)

    const review = screen.getByLabelText('Scope review')
    expect(within(review).getByText('Head of IT')).toBeVisible()
    expect(within(review).getByText('IT Support')).toBeVisible()
    expect(within(review).getByText('Junior Fullstack Developer')).toBeVisible()
    expect(within(review).getByRole('button', { name: 'View all' })).toBeVisible()
    expect(within(review).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('group', { name: 'Job Positions' })).toBeVisible()
  })

  it('shows scope filters in unit, job level, job position order', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'MAD Lab' })
    expect(screen.getByRole('group', { name: 'Units' })).toBeVisible()
    await next(user)
    expect(screen.getByRole('group', { name: 'Job Levels' })).toBeVisible()
    await next(user)
    expect(screen.getByRole('group', { name: 'Job Positions' })).toBeVisible()
  })

  it('offers only the positions that exist in the chosen units', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByRole('switch', { name: 'MAD Lab' })
    await rulesLoaded(fetchMock)
    await user.click(screen.getByRole('switch', { name: 'MAD Lab' }))
    await next(user, 2)
    expect(screen.getByRole('switch', { name: 'Head of IT' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)

    await user.click(screen.getByRole('switch', { name: 'All Units' }))
    await next(user, 3)
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
    await next(user, 2)
    await user.click(screen.getByRole('switch', { name: 'All Positions' }))
    await user.click(screen.getByRole('switch', { name: 'Head of IT' }))
    await next(user)
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
    expect(screen.getByText('Job Positions')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'All Active Employees' }))
    await user.click(screen.getByRole('option', { name: 'All Active Students' }))
    expect(screen.getByRole('switch', { name: 'All Units' })).toBeVisible()
    expect(within(screen.getByLabelText('Scope steps')).queryByText('Job Positions')).not.toBeInTheDocument()
  })
})
