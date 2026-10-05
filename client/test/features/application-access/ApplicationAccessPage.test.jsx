import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { Route, Routes } from 'react-router'
import { ApplicationAccessPage } from '../../../src/features/application-access/pages/ApplicationAccessPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-admin', application_id: 'exima', key: 'ADMIN', label: 'Admin', permissions: ['app.admin', 'store.use'], is_active: true, active_entitlement_count: 1 },
  { id: 'role-staff', application_id: 'exima', key: 'STAFF', label: 'Staff', permissions: ['store.use'], is_active: true, active_entitlement_count: 0 },
  { id: 'role-old', application_id: 'exima', key: 'LEGACY', label: 'Legacy', permissions: [], is_active: false, active_entitlement_count: 0 },
]

const organizations = [
  { application_id: 'exima', organization_id: 'org_exima_a1b2c3' },
]

const applications = [
  { application_id: 'exima', organization_id: 'org_exima_a1b2c3', active_group_count: 2, exception_count: 3 },
  { application_id: 'hub', organization_id: null, active_group_count: 0, exception_count: 0 },
]

function baseRoutes(extra = []) {
  return [
    ...extra,
    { path: '/api/admin/application-organizations', response: () => jsonResponse({ data: organizations }) },
    { path: '/api/admin/application-roles', response: () => jsonResponse({ data: roles }) },
    { path: '/api/admin/application-access/applications', response: () => jsonResponse({ data: applications }) },
  ]
}

function renderPage(user = { role: 'SUPER_ADMIN' }, route = '/application-access') {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access" element={<ApplicationAccessPage />} />
          <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
          <Route path="/application-access/roles/new" element={<div>New role page</div>} />
          <Route path="/application-access/roles/:roleId" element={<div>Edit role page</div>} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route },
  )
}

describe('ApplicationAccessPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('lists applications with group and exception counts and flags the ones without a group', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    renderPage()
    const exima = (await screen.findByText('exima')).closest('tr')
    expect(within(exima).getByText('org_exima_a1b2c3')).toBeVisible()
    expect(within(exima).getByText('2')).toBeVisible()
    expect(within(exima).getByText('3')).toBeVisible()
    const hub = screen.getByText('hub').closest('tr')
    expect(within(hub).getByText('No group yet')).toBeVisible()
  })

  it('opens the page of an application from Manage', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage()
    await screen.findByText('exima')
    await user.click(screen.getByRole('button', { name: 'Manage exima' }))
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('shows the registry and the generated organization ids on the Roles tab', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=roles')
    const row = (await screen.findByText('LEGACY')).closest('tr')
    expect(within(row).getByText('Inactive')).toBeVisible()
    const adminRow = screen.getByText('ADMIN').closest('tr')
    expect(within(adminRow).getByText('1')).toBeVisible()
    expect(screen.getByText('org_exima_a1b2c3')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Add Role' }))
    expect(await screen.findByText('New role page')).toBeVisible()
  })

  it('opens the role edit page from the row menu', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage({ role: 'SUPER_ADMIN' }, '/application-access?tab=roles')
    await screen.findByText('LEGACY')
    await user.click(screen.getByRole('button', { name: 'Actions for exima STAFF' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit role page')).toBeVisible()
  })

  it('switches between the Applications and Roles tabs', async () => {
    globalThis.fetch = createFetchRouter(baseRoutes())
    const { user } = renderPage()
    await screen.findByText('exima')

    await user.click(screen.getByRole('button', { name: 'Roles' }))
    expect(await screen.findByText('LEGACY')).toBeVisible()
    expect(screen.queryByText('No group yet')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Applications' }))
    expect(await screen.findByText('No group yet')).toBeVisible()
  })
})
