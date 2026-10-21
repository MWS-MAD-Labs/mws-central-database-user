import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EmailCheckNote } from '../../../src/features/google/components/EmailCheckNote.jsx'
import { useEmailCheck } from '../../../src/features/google/hooks/useEmailCheck.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function Harness({ initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail)
  const check = useEmailCheck(email, { initialEmail })
  return (
    <div>
      <input aria-label="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <EmailCheckNote check={check} />
      <button disabled={check.blocked}>Create</button>
    </div>
  )
}

const answer = (data) => ({ path: /\/api\/admin\/google\/email-availability/, response: jsonResponse({ data }) })
const calls = (fetchMock) => fetchMock.mock.calls.filter(([url]) => String(url).includes('email-availability')).length

describe('checking an email with the button', () => {
  it('says nothing and blocks nothing until there is a whole valid email', async () => {
    globalThis.fetch = createFetchRouter([answer({ available: true, reason: 'FREE', message: 'Available' })])
    renderWithProviders(<Harness />)
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    await userEvent.type(screen.getByLabelText('email'), 'ari.')
    expect(screen.queryByTestId('email-check')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument()
  })

  it('asks nothing while typing, holds Create, and asks once when Check is pressed', async () => {
    const fetchMock = createFetchRouter([answer({ available: true, reason: 'FREE', message: 'Available' })])
    globalThis.fetch = fetchMock
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByLabelText('email'), 'ari@millennia21.id')
    expect(screen.getByText('Check the email before saving.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(calls(fetchMock)).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Available')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument()
    expect(calls(fetchMock)).toBe(1)
  })

  it('makes the answer stale as soon as the email changes', async () => {
    globalThis.fetch = createFetchRouter([answer({ available: true, reason: 'FREE', message: 'Available' })])
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByLabelText('email'), 'ari@millennia21.id')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    await screen.findByText('Available')
    await userEvent.type(screen.getByLabelText('email'), 'x')
    expect(screen.getByText('Check the email before saving.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('keeps Create disabled for an email Google or Central already has, or that is not allowed here', async () => {
    for (const [reason, message] of [
      ['IN_GOOGLE', 'This email already has a Google account'],
      ['IN_CENTRAL', 'This email is already used in Central'],
      ['DELETED_IN_GOOGLE', 'This email belongs to a Google account that was deleted less than 20 days ago, so it cannot be reused yet'],
      ['NOT_ALLOWED', 'Outside production only test addresses starting with "test.central." are sent to Google'],
    ]) {
      globalThis.fetch = createFetchRouter([answer({ available: false, reason, message })])
      const { unmount } = renderWithProviders(<Harness />)
      await userEvent.type(screen.getByLabelText('email'), `${reason.toLowerCase()}@millennia21.id`)
      await userEvent.click(screen.getByRole('button', { name: 'Check' }))
      expect(await screen.findByText(message)).toBeVisible()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
      unmount()
    }
  })

  it('lets it through when Google was not asked or could not be', async () => {
    globalThis.fetch = createFetchRouter([answer({ available: true, reason: 'NOT_CHECKED', message: 'Not checked against Google in this environment' })])
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByLabelText('email'), 'ari@millennia21.id')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText(/Not checked against Google/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('keeps Create off, and lets the person try again, when the request itself failed', async () => {
    globalThis.fetch = createFetchRouter([{ path: /email-availability/, response: jsonResponse({ message: 'down' }, 500) }])
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByLabelText('email'), 'ari@millennia21.id')
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Could not check the email, try again.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check' })).toBeVisible()
  })

  it('lets the email an edit form started with through without asking', async () => {
    const fetchMock = createFetchRouter([answer({ available: false, reason: 'IN_CENTRAL', message: 'no' })])
    globalThis.fetch = fetchMock
    renderWithProviders(<Harness initialEmail="ari@millennia21.id" />)
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    await userEvent.type(screen.getByLabelText('email'), 'x')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled())
    expect(calls(fetchMock)).toBe(0)
  })
})
