import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { HubSettingsCard } from '../../../src/features/application-access/components/HubSettingsCard.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const CHECK = /\/api\/admin\/application-access\/hub-address-check/
const settings = { hub_access_mode: 'warn', hub_bypass_emails: [], hub_access_cookie_name: 'hub_at_stg' }
const hub = { base_url: 'https://app-stg.mws.web.id', secret_set: true }

function renderCard(data, props = {}) {
  const calls = []
  globalThis.fetch = createFetchRouter([{ path: CHECK, response: () => { calls.push(1); return jsonResponse({ data }) } }])
  return { calls, ...renderWithProviders(<HubSettingsCard settings={settings} hub={hub} applicationId="hub" {...props} />) }
}

describe('HubSettingsCard Check Hub', () => {
  it('asks the running Hub only when pressed, and warns when its cookie name differs', async () => {
    const { user, calls } = renderCard({ verdict: 'ok', key: 'unknown', cookie_name: 'hub_at' })
    expect(calls).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Check Hub' }))
    expect(await screen.findByText(/The running Hub reports/)).toHaveTextContent('hub_at')
    expect(screen.getByText(/The running Hub reports/)).toHaveTextContent('the setting here is hub_at_stg')
  })

  it('says so when the names match', async () => {
    const { user } = renderCard({ verdict: 'ok', key: 'unknown', cookie_name: 'hub_at_stg' })
    await user.click(screen.getByRole('button', { name: 'Check Hub' }))
    expect(await screen.findByText('The running Hub uses the same cookie name.')).toBeVisible()
  })

  it('says the name is not known when the Hub does not answer', async () => {
    const { user } = renderCard({ verdict: 'unreachable', key: 'unknown', cookie_name: null })
    await user.click(screen.getByRole('button', { name: 'Check Hub' }))
    expect(await screen.findByText('The Hub did not answer just now, so its cookie name is not known.')).toBeVisible()
  })

  it('cannot be pressed before the Hub has an address', () => {
    renderCard({}, { hub: { base_url: '', secret_set: false } })
    expect(screen.getByRole('button', { name: 'Check Hub' })).toBeDisabled()
  })
})
