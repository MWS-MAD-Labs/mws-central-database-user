import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { ChangeRoleDialog } from '../../../src/features/application-access/components/ChangeRoleDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const roles = [
  { id: 'role-manager', application_id: 'proofpoint', key: 'MANAGER', label: 'Manager', permissions: [], is_active: true },
  { id: 'role-staff', application_id: 'proofpoint', key: 'STAFF', label: 'Staff', permissions: [], is_active: true },
]

const exception = {
  id: 'ent-1',
  kind: 'EMPLOYEE',
  full_name: 'Head Of Unit',
  role: 'MANAGER',
  scope_units: [{ id: 'unit-1', name: 'Elementary' }],
}

function routes() {
  return createFetchRouter([
    { path: /^\/api\/admin\/units/, response: () => jsonResponse({ data: [{ id: 'unit-1', name: 'Elementary' }, { id: 'unit-2', name: 'Junior High' }] }) },
    { path: /^\/api\/admin\/(job-positions|job-levels|buildings)/, response: () => jsonResponse({ data: [] }) },
    { path: '/api/admin/application-entitlements/ent-1', method: 'PATCH', response: () => jsonResponse({ data: {} }) },
  ])
}

describe('ChangeRoleDialog', () => {
  it('changes only the units when the role stays the same', async () => {
    const fetchMock = routes()
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ChangeRoleDialog applicationId="proofpoint" exception={exception} roles={roles} onClose={mock()} onDone={mock()} />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Change Role or Units' })
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const picker = within(dialog).getByRole('group', { name: 'Units Managed' })
    expect(await within(picker).findByRole('switch', { name: /Elementary/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(picker).getByRole('switch', { name: 'Junior High' }))
    await user.click(save)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) => url.endsWith('/ent-1') && options.method === 'PATCH')
      expect(JSON.parse(call[1].body)).toEqual({ scope_unit_ids: ['unit-1', 'unit-2'] })
    })
  })

  it('has no unit picker for a student', async () => {
    globalThis.fetch = routes()
    renderWithProviders(
      <ChangeRoleDialog
        applicationId="proofpoint"
        exception={{ ...exception, kind: 'STUDENT', scope_units: [] }}
        roles={roles.map((role) => ({ ...role, allows_students: true }))}
        onClose={mock()}
        onDone={mock()}
      />,
    )
    expect(await screen.findByRole('dialog', { name: 'Change Role' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Units Managed' })).not.toBeInTheDocument()
  })
})
