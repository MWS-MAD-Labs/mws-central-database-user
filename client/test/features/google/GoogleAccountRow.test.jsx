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
})
