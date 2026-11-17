import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangeEmailDialog } from '../../../src/features/google/components/ChangeEmailDialog.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const field = (name) => document.querySelector(`[data-field="${name}"]`)

function setup() {
  const onClose = mock()
  const fetchMock = createFetchRouter([
    { path: /\/api\/admin\/google\/email-availability/, response: jsonResponse({ data: { available: true, reason: 'FREE', message: 'Available' } }) },
    { path: '/api/admin/employees/e1/change-email', method: 'POST', response: jsonResponse({ data: { id: 'e1', email: 'ari.baru@millennia21.id' } }) },
  ])
  globalThis.fetch = fetchMock
  renderWithProviders(
    <ConfirmProvider>
      <ChangeEmailDialog resource="employees" id="e1" currentEmail="ari.lama@millennia21.id" name="Ari" onClose={onClose} />
    </ConfirmProvider>,
  )
  return { onClose, fetchMock }
}

describe('ChangeEmailDialog', () => {
  it('shows the current email and keeps Change Email off until everything is filled in and checked', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Change Email' })
    expect(within(dialog).getByText('ari.lama@millennia21.id')).toBeVisible()
    const submit = within(dialog).getByRole('button', { name: 'Change Email' })
    expect(submit).toBeDisabled()
    expect(field('new_email_again').querySelector('input')).toBeDisabled()

    await user.type(field('new_email_local').querySelector('input'), 'ari.baru')
    await user.click(within(dialog).getByRole('button', { name: 'Check' }))
    await screen.findByText('Available')
    expect(submit).toBeDisabled()

    await user.type(field('new_email_again').querySelector('input'), 'ari.baru')
    expect(submit).toBeDisabled()
    await user.type(field('email_change_reason').querySelector('textarea'), 'Name was misspelt')
    expect(submit).toBeEnabled()
  })

  it('does not take the current email, and wants the two entries to match', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(field('new_email_local').querySelector('input'), 'ari.lama')
    expect(screen.getByText('That is the current email.')).toBeVisible()
    await user.clear(field('new_email_local').querySelector('input'))
    await user.type(field('new_email_local').querySelector('input'), 'ari.baru')
    await user.type(field('new_email_again').querySelector('input'), 'ari.bar')
    expect(screen.getByText('The two emails do not match.')).toBeVisible()
  })

  it('sends the new email with the reason, then closes', async () => {
    const user = userEvent.setup()
    const { onClose, fetchMock } = setup()
    const dialog = screen.getByRole('dialog', { name: 'Change Email' })
    await user.type(field('new_email_local').querySelector('input'), 'ari.baru')
    await user.click(within(dialog).getByRole('button', { name: 'Check' }))
    await screen.findByText('Available')
    await user.type(field('new_email_again').querySelector('input'), 'ari.baru')
    await user.type(field('email_change_reason').querySelector('textarea'), 'Name was misspelt')
    await user.click(within(dialog).getByRole('button', { name: 'Change Email' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/employees/e1/change-email')
    expect(JSON.parse(call[1].body)).toEqual({ email: 'ari.baru@millennia21.id', reason: 'Name was misspelt' })
  })
  function setupFor({ availability }) {
    const fetchMock = createFetchRouter([
      { path: /\/api\/admin\/google\/email-availability/, response: () => jsonResponse({ data: availability() }) },
      { path: '/api/admin/employees/e1/change-email', method: 'POST', response: jsonResponse({ data: { id: 'e1', email: 'ari.baru@millennia21.id' } }) },
    ])
    globalThis.fetch = fetchMock
    renderWithProviders(
      <ConfirmProvider>
        <ChangeEmailDialog resource="employees" id="e1" currentEmail="ari.lama@millennia21.id" name="Ari" onClose={mock()} />
      </ConfirmProvider>,
    )
    return fetchMock
  }
  const typeAndCheck = async (user) => {
    const dialog = screen.getByRole('dialog', { name: 'Change Email' })
    await user.type(field('new_email_local').querySelector('input'), 'ari.baru')
    await user.click(within(dialog).getByRole('button', { name: 'Check' }))
    return dialog
  }

  it('asks about the person, and does not hold back an address on their own Google account', async () => {
    const user = userEvent.setup()
    const fetchMock = setupFor({ availability: () => ({ available: true, reason: 'OWN_GOOGLE', message: "This is already the person's Google account" }) })
    const dialog = await typeAndCheck(user)
    await screen.findByText(/already the person's Google account/)
    expect(within(dialog).queryByRole('button', { name: 'Unlink Google' })).not.toBeInTheDocument()
    await user.type(field('new_email_again').querySelector('input'), 'ari.baru')
    await user.type(field('email_change_reason').querySelector('textarea'), 'Renamed in Workspace')
    expect(within(dialog).getByRole('button', { name: 'Change Email' })).toBeEnabled()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('kind=employee&id=e1'))).toBe(true)
  })

  it('has no Unlink Google when another Google account has the address', async () => {
    const user = userEvent.setup()
    setupFor({ availability: () => ({ available: false, reason: 'IN_GOOGLE', message: 'This email already has a Google account' }) })
    const dialog = await typeAndCheck(user)
    await screen.findByText('This email already has a Google account')
    expect(within(dialog).queryByRole('button', { name: 'Unlink Google' })).not.toBeInTheDocument()
  })
})
