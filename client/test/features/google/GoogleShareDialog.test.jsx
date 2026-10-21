import { describe, expect, it } from 'bun:test'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { GoogleShareDialog } from '../../../src/features/google/components/GoogleShareDialog.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { mock } from 'bun:test'

const STATUS = '/api/admin/employees/e1/google'

function setup({ emailEnabled = true, extra = [], defaultTo = 'pribadi@gmail.com' } = {}) {
  const onClose = mock()
  const fetchMock = createFetchRouter([
    { path: STATUS, response: jsonResponse({ data: { email_enabled: emailEnabled } }) },
    ...extra,
  ])
  globalThis.fetch = fetchMock
  const view = renderWithProviders(
    <ConfirmProvider>
      <GoogleShareDialog resource="employees" id="e1" name="Ari Putra" email="ari@millennia21.id" password="Abcd1234Efgh5678" defaultTo={defaultTo} onClose={onClose} />
    </ConfirmProvider>,
  )
  return { ...view, onClose, fetchMock }
}

describe('GoogleShareDialog', () => {
  it('hides the password until Show and greets the person in the message', async () => {
    setup()
    const dialog = await screen.findByRole('dialog', { name: 'Share Sign-in Details' })
    expect(within(dialog).getByTestId('google-temporary-password')).not.toHaveTextContent('Abcd1234Efgh5678')
    expect(within(dialog).getByLabelText('Message').value).toContain('Halo Ari Putra,')
    expect(within(dialog).getByLabelText('Message').value).toContain('Password sementara: Abcd1234Efgh5678')
  })

  it('copies what was edited, not the original text, and writes English when asked', async () => {
    const { user } = setup()
    const dialog = await screen.findByRole('dialog', { name: 'Share Sign-in Details' })
    fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'Halo Ari, ini pesan yang saya ubah' } })
    await user.click(within(dialog).getByRole('button', { name: 'Copy Message' }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('Halo Ari, ini pesan yang saya ubah'))

    await user.click(within(dialog).getByRole('tab', { name: 'English' }))
    expect(within(dialog).getByLabelText('Message').value).toContain('Hello Ari Putra,')
  })

  it('mails the details to the address typed, with the language and password, and nothing else', async () => {
    const { user, fetchMock } = setup({
      extra: [{ path: `${STATUS}/send-sign-in`, method: 'POST', response: jsonResponse({ data: { sent: true } }) }],
    })
    const dialog = await screen.findByRole('dialog', { name: 'Share Sign-in Details' })
    await user.click(within(dialog).getByRole('button', { name: 'Send Email' }))
    expect(within(dialog).getByLabelText('Send to')).toHaveValue('pribadi@gmail.com')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/google/send-sign-in'))
      expect(JSON.parse(call[1].body)).toEqual({ to: 'pribadi@gmail.com', language: 'id', password: 'Abcd1234Efgh5678' })
    })
  })

  it('turns Send Email off, with a reason, when the server has no email set up', async () => {
    setup({ emailEnabled: false })
    const dialog = await screen.findByRole('dialog', { name: 'Share Sign-in Details' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Send Email' })).toBeDisabled())
    expect(within(dialog).getByRole('button', { name: 'Send Email' })).toHaveAttribute('title', 'Email is not set up on this server.')
  })

  it('asks before closing when nothing was copied or sent', async () => {
    const { user, onClose } = setup()
    const dialog = await screen.findByRole('dialog', { name: 'Share Sign-in Details' })
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    const ask = await screen.findByRole('dialog', { name: 'Close Without Sharing' })
    await user.click(within(ask).getByRole('button', { name: 'Close Anyway' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
