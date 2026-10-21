import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { HubAddressField } from '../../../src/features/application-access/components/HubAddressField.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const CHECK = /\/api\/admin\/application-access\/hub-address-check/

function renderField(verdict, props = {}, key = undefined, cookieName = undefined) {
  globalThis.fetch = createFetchRouter([{ path: CHECK, response: () => jsonResponse({ data: { verdict, key, cookie_name: cookieName } }) }])
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

  it('on an existing Hub, says the key is the one Central made and warns when it is another', async () => {
    const same = renderField('ok', {}, 'match')
    await same.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub, and its key is the one Central made.')).toBeVisible()
    same.unmount()

    const other = renderField('ok', {}, 'mismatch')
    await other.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    expect(screen.getByText(/runs with another key than the one made here/)).toBeVisible()
    expect(other.onChange).toHaveBeenLastCalledWith('https://app.mws.web.id', false)
  })

  it('compares the cookie name the running Hub reports with the one set in Central', async () => {
    const same = renderField('ok', { cookieName: 'hub_at' }, undefined, 'hub_at')
    await same.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('The running Hub uses the same cookie name.')).toBeVisible()
    same.unmount()

    const other = renderField('ok', { cookieName: 'hub_at' }, undefined, 'hub_at_stg')
    await other.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText(/The running Hub reports/)).toHaveTextContent('hub_at_stg')
    expect(screen.getByText(/The running Hub reports/)).toHaveTextContent('the setting here is hub_at')
    other.unmount()

    const old = renderField('ok', { cookieName: 'hub_at' })
    await old.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('This Hub does not report its cookie name yet.')).toBeVisible()
  })

  it('lets a Hub without the key go on only when the key is made in the wizard', async () => {
    const made = renderField('no_keys', { keyMadeHere: true })
    await made.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText(/does not have the key yet, which is fine/)).toBeVisible()
    expect(made.onChange).toHaveBeenLastCalledWith('https://app.mws.web.id', false)
    made.unmount()

    const own = renderField('no_keys')
    await own.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText(/A Hub answers here, but it has no sign-in key yet/)).toBeVisible()
    expect(own.onChange).toHaveBeenLastCalledWith('https://app.mws.web.id', true)
  })

  it('says nothing about the key while the key made in the wizard is not in the Hub yet', async () => {
    const view = renderField('ok', { keyMadeHere: true }, 'mismatch')
    await view.user.type(screen.getByLabelText('Hub Address'), 'app.mws.web.id')
    expect(await screen.findByText('Found the Hub.')).toBeVisible()
    expect(screen.queryByText(/runs with another key/)).toBeNull()
  })

  it('blocks an address that answers but is not the Hub, with no way around it', async () => {
    const { user, onChange } = renderField('not_hub')
    await user.type(screen.getByLabelText('Hub Address'), 'example.com')
    expect(await screen.findByText(/does not look like the Hub/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Use It Anyway' })).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith('https://example.com', true)
  })

  it('says a Hub has no sign-in key, and points to the guide for it', async () => {
    const { user, onChange } = renderField('no_keys')
    await user.type(screen.getByLabelText('Hub Address'), 'app-stg.mws.web.id')
    expect(await screen.findByText(/A Hub answers here, but it has no sign-in key yet/)).toBeVisible()
    expect(screen.getByText(/signing key lines/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'How To Fix' })).toHaveAttribute('href', '/application-access/guide?part=hub')
    // The address is right, so there is no way around it either: the key has to be set.
    expect(screen.queryByRole('button', { name: 'Use It Anyway' })).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith('https://app-stg.mws.web.id', true)
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
