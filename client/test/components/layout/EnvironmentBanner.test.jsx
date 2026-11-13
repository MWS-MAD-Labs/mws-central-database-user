import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { EnvironmentBanner } from '../../../src/components/layout/EnvironmentBanner.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function renderBanner(response) {
  globalThis.fetch = createFetchRouter([{ path: '/api/public-config', response }])
  return renderWithProviders(<EnvironmentBanner />)
}

describe('EnvironmentBanner', () => {
  it('says it is a test version and links to the real one when an address is set', async () => {
    renderBanner(jsonResponse({ data: { production_url: 'https://central.example.org' } }))
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Ini versi uji coba Central. Perubahan di sini tidak dipakai. Untuk pekerjaan sebenarnya, buka')
    expect(screen.getByRole('link', { name: 'https://central.example.org' })).toHaveAttribute('href', 'https://central.example.org')
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--env-banner-h')).not.toBe(''))
  })

  it('shows nothing on the real one', async () => {
    renderBanner(jsonResponse({ data: { production_url: null } }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--env-banner-h')).toBe('')
  })

  it('shows nothing when the address cannot be read', async () => {
    renderBanner(jsonResponse({ errors: 'down' }, 500))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('note')).toBeNull()
  })
})
