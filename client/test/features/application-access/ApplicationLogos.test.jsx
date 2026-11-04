import { StrictMode } from 'react'
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

// What the preview was made from and which addresses were let go, so a picture on a let-go address can be told apart.
const madeFrom = []
const letGo = new Set()
let handedOut = 0
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const svgFile = (name) => new File(['<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'], name, { type: 'image/png' })

beforeEach(() => {
  madeFrom.length = 0
  letGo.clear()
  handedOut = 0
  URL.createObjectURL = (blob) => {
    madeFrom.push(blob.type)
    return `blob:logo-${++handedOut}`
  }
  URL.revokeObjectURL = (address) => letGo.add(address)
})

function renderPanel() {
  return renderWithProviders(<StrictMode><ConfirmProvider><ApplicationLogosPanel /></ConfirmProvider></StrictMode>)
}

describe('ApplicationLogosPanel', () => {
  it('lists the logos with how many applications use each', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPanel()
    expect(await screen.findByText('Millennia')).toBeVisible()
    expect(screen.getByText('Used by 2')).toBeVisible()
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

    await user.upload(within(dialog).getByLabelText('Picture'), new File([PNG_BYTES], 'northstar.png', { type: 'image/png' }))
    expect(within(dialog).getByDisplayValue('northstar')).toBeVisible()
    await user.click(submit)

    const post = await waitFor(() => fetchMock.mock.calls.find(([, options]) => options?.method === 'POST'))
    expect(post[1].body).toBeInstanceOf(FormData)
    expect(post[1].body.get('name')).toBe('northstar')
    expect(post[1].body.get('file').name).toBe('northstar.png')
  })

  it('reads what the file is, not its name: an SVG named .png is previewed as an SVG and accepted', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPanel()
    await screen.findByText('Millennia')
    await user.click(screen.getByRole('button', { name: 'Add Logo' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Logo' })
    await user.upload(within(dialog).getByLabelText('Picture'), svgFile('Logo (1).png'))

    await waitFor(() => expect(within(dialog).getByLabelText('How the logo will look').querySelector('img')).not.toBeNull())
    expect(madeFrom.at(-1)).toBe('image/svg+xml')
    expect(within(dialog).getByDisplayValue('Logo (1)')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Add Logo' })).toBeEnabled()
  })

  it('says so when the file is not a picture, instead of a broken preview', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPanel()
    await screen.findByText('Millennia')
    await user.click(screen.getByRole('button', { name: 'Add Logo' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Logo' })
    await user.upload(within(dialog).getByLabelText('Picture'), new File(['just some words'], 'notes.png', { type: 'image/png' }))

    expect(await within(dialog).findByText('Only SVG or PNG files can be used as a logo.')).toBeVisible()
    expect(within(dialog).getByLabelText('How the logo will look').querySelector('img')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Add Logo' })).toBeDisabled()
  })

  it('turns down a JPG even when it is named .png', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPanel()
    await screen.findByText('Millennia')
    await user.click(screen.getByRole('button', { name: 'Add Logo' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Logo' })
    await user.upload(within(dialog).getByLabelText('Picture'), new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], 'logo.png', { type: 'image/png' }))
    expect(await within(dialog).findByText('Only SVG or PNG files can be used as a logo.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Add Logo' })).toBeDisabled()
  })

  it('previews on an address that stays good, and lets go of old ones', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPanel()
    await screen.findByText('Millennia')
    await user.click(screen.getByRole('button', { name: 'Add Logo' }))
    const dialog = screen.getByRole('dialog', { name: 'Add Logo' })
    const input = within(dialog).getByLabelText('Picture')
    const preview = () => within(dialog).getByLabelText('How the logo will look').querySelector('img')

    await user.upload(input, new File([PNG_BYTES], 'first.png', { type: 'image/png' }))
    await waitFor(() => expect(preview()).not.toBeNull())
    const first = preview().getAttribute('src')
    expect(letGo.has(first)).toBe(false)

    await user.upload(input, new File([PNG_BYTES], 'second.png', { type: 'image/png' }))
    await waitFor(() => expect(preview().getAttribute('src')).not.toBe(first))
    const second = preview().getAttribute('src')
    expect(letGo.has(first)).toBe(true)
    expect(letGo.has(second)).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Close Dialog' }))
    expect(letGo.has(second)).toBe(true)
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
    expect(await within(dialog).findByText('The file is too large, 2 MB at most.')).toBeVisible()
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
  it('keeps icons on the Icon tab and logos on the Upload tab, and reports which was picked', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const picked = []
    const { user } = renderWithProviders(
      <IconPicker value="" logoId="" onChange={(icon) => picked.push(['icon', icon])} onPickLogo={(id) => picked.push(['logo', id])} />,
    )
    await user.click(screen.getByRole('button', { name: 'Logo' }))
    expect(screen.getByRole('tab', { name: 'Icon' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('listbox', { name: 'Logos' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    const logoList = await screen.findByRole('listbox', { name: 'Logos' })
    await user.click(within(logoList).getByRole('option', { name: 'Millennia' }))
    expect(picked).toEqual([['logo', 'logo-1']])

    await user.click(screen.getByRole('button', { name: 'Logo' }))
    await user.click(screen.getByRole('tab', { name: 'Icon' }))
    await user.click(within(screen.getByRole('listbox', { name: 'Icons' })).getAllByRole('option')[0])
    expect(picked[1][0]).toBe('icon')
  })

  it('opens on the Upload tab when a logo is picked', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderWithProviders(<IconPicker value="" logoId="logo-1" onChange={() => undefined} onPickLogo={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Logo' }))
    expect(screen.getByRole('tab', { name: 'Upload' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows no tabs when logos are not asked for', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderWithProviders(<IconPicker value="" onChange={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Logo' }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByRole('listbox', { name: 'Icons' })).toBeVisible()
  })

  it('turns down a file that is not SVG or PNG, and takes the same file again after', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderWithProviders(<IconPicker value="" onChange={() => undefined} onPickLogo={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Logo' }))
    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    const input = screen.getByLabelText('Logo file')
    await user.upload(input, new File(['just some words'], 'logo.svg', { type: 'image/svg+xml' }))
    expect(await screen.findByText('Only SVG or PNG files can be used as a logo.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull()
    expect(input.value).toBe('')
  })

  it('uploads an SVG under the file name and picks it', async () => {
    let sent = null
    const fetchMock = createFetchRouter(routes([
      {
        path: '/api/admin/application-logos',
        method: 'POST',
        response: ({ options }) => {
          sent = options.body
          return jsonResponse({ data: { id: 'logo-3', name: 'Brand', version: 1, used_by: [] } }, 201)
        },
      },
    ]))
    globalThis.fetch = fetchMock
    const picked = []
    const { user } = renderWithProviders(<IconPicker value="" onChange={() => undefined} onPickLogo={(id) => picked.push(id)} />)
    await user.click(screen.getByRole('button', { name: 'Logo' }))
    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    await user.upload(screen.getByLabelText('Logo file'), svgFile('Brand.svg'))
    expect(await screen.findByLabelText('Logo name')).toHaveValue('Brand')
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(picked).toEqual(['logo-3']))
    expect(sent.get('name')).toBe('Brand')
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('takes a PNG as well', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderWithProviders(<IconPicker value="" onChange={() => undefined} onPickLogo={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Logo' }))
    await user.click(screen.getByRole('tab', { name: 'Upload' }))
    await user.upload(screen.getByLabelText('Logo file'), new File([PNG_BYTES], 'Vendor.png', { type: 'image/png' }))
    expect(await screen.findByLabelText('Logo name')).toHaveValue('Vendor')
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled()
  })
})
