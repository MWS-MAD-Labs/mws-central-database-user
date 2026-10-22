import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { GoogleShareDialog } from '../../../src/features/google/components/GoogleShareDialog.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const BASE = '/api/admin/employees/e1/google'
const PASSWORD = 'Abcd1234Efgh5678'

function setup({ emailEnabled = true, hint = 'p***@gmail.com', can = { create: true }, extra = [], emailAvailableAt = null } = {}) {
  const onClose = mock()
  const fetchMock = createFetchRouter([
    { path: BASE, response: jsonResponse({ data: { email_enabled: emailEnabled, can, email_available_at: emailAvailableAt } }) },
    { path: `${BASE}/recovery-hint`, response: jsonResponse({ data: { hint } }) },
    ...extra,
  ])
  globalThis.fetch = fetchMock
  const view = renderWithProviders(
    <ConfirmProvider>
      <GoogleShareDialog resource="employees" id="e1" name="Ari Putra" email="ari@millennia21.id" password={PASSWORD} onClose={onClose} />
    </ConfirmProvider>,
  )
  return { ...view, onClose, fetchMock }
}

const dialog = () => screen.findByRole('dialog', { name: 'Share Sign-in Details' })
const bodyOf = (fetchMock, suffix) => JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith(suffix))[1].body)

