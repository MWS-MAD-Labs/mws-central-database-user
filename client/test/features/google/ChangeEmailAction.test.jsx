import { describe, expect, it } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangeEmailAction } from '../../../src/features/google/components/ChangeEmailAction.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

// The toast host asks for the reduced-motion setting, which the test window does not have.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })

function setup({ status, canChange = true }) {
  const fetchMock = createFetchRouter([
    { path: '/api/admin/employees/e1/google', response: jsonResponse({ data: status }) },
    { path: '/api/admin/employees/e1/google/unlink', method: 'POST', response: jsonResponse({ data: { status: 'NONE', google_user_id: null } }) },
  ])
  globalThis.fetch = fetchMock
  renderWithProviders(
    <ConfirmProvider>
      <ChangeEmailAction resource="employees" id="e1" currentEmail="ari@millennia21.id" name="Ari" canChange={canChange} />
    </ConfirmProvider>,
  )
  return fetchMock
}

const linked = { linked: true, status: 'ACTIVE', can: { manage: true } }

describe('ChangeEmailAction', () => {
  it('puts Unlink Google next to Change email for a Super Admin, and unlinks with a reason', async () => {
    const user = userEvent.setup()
    const fetchMock = setup({ status: linked })
    await screen.findByRole('button', { name: 'Unlink Google' })
    expect(screen.getByRole('button', { name: 'Change email' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Unlink Google' }))
    const dialog = await screen.findByRole('dialog', { name: 'Unlink Google Account' })
    const confirm = within(dialog).getByRole('button', { name: 'Unlink' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByPlaceholderText('Why is it unlinked'), 'Wrong account')
    await user.click(confirm)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) => url === '/api/admin/employees/e1/google/unlink' && options.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({ reason: 'Wrong account' })
    })
  })

  it('has no Unlink Google for a person with no account, one waiting for its owner, or an admin who may not manage', async () => {
    for (const status of [
      { linked: false, status: 'NONE', can: { manage: true } },
      { linked: true, status: 'PENDING_CLAIM', can: { manage: true } },
      { linked: true, status: 'ACTIVE', can: { manage: false } },
    ]) {
      setup({ status })
      await screen.findByRole('button', { name: 'Change email' })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(screen.queryByRole('button', { name: 'Unlink Google' })).not.toBeInTheDocument()
      cleanup()
    }
  })

  it('says who to ask when the admin cannot change an email, and offers nothing else', () => {
    setup({ status: linked, canChange: false })
    expect(screen.getByText('Only a Super Admin can change an email.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Unlink Google' })).not.toBeInTheDocument()
  })
})
