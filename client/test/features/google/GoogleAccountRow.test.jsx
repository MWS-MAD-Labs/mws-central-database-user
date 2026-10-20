import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { GoogleAccountRow } from '../../../src/features/google/components/GoogleAccountRow.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const status = (over = {}) => ({ linked: true, status: 'ACTIVE', synced_at: null, last_error: null, mode: 'google', ...over })

function setup(statusData, extraRoutes = []) {
  const fetchMock = createFetchRouter([
    { path: '/api/admin/employees/e1/google', response: jsonResponse({ data: statusData }) },
    ...extraRoutes,
  ])
  globalThis.fetch = fetchMock
  return { fetchMock, ...renderWithProviders(<GoogleAccountRow resource="employees" id="e1" canManage />) }
}

describe('GoogleAccountRow', () => {
  it('shows a deleted account and how to bring it back', async () => {
    setup(status({ status: 'MISSING', last_error: 'Deleted in Google, can be restored for about 20 days', password_state: null }))
    expect(await screen.findByText('Deleted in Google')).toBeVisible()
    expect(screen.getByText(/Restore it in the Admin Console, then check again/)).toBeVisible()
  })

  it('shows an account that is not in Google at all, and one that is suspended', async () => {
    setup(status({ status: 'MISSING', last_error: 'Not found in Google' }))
    expect(await screen.findByText('Not in Google')).toBeVisible()
  })

  it('shows a suspended account', async () => {
    setup(status({ status: 'SUSPENDED', last_error: 'Suspended in Google' }))
    expect(await screen.findByText('Suspended')).toBeVisible()
    expect(screen.getByText('Suspended in Google')).toBeVisible()
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
    expect(screen.getByRole('button', { name: 'Reset Google password' })).toBeVisible()
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
    globalThis.fetch = createFetchRouter([{ path: '/api/admin/employees/e1/google', response: jsonResponse({ data: status() }) }])
    renderWithProviders(<GoogleAccountRow resource="employees" id="e1" canManage={false} />)
    expect(await screen.findByText('Linked')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('asks first, shows the new password once, and forgets it when closed', async () => {
    const { user } = setup(status(), [
      { path: '/api/admin/employees/e1/google/reset-password', method: 'POST', response: jsonResponse({ data: { password: 'Abcd1234Efgh5678' } }) },
    ])
    await user.click(await screen.findByRole('button', { name: 'Reset Google password' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Reset Google Password' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Reset' }))

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
    const { user } = renderWithProviders(<GoogleAccountRow resource="employees" id="e1" email="ari@millennia21.id" canManage />)
    await user.click(await screen.findByRole('button', { name: 'Sign-in instructions' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign-in Instructions' })
    expect(within(dialog).getByText(/ari@millennia21\.id/)).toBeVisible()
    expect(within(dialog).getByText(/Forgot password/)).toBeVisible()
  })
})