describe('GoogleShareDialog', () => {
  it('keeps the password off the screen, in the message too, until Show', async () => {
    const { user } = setup()
    const view = await dialog()
    const message = within(view).getByLabelText('Message')
    expect(within(view).getByTestId('google-temporary-password')).not.toHaveTextContent(PASSWORD)
    expect(message.value).toContain('Halo Ari Putra,')
    expect(message.value).not.toContain(PASSWORD)
    expect(message).toHaveAttribute('readonly')

    await user.click(within(view).getByRole('button', { name: 'Show' }))
    expect(within(view).getByTestId('google-temporary-password')).toHaveTextContent(PASSWORD)
    expect(message.value).toContain(`Password sementara: ${PASSWORD}`)
    expect(message).not.toHaveAttribute('readonly')

    await user.click(within(view).getByRole('button', { name: 'Hide' }))
    expect(message.value).not.toContain(PASSWORD)
  })

  it('copies the real password even while it is hidden, and what was edited after Show', async () => {
    const { user } = setup()
    const view = await dialog()
    await user.click(within(view).getByRole('button', { name: 'Copy Message' }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain(`Password sementara: ${PASSWORD}`))

    await user.click(within(view).getByRole('button', { name: 'Show' }))
    fireEvent.change(within(view).getByLabelText('Message'), { target: { value: `Halo Ari, pakai ${PASSWORD} ya` } })
    await user.click(within(view).getByRole('button', { name: 'Copy Message' }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`Halo Ari, pakai ${PASSWORD} ya`))

    await user.click(within(view).getByRole('tab', { name: 'English' }))
    expect(within(view).getByLabelText('Message').value).toContain('Hello Ari Putra,')
  })

  it('sends to the recovery email Google holds, shown hidden, without naming an address', async () => {
    const { user, fetchMock } = setup({
      extra: [{ path: `${BASE}/send-sign-in`, method: 'POST', response: jsonResponse({ data: { sent: true } }) }],
    })
    const view = await dialog()
    expect(await within(view).findByText('p***@gmail.com')).toBeVisible()
    await user.click(within(view).getByRole('button', { name: 'Send Email' }))
    await waitFor(() => expect(bodyOf(fetchMock, '/send-sign-in')).toEqual({ language: 'id', password: PASSWORD }))
  })

  it('lets the admin send to another address instead', async () => {
    const { user, fetchMock } = setup({
      extra: [{ path: `${BASE}/send-sign-in`, method: 'POST', response: jsonResponse({ data: { sent: true } }) }],
    })
    const view = await dialog()
    await user.click(await within(view).findByRole('button', { name: 'Use Another Address' }))
    await user.type(within(view).getByLabelText('Send to'), 'lain@gmail.com')
    await user.click(within(view).getByRole('button', { name: 'Send Email' }))
    await waitFor(() => expect(bodyOf(fetchMock, '/send-sign-in')).toEqual({ language: 'id', password: PASSWORD, to: 'lain@gmail.com' }))
  })

  it('says when the account has no recovery email, keeps Send Email off until an address is typed, and offers to add one', async () => {
    const { user, fetchMock } = setup({
      hint: null,
      extra: [{ path: `${BASE}/recovery-email`, method: 'POST', response: jsonResponse({ data: true }) }],
    })
    const view = await dialog()
    expect(await within(view).findByText(/This account has no recovery email/)).toBeVisible()
    expect(within(view).getByRole('button', { name: 'Send Email' })).toBeDisabled()

    await user.click(within(view).getByRole('button', { name: 'Add Recovery Email' }))
    await user.type(within(view).getByLabelText('Recovery email'), 'baru@gmail.com')
    await user.click(within(view).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(bodyOf(fetchMock, '/recovery-email')).toEqual({ recovery_email: 'baru@gmail.com' }))
  })

  it('does not offer to add one to an admin who may not make the account', async () => {
    setup({ hint: null, can: { create: false } })
    const view = await dialog()
    expect(await within(view).findByText(/This account has no recovery email/)).toBeVisible()
    expect(within(view).queryByRole('button', { name: 'Add Recovery Email' })).not.toBeInTheDocument()
  })

  it('turns Send Email off, with a reason, when the server has no email set up', async () => {
    setup({ emailEnabled: false })
    const view = await dialog()
    await waitFor(() => expect(within(view).getByRole('button', { name: 'Send Email' })).toBeDisabled())
    expect(within(view).getByRole('button', { name: 'Send Email' })).toHaveAttribute('title', 'Email is not set up on this server.')
  })

  it('asks before closing when nothing was copied or sent', async () => {
    const { user, onClose } = setup()
    const view = await dialog()
    await user.click(within(view).getByRole('button', { name: 'Done' }))
    const ask = await screen.findByRole('dialog', { name: 'Close Without Sharing' })
    await user.click(within(ask).getByRole('button', { name: 'Close Anyway' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
  it('keeps Send Email off, saying for how long, while the last mail for this person is recent', async () => {
    setup({ emailAvailableAt: new Date(Date.now() + 90_000).toISOString() })
    const view = await dialog()
    await waitFor(() => expect(within(view).getByRole('button', { name: 'Send Email' })).toBeDisabled())
    expect(within(view).getByRole('button', { name: 'Send Email' }).getAttribute('title')).toMatch(/^Wait 1:(2\d|30) to send again\.$/)
  })

  describe('for a student', () => {
    const guardians = [
      { id: 'p1', type: 'FATHER', full_name: 'Budi Santoso', is_primary: true, email_hint: 'b***@gmail.com', phone: '6281234567890' },
      { id: 'p2', type: 'MOTHER', full_name: 'Siti Aminah', is_primary: false, email_hint: 's***@gmail.com', phone: null },
    ]
    const renderStudent = (extra = []) => {
      const onClose = mock()
      const fetchMock = createFetchRouter([
        { path: '/api/admin/students/s1/google', response: jsonResponse({ data: { email_enabled: true, can: { create: true } } }) },
        ...extra,
      ])
      globalThis.fetch = fetchMock
      const view = renderWithProviders(
        <ConfirmProvider>
          <GoogleShareDialog resource="students" id="s1" name="Ari Putra" email="ari@millennia21.id" password={PASSWORD} guardians={guardians} guardianId="p1" onClose={onClose} />
        </ConfirmProvider>,
      )
      return { ...view, fetchMock }
    }

    it('writes to the chosen parent about the student, and shows who and the number for WhatsApp', async () => {
      const { user } = renderStudent()
      const view = await dialog()
      await user.click(within(view).getByRole('button', { name: 'Show' }))
      const message = within(view).getByLabelText('Message')
      expect(message.value).toContain('Yth. Bapak/Ibu Budi Santoso,')
      expect(message.value).toContain('untuk Ari Putra')
      expect(within(view).getByTestId('guardian-phone')).toHaveTextContent('6281234567890')

      await user.click(within(view).getAllByRole('radio')[1])
      expect(message.value).toContain('Yth. Bapak/Ibu Siti Aminah,')
      expect(within(view).queryByTestId('guardian-phone')).not.toBeInTheDocument()
    })

    it('mails the chosen parent by id, with no address typed, and offers no other address', async () => {
      const { user, fetchMock } = renderStudent([
        { path: '/api/admin/students/s1/google/send-sign-in', method: 'POST', response: jsonResponse({ data: { sent: true } }) },
      ])
      const view = await dialog()
      expect(within(view).queryByRole('button', { name: 'Use Another Address' })).not.toBeInTheDocument()
      expect(within(view).queryByLabelText('Send to')).not.toBeInTheDocument()
      await user.click(within(view).getAllByRole('radio')[1])
      await user.click(within(view).getByRole('button', { name: 'Send Email' }))
      await waitFor(() => expect(bodyOf(fetchMock, '/send-sign-in')).toEqual({ parent_id: 'p2', language: 'id', password: PASSWORD }))
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/recovery-hint'))).toBe(false)
    })
  })
})
