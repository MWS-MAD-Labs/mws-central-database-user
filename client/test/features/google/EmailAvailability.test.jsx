import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EmailAvailabilityNote } from '../../../src/features/google/components/EmailAvailabilityNote.jsx'
import { useEmailAvailability } from '../../../src/features/google/hooks/useEmailAvailability.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function Harness({ enabled = true }) {
  const [email, setEmail] = useState('')
  const availability = useEmailAvailability(email, { enabled })
  return (
    <div>
      <input aria-label="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <EmailAvailabilityNote availability={availability} />
      <button disabled={availability.blocked}>Create</button>
    </div>
  )
}

const answer = (data) => ({ path: /\/api\/admin\/google\/email-availability/, response: jsonResponse({ data }) })

describe('email availability while creating', () => {
  it('says nothing and blocks nothing until there is a whole valid email', async () => {
    globalThis.fetch = createFetchRouter([answer({ available: true, reason: 'FREE', message: 'Available' })])
    renderWithProviders(<Harness />)
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    await userEvent.type(screen.getByLabelText('email'), 'ari.')
    expect(screen.queryByTestId('email-availability')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('holds Create while it checks, then lets it through for a free email', async () => {
    globalThis.fetch = createFetchRouter([answer({ available: true, reason: 'FREE', message: 'Available' })])
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByLabelText('email'), 'ari@millennia21.id')
    expect(screen.getByText('Checking...')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(await screen.findByText('Available')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('keeps Create disabled for an email Google or Central already has, or that is not allowed here', async () => {
    for (const [reason, message] of [
      ['IN_GOOGLE', 'This email already has a Google account'],
      ['IN_CENTRAL', 'This email is already used in Central'],
      ['NOT_ALLOWED', 'Outside production only test addresses starting with "test.central." are sent to Google'],
    ]) {
      globalThis.fetch = createFetchRouter([answer({ available: false, reason, message })])
      const { unmount } = renderWithProviders(<Harness />)
      await userEvent.type(screen.getByLabelText('email'), `${reason.toLowerCase()}@millennia21.id`)
      expect(await screen.findByText(message)).toBeVisible()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
      unmount()
    }
  })

  it('does not block when Google was not asked or could not be', async () => {
    globalThis.fetch = createFetchRouter([answer({ available: true, reason: 'NOT_CHECKED', message: 'Not checked against Google in this environment' })])
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByLabelText('email'), 'ari@millennia21.id')
    expect(await screen.findByText(/Not checked against Google/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('does not ask at all when it is not a create form', async () => {
    const fetchMock = createFetchRouter([answer({ available: false, reason: 'IN_GOOGLE', message: 'no' })])
    globalThis.fetch = fetchMock
    renderWithProviders(<Harness enabled={false} />)
    await userEvent.type(screen.getByLabelText('email'), 'ari@millennia21.id')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled())
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('email-availability'))).toBe(false)
  })
})
