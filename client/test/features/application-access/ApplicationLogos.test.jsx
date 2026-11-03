import { beforeEach, describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { ApplicationLogosPanel } from '../../../src/features/application-access/components/ApplicationLogosPanel.jsx'
import { IconPicker } from '../../../src/features/application-access/components/IconPicker.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const logos = [
  { id: 'logo-1', name: 'Millennia', width: 256, height: 256, bytes: 9000, version: 1, used_by: [{ application_id: 'daily', name: 'Daily Check-in' }, { application_id: 'mtss', name: 'MTSS' }], created_at: '2026-11-01T00:00:00.000Z' },
  { id: 'logo-2', name: 'Safespace', width: 256, height: 256, bytes: 7000, version: 1, used_by: [], created_at: '2026-11-02T00:00:00.000Z' },
]

// The same routes every time: the list, and the picture of each logo.
function routes(extra = []) {
  return [
    ...extra,
    { path: '/api/admin/application-logos', method: 'GET', response: () => jsonResponse({ data: logos }) },
    { path: /\/api\/admin\/application-logos\/[^/]+\/image$/, response: () => new Response(new Blob(['x'], { type: 'image/webp' }), { headers: { 'content-type': 'image/webp' } }) },
  ]
}

beforeEach(() => {
  URL.createObjectURL = () => 'blob:logo'
  URL.revokeObjectURL = () => undefined
})

function renderPanel() {
  return renderWithProviders(<ConfirmProvider><ApplicationLogosPanel /></ConfirmProvider>)
}

describe('ApplicationLogosPanel', () => {
  it('lists the logos with how many applications use each', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPanel()
    expect(await screen.findByText('Millennia')).toBeVisible()
    expect(screen.getByText('Used By 2')).toBeVisible()
    expect(screen.getByText('Safespace')).toBeVisible()
    expect(screen.getByText('Not used')).toBeVisible()
  })

  it('adds a logo: the name follows the file until it is typed, and the file goes up as a form', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-logos', method: 'POST', response: () => jsonResponse({ data: logos[0] }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPanel()
    await screen.findByText('Millennia')
    await user.click(screen.getByRole('button', { name: 'Add Logo' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Logo' })
    const submit = within(dialog).getByRole('button', { name: 'Add Logo' })
    expect(submit).toBeDisabled()

    await user.upload(within(dialog).getByLabelText('Picture'), new File(['x'], 'northstar.png', { type: 'image/png' }))
    expect(within(dialog).getByDisplayValue('northstar')).toBeVisible()
    await user.click(submit)

    const post = await waitFor(() => fetchMock.mock.calls.find(([, options]) => options?.method === 'POST'))
    expect(post[1].body).toBeInstanceOf(FormData)
    expect(post[1].body.get('name')).toBe('northstar')
    expect(post[1].body.get('file').name).toBe('northstar.png')
  })

  it('refuses a picture over 2 MB before sending it', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPanel()
    await screen.findByText('Millennia')
    await user.click(screen.getByRole('button', { name: 'Add Logo' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Logo' })
    const big = new File(['x'], 'big.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
    await user.upload(within(dialog).getByLabelText('Picture'), big)
    expect(within(dialog).getByText('The picture is too large, 2 MB at most.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Add Logo' })).toBeDisabled()
  })

  it('deletes after a confirm, and renames', async () => {
    const fetchMock = createFetchRouter(routes([
      { path: '/api/admin/application-logos/logo-2', method: 'DELETE', response: () => jsonResponse({ data: { id: 'logo-2' } }) },
      { path: '/api/admin/application-logos/logo-2', method: 'PATCH', response: () => jsonResponse({ data: logos[1] }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderPanel()
    await screen.findByText('Safespace')

    await user.click(screen.getByRole('button', { name: 'Rename Safespace' }))
    const dialog = screen.getByRole('dialog', { name: 'Rename Logo' })
    const input = within(dialog).getByDisplayValue('Safespace')
    await user.clear(input)
    await user.type(input, 'Safespace Kids')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' && JSON.parse(options.body).name === 'Safespace Kids')).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Delete Safespace' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true))
  })
})

describe('IconPicker with logos', () => {
  it('offers the logos above the icons, and picking one or the other reports which', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const picked = []
    const { user } = renderWithProviders(
      <IconPicker value="" logoId="" onChange={(icon) => picked.push(['icon', icon])} onPickLogo={(id) => picked.push(['logo', id])} />,
    )
    await user.click(screen.getByRole('button', { name: 'Icon' }))
    const logoList = await screen.findByRole('listbox', { name: 'Logos' })
    await user.click(within(logoList).getByRole('option', { name: 'Millennia' }))
    expect(picked).toEqual([['logo', 'logo-1']])

    await user.click(screen.getByRole('button', { name: 'Icon' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Icons' })).getAllByRole('option')[0])
    expect(picked[1][0]).toBe('icon')
  })

  it('shows no Logos section when none are asked for or none exist', async () => {
    globalThis.fetch = createFetchRouter([{ path: '/api/admin/application-logos', method: 'GET', response: () => jsonResponse({ data: [] }) }])
    const { user } = renderWithProviders(<IconPicker value="" onChange={() => undefined} onPickLogo={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Icon' }))
    expect(screen.queryByRole('listbox', { name: 'Logos' })).toBeNull()
  })
})
