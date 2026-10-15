import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { HubAddressField } from '../../../src/features/application-access/components/HubAddressField.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const CHECK = /\/api\/admin\/application-access\/hub-address-check/

function renderField(verdict, props = {}) {
  globalThis.fetch = createFetchRouter([{ path: CHECK, response: () => jsonResponse({ data: { verdict } }) }])
  const onChange = mock()
  return { onChange, ...renderWithProviders(
      <ConfirmProvider>
        <HubAddressField value="" onChange={onChange} {...props} />
      </ConfirmProvider>,
    ) }
}

describe('HubAddressField', () => {
  it('turns green and allows the address when the Hub answers', async () => {
    const { user, onChange } = renderField('ok')
    await user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith('https://app.mws.web.id', false)
  })

  it('blocks an address that answers but is not the Hub, with no way around it', async () => {
    const { user, onChange } = renderField('not_hub')
    await user.type(screen.getByLabelText('Hub Address'), 'example.com')
    expect(await screen.findByText(/does not look like the Hub/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Use It Anyway' })).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith('https://example.com', true)
  })

  it('offers Use It Anyway only when nothing answers', async () => {
    const { user, onChange } = renderField('unreachable')
    await user.type(screen.getByLabelText('Hub Address'), 'hub.mws.web.id')
    expect(await screen.findByText(/Nothing answers at this address/)).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith('https://hub.mws.web.id', true)
    await user.click(screen.getByRole('button', { name: 'Use It Anyway' }))
    const buttons = await screen.findAllByRole('button', { name: 'Use It Anyway' })
    await user.click(buttons.at(-1))
    expect(await screen.findByText('Used as typed, not checked.')).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith('https://hub.mws.web.id', false)
  })

  it('rejects a local address on Public HTTPS without asking the server', async () => {
    const { user, onChange } = renderField('ok')
    await user.type(screen.getByLabelText('Hub Address'), 'localhost:5175')
    expect(await screen.findByText(/That is a local address/)).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith('', true)
  })

  it('does not ask again about the address that is already saved', async () => {
    const { onChange } = renderField('not_hub', { value: 'https://app.mws.web.id' })
    expect(onChange).toHaveBeenLastCalledWith('https://app.mws.web.id', false)
    expect(screen.queryByText('Checking the address…')).toBeNull()
  })
})
