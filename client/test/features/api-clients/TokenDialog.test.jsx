import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { TokenDialog } from '../../../src/features/api-clients/components/TokenDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

const client = {
  name: 'Unmapped legacy integration',
  new_token: 'mws_47d0b31fa20c-secret-token',
  new_token_prefix: 'mws_47d0b31fa20c',
  effective_scopes: ['employees:read'],
}

function setClipboard(writeText) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true })
}

// userEvent.setup() inside renderWithProviders installs its own clipboard, so the test one goes in after it.
function renderDialog(clipboard, onClose = mock(() => {}), overrides = {}, rotation) {
  const view = renderWithProviders(
    <TokenDialog title="Rotated Credentials" client={{ ...client, ...overrides }} rotation={rotation} onClose={onClose} />,
  )
  setClipboard(clipboard)
  return { ...view, onClose }
}

afterEach(() => setClipboard(undefined))

describe('TokenDialog', () => {
  it('never shows the whole token: its start and end, and one big button', () => {
    renderDialog(mock(async () => {}))
    const hidden = screen.getByRole('img', { name: 'Token hidden, copy it with the button' })
    expect(hidden).toHaveTextContent('mws_47d0b3••••••••••••oken')
    expect(hidden.style.userSelect).toBe('none')
    expect(screen.queryByText('mws_47d0b31fa20c-secret-token')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy Token' })).toBeVisible()
    expect(screen.getByText('Shown Once')).toBeVisible()
  })

  it('copies on one click and closes by itself', async () => {
    const writeText = mock(async () => {})
    const { onClose } = renderDialog(writeText)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('mws_47d0b31fa20c-secret-token'))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2000 })
  })

  it('stays open and offers a field to copy by hand when the clipboard is blocked', async () => {
    const { onClose } = renderDialog(mock(async () => { throw new Error('denied') }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    const field = await screen.findByRole('textbox', { name: 'Token to copy by hand' })
    expect(field).toHaveValue('mws_47d0b31fa20c-secret-token')
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when there is no clipboard at all', async () => {
    const { onClose } = renderDialog(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Token' }))
    expect(await screen.findByRole('textbox', { name: 'Token to copy by hand' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks before closing a token that was not copied, and keeps it open on request', () => {
    const { onClose } = renderDialog(mock(async () => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Close Dialog' }))
    expect(screen.getByText('This token will not be shown again.')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Open' }))
    expect(screen.queryByText('This token will not be shown again.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close Dialog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Anyway' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes without asking when there is no token to lose', () => {
    const { onClose } = renderDialog(undefined, undefined, { new_token: undefined })
    expect(screen.getByText('Token was not returned by the server.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close Dialog' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says until when the old token is valid after a graceful rotation', () => {
    const retiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    renderDialog(mock(async () => {}), undefined, {
      credentials: [
        { token_prefix: 'mws_new', status: 'ACTIVE' },
        { token_prefix: 'mws_old', status: 'RETIRING', expires_at: retiresAt },
      ],
    }, 'graceful')
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Old Token Still Works For A While')
    expect(note).toHaveTextContent('mws_old')
    expect(note).toHaveTextContent('After that only the new token works')
  })

  it('says the old token stopped after an emergency rotation', () => {
    renderDialog(mock(async () => {}), undefined, {
      credentials: [
        { token_prefix: 'mws_new', status: 'ACTIVE' },
        { token_prefix: 'mws_old', status: 'REVOKED', revoked_at: new Date().toISOString() },
      ],
    }, 'emergency')
    expect(screen.getByRole('note')).toHaveTextContent('Old token mws_old stopped working just now')
  })

  it('shows no note for a new client', () => {
    renderDialog(mock(async () => {}))
    expect(screen.queryByRole('note')).toBeNull()
  })
})
