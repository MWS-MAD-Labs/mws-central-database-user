import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { GoogleAccountRow } from '../../../src/features/google/components/GoogleAccountRow.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const everything = { create: true, manage: true, takeover: true }
const status = (over = {}) => ({ linked: true, status: 'ACTIVE', synced_at: null, last_error: null, mode: 'google', can: everything, ...over })

function setup(statusData, extraRoutes = []) {
  const fetchMock = createFetchRouter([
    { path: '/api/admin/employees/e1/google', response: jsonResponse({ data: statusData }) },
    ...extraRoutes,
  ])
  globalThis.fetch = fetchMock
  return { fetchMock, ...renderWithProviders(<GoogleAccountRow resource="employees" id="e1" email="ari@millennia21.id" />) }
}

describe('GoogleAccountRow', () => {
  const unlinked = (state, message = null) => status({ linked: false, status: 'NONE', lookup: { state, message } })

  it('says there is no account yet only when Google was asked and had none', async () => {
    setup(unlinked('absent'))
    expect(await screen.findByText('Not created')).toBeVisible()
    expect(screen.getByText('No Google account for this email yet.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create Google account' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Link Google account' })).not.toBeInTheDocument()
  })

  it('does not call an address Central may not reach "not created"', async () => {
    setup(unlinked('blocked', 'Outside production only test addresses starting with "test.central." are sent to Google'))
    expect(await screen.findByText('Not Checked')).toBeVisible()
    expect(screen.queryByText('Not created')).not.toBeInTheDocument()
    expect(screen.getByText(/Outside production only test addresses starting with "test.central." are sent to Google\./)).toBeVisible()
    const create = screen.getByRole('button', { name: 'Create Google account' })
    expect(create).toBeDisabled()
    expect(create).toHaveAttribute('title', expect.stringContaining('test.central.'))
    expect(screen.queryByRole('button', { name: 'Link Google account' })).not.toBeInTheDocument()
  })

  it('says a simulated Google cannot tell, and still lets an account be made', async () => {
    setup(unlinked('simulated', 'Google is only simulated in this environment, so it cannot say if the account exists'))
    expect(await screen.findByText('Not Checked')).toBeVisible()
    expect(screen.getByText(/only simulated in this environment/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create Google account' })).toBeEnabled()
  })

  it('shows a Workspace admin with no action, and a failed lookup as not checked', async () => {
    const { unmount } = setup(unlinked('admin', 'A Workspace admin account. Central does not manage it'))
    expect(await screen.findByText('Workspace Admin')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create Google account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link Google account' })).not.toBeInTheDocument()
    unmount()

    setup(unlinked('failed', 'Could not reach Google. Try again'))
    expect(await screen.findByText('Not Checked')).toBeVisible()
    expect(screen.getByText('Could not reach Google. Try again.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Check Google' })).toBeVisible()
  })

  it('keeps Check Google off where asking again cannot change the answer, and says why', async () => {
    setup(unlinked('blocked', 'Outside production only test addresses starting with "test.central." are sent to Google'))
    const button = await screen.findByRole('button', { name: 'Check Google' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('would not change anything'))
  })

  it('looks again when Check Google is pressed on a person with no link', async () => {
    const { user, fetchMock } = setup(unlinked('absent'))
    await user.click(await screen.findByRole('button', { name: 'Check Google' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/employees/e1/google')).length).toBeGreaterThan(1))
  })

  it('keeps the password and recovery email actions off for a deleted account, with the reason', async () => {
    setup(status({ status: 'MISSING', last_error: 'Deleted in Google, can be restored for about 20 days' }))
    await screen.findByText('Deleted in Google')
    for (const name of ['Make temporary password', 'Change recovery email']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'Restore the account first.')
    }
    expect(screen.getByRole('button', { name: 'Restore Google account' })).toBeEnabled()
    expect(screen.getByText(/Use Restore, then check again/)).toBeVisible()
  })

  it('tells an admin who cannot restore to ask a Super Admin', async () => {
    setup(status({ status: 'MISSING', last_error: 'Deleted in Google, can be restored for about 20 days', can: { create: true, manage: false, takeover: false } }))
    expect(await screen.findByText(/Ask a Super Admin to restore it/)).toBeVisible()
  })

  const only = (can) => status({ can: { create: false, manage: false, takeover: false, ...can } })
  const buttonNames = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))

  it('shows an admin who may only create the instructions and nothing that touches the account', async () => {
    setup(only({ create: true }))
    await screen.findByText('Linked')
    expect(buttonNames()).toEqual(['Sign-in instructions'])
  })

  it('shows a Super Admin the account work but not the two takeover actions', async () => {
    setup(only({ create: true, manage: true }))
    await screen.findByText('Linked')
    expect(buttonNames()).toEqual(['Sign-in instructions', 'Suspend Google account', 'Check Google again'])
  })

  it('shows the protected Super Admin the password and recovery email actions too', async () => {
    setup(status())
    await screen.findByText('Linked')
    expect(buttonNames()).toEqual([
      'Sign-in instructions', 'Suspend Google account', 'Check Google again', 'Change recovery email', 'Make temporary password',
    ])
  })

  it('shows an account that is in Google but not linked, and links it without asking for a recovery email', async () => {
    const { user, fetchMock } = setup(status({ linked: false, status: 'NONE', lookup: { state: 'found', message: null } }), [
      { path: '/api/admin/employees/e1/google/provision', method: 'POST', response: jsonResponse({ data: { status: 'ACTIVE', outcome: 'linked' } }) },
    ])
    expect(await screen.findByText('In Google')).toBeVisible()
    expect(screen.getByText('Not linked to this person yet.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create Google account' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Link Google account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Link Google Account' })
    expect(within(dialog).queryByLabelText(/Recovery/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      String(url).endsWith('/google/provision') && options.method === 'POST' && options.body === '{}')).toBe(true))
  })

  it('hides the ways to open the account for someone who left', async () => {
    setup(status({ status: 'SUSPENDED', locked: true, locked_reason: 'RESIGNED', last_error: 'Suspended in Google after RESIGNED' }))
    expect(await screen.findByText(/Locked because the person left \(RESIGNED\)/)).toBeVisible()
    for (const name of ['Unsuspend Google account', 'Make temporary password', 'Change recovery email', 'Sign-in instructions', 'Create Google account']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Check Google again' })).toBeVisible()
  })

  it('tells when the person left but the account is still active', async () => {
    setup(status({ locked: true, locked_reason: 'ARCHIVED' }))
    expect(await screen.findByText(/The person has left, but the Google account is still active/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Suspend Google account' })).toBeVisible()
  })

  it('shows the recovery email hidden and sends the new one', async () => {
    const { user, fetchMock } = setup(status(), [
      { path: '/api/admin/employees/e1/google/recovery-email', method: 'GET', response: jsonResponse({ data: { recovery_email: 'b***@gmail.com' } }) },
      { path: '/api/admin/employees/e1/google/recovery-email', method: 'POST', response: jsonResponse({ data: true }) },
    ])
    await user.click(await screen.findByRole('button', { name: 'Change recovery email' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change Recovery Email' })
    expect(await within(dialog).findByText('Now: b***@gmail.com')).toBeVisible()
    const change = within(dialog).getByRole('button', { name: 'Change' })
    expect(change).toBeDisabled()
    // The account's own address cannot be its recovery email.
    await user.type(within(dialog).getByPlaceholderText('name@gmail.com'), 'ari@millennia21.id')
    expect(change).toBeDisabled()
    expect(within(dialog).getByText("That is the account's own address. Use another mailbox.")).toBeVisible()
    // Another mailbox of the organization is fine.
    await user.clear(within(dialog).getByPlaceholderText('name@gmail.com'))
    await user.type(within(dialog).getByPlaceholderText('name@gmail.com'), 'colleague@millennia21.id')
    expect(change).toBeEnabled()
    expect(within(dialog).getByText('An organization mailbox. Reset codes go to c***@millennia21.id.')).toBeVisible()
    await user.clear(within(dialog).getByPlaceholderText('name@gmail.com'))
    await user.type(within(dialog).getByPlaceholderText('name@gmail.com'), 'baru@gmail.com')
    await user.click(change)
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, options]) => String(url).endsWith('/google/recovery-email') && options.method === 'POST' && JSON.parse(options.body).recovery_email === 'baru@gmail.com'),
      ).toBe(true),
    )
  })

  it('restores a deleted account after asking', async () => {
    const { user, fetchMock } = setup(
      status({ status: 'MISSING', last_error: 'Deleted in Google, can be restored for about 20 days', restorable_until: new Date(Date.now() + 5 * 86_400_000).toISOString() }),
      [{ path: '/api/admin/employees/e1/google/restore', method: 'POST', response: jsonResponse({ data: { status: 'ACTIVE' } }) }],
    )
    await user.click(await screen.findByRole('button', { name: 'Restore Google account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restore Google Account' })
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith('/google/restore') && options.method === 'POST')).toBe(true))
  })

  it('suspends an active account after asking, and unsuspends a suspended one', async () => {
    const { user, fetchMock } = setup(status(), [
      { path: '/api/admin/employees/e1/google/suspend', method: 'POST', response: jsonResponse({ data: { status: 'SUSPENDED' } }) },
    ])
    expect(screen.queryByRole('button', { name: 'Restore Google account' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Suspend Google account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Suspend Google Account' })
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/google/suspend'))).toBe(true))
  })

  it('offers Unsuspend only for a suspended account', async () => {
    setup(status({ status: 'SUSPENDED', last_error: 'Suspended in Google' }))
    expect(await screen.findByRole('button', { name: 'Unsuspend Google account' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Suspend Google account' })).not.toBeInTheDocument()
  })

  it('shows a deleted account and how to bring it back', async () => {
    setup(status({ status: 'MISSING', last_error: 'Deleted in Google, can be restored for about 20 days', password_state: null }))
    expect(await screen.findByText('Deleted in Google')).toBeVisible()
    expect(screen.getByText(/Can be restored for about 20 days. Use Restore, then check again/)).toBeVisible()
  })

  it('counts down the days left to restore a deleted account', async () => {
    const until = new Date(Date.now() + 12 * 86_400_000 - 3_600_000).toISOString()
    setup(status({ status: 'MISSING', last_error: 'Deleted in Google, can be restored for about 20 days', restorable_until: until }))
    expect(await screen.findByText(/Can be restored for 12 more days, until/)).toBeVisible()
    expect(screen.queryByText(/^Deleted in Google, can be restored/)).not.toBeInTheDocument()
  })

  it('shows an account that is not in Google at all, and one that is suspended', async () => {
    setup(status({ status: 'MISSING', last_error: 'Not found in Google' }))
    expect(await screen.findByText('Not in Google')).toBeVisible()
    expect(screen.queryByText('Not found in Google')).not.toBeInTheDocument()
  })

  it('shows a suspended account', async () => {
    setup(status({ status: 'SUSPENDED', last_error: 'Suspended in Google' }))
    expect(await screen.findByText('Suspended')).toBeVisible()
    expect(screen.queryByText('Suspended in Google')).not.toBeInTheDocument()
  })

  it('shows whether the person has set their own password', async () => {
    setup(status({ password_state: 'PENDING' }))
    expect(await screen.findByText('Waiting for the first sign-in')).toBeVisible()
    expect(screen.queryByText('Password not set')).not.toBeInTheDocument()
  })

  it('flags a password that is still not set after a week', async () => {
    setup(status({ password_state: 'OVERDUE' }))
    expect(await screen.findByText('Password not set')).toBeVisible()
    expect(screen.getByTestId('google-password-note')).toHaveTextContent('Send the sign-in instructions again')
  })

  it('says when they signed in last once the password is set', async () => {
    setup(status({ password_state: 'SET', last_login_at: '2026-10-30T08:00:00.000Z' }))
    expect(await screen.findByText(/Signed in, last on 30 Oct 2026/)).toBeVisible()
  })

  it('looks at Google again when asked', async () => {
    const { user, fetchMock } = setup(status({ password_state: 'PENDING' }))
    await user.click(await screen.findByRole('button', { name: 'Check Google again' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('?refresh=true'))).toBe(true))
  })

  it('shows a linked account with the reset button only', async () => {
    setup(status())
    expect(await screen.findByText('Linked')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Make temporary password' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create Google account' })).not.toBeInTheDocument()
  })

  it('shows a failed account with the reason and a way to try again', async () => {
    setup(status({ linked: false, status: 'FAILED', last_error: 'Google refused the request (forbidden)' }))
    expect(await screen.findByText('Failed')).toBeVisible()
    expect(screen.getByText(/refused the request/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create Google account' })).toBeVisible()
  })

  it('says when this environment does not talk to the real Google', async () => {
    setup(status({ mode: 'simulated' }))
    expect(await screen.findByText('Simulated')).toBeVisible()
  })

  it('gives nobody but a Super Admin the buttons', async () => {
    globalThis.fetch = createFetchRouter([{ path: '/api/admin/employees/e1/google', response: jsonResponse({ data: status({ can: { create: false, manage: false, takeover: false } }) }) }])
    renderWithProviders(<GoogleAccountRow resource="employees" id="e1" email="ari@millennia21.id" />)
    expect(await screen.findByText('Linked')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('asks first, shows the new password once, and forgets it when closed', async () => {
    const { user } = setup(status(), [
      { path: '/api/admin/employees/e1/google/reset-password', method: 'POST', response: jsonResponse({ data: { password: 'Abcd1234Efgh5678' } }) },
    ])
    await user.click(await screen.findByRole('button', { name: 'Make temporary password' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Make Temporary Password' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Make' }))

    const result = await screen.findByRole('dialog', { name: 'Temporary Password' })
    expect(within(result).getByText('Abcd1234Efgh5678')).toBeVisible()
    await user.click(within(result).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('Abcd1234Efgh5678')).not.toBeInTheDocument())
  })

  it('sends the recovery email when the account is created', async () => {
    const { user, fetchMock } = setup(status({ linked: false, status: 'NONE' }), [
      { path: '/api/admin/employees/e1/google/provision', method: 'POST', response: jsonResponse({ data: { status: 'ACTIVE', outcome: 'created' } }) },
    ])
    await user.click(await screen.findByRole('button', { name: 'Create Google account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create Google Account' })
    await user.type(within(dialog).getByPlaceholderText('name@gmail.com'), 'me@gmail.com')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/google/provision'))
      expect(JSON.parse(call[1].body)).toEqual({ recovery_email: 'me@gmail.com' })
    })
  })

  it('lets a Super Admin open the sign-in instructions of a linked account', async () => {
    globalThis.fetch = createFetchRouter([{ path: '/api/admin/employees/e1/google', response: jsonResponse({ data: status() }) }])
    const { user } = renderWithProviders(<GoogleAccountRow resource="employees" id="e1" email="ari@millennia21.id" />)
    await user.click(await screen.findByRole('button', { name: 'Sign-in instructions' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign-in Instructions' })
    expect(within(dialog).getByText(/ari@millennia21\.id/)).toBeVisible()
    expect(within(dialog).getByText(/Forgot password/)).toBeVisible()
  })
})
