import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { HubSecretTest } from '../../../src/features/application-access/components/HubSecretTest.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const SECRET = 'a'.repeat(32)

function renderTest(verdict) {
  const bodies = []
  globalThis.fetch = createFetchRouter([
    {
      path: '/api/admin/application-access/hub-secret-check',
      method: 'POST',
      response: ({ options }) => {
        bodies.push(JSON.parse(options.body))
        return jsonResponse({ data: { verdict } })
      },
    },
  ])
  const onReady = mock()
  const view = renderWithProviders(
    <ConfirmProvider>
      <HubSecretTest secret={`HUB_INTERNAL_SECRET="${SECRET}"`} address="https://app.mws.web.id" onReady={onReady} />
    </ConfirmProvider>,
  )
  return { ...view, onReady, bodies }
}

describe('HubSecretTest', () => {
  it('sends the clean value and opens the way on when the Hub accepts it', async () => {
    const { user, onReady, bodies } = renderTest('ok')
    await user.click(screen.getByRole('button', { name: 'Test This Secret' }))
    expect(await screen.findByText('The Hub accepts this secret.')).toBeVisible()
    expect(bodies).toEqual([{ address: 'https://app.mws.web.id', secret: SECRET }])
    expect(onReady).toHaveBeenLastCalledWith(true)
  })

  it('does not let a wrong secret through, with no way around it', async () => {
    const { user, onReady } = renderTest('wrong')
    await user.click(screen.getByRole('button', { name: 'Test This Secret' }))
    expect(await screen.findByText(/does not accept this secret/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Use It Anyway' })).toBeNull()
    expect(onReady).toHaveBeenLastCalledWith(false)
  })

  it('offers Use It Anyway when the Hub could not be asked', async () => {
    const { user, onReady } = renderTest('no_check')
    await user.click(screen.getByRole('button', { name: 'Test This Secret' }))
    expect(await screen.findByText(/has not been updated to check secrets/)).toBeVisible()
    expect(onReady).toHaveBeenLastCalledWith(false)
    await user.click(screen.getByRole('button', { name: 'Use It Anyway' }))
    const buttons = await screen.findAllByRole('button', { name: 'Use It Anyway' })
    await user.click(buttons.at(-1))
    expect(await screen.findByText('Used as typed, not verified.')).toBeVisible()
    expect(onReady).toHaveBeenLastCalledWith(true)
  })
})
