import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { QueryLoadingBar, RouteLoadingBar } from '../../../src/components/ui/RouteLoadingBar.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('RouteLoadingBar', () => {
  it('exposes an accessible top loading indicator', () => {
    const { container } = renderWithProviders(<RouteLoadingBar />)

    expect(screen.getByRole('progressbar', { name: 'Loading page' })).toHaveClass(
      'fixed',
      'top-0',
    )
    expect(container.querySelector('.mws-route-loading-bar')).toBeInTheDocument()
  })

  it('tracks active React Query fetches', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })

    function PendingQuery() {
      useQuery({ queryKey: ['loading-bar-test'], queryFn: () => pending })
      return <QueryLoadingBar />
    }

    renderWithProviders(<PendingQuery />)
    expect(await screen.findByRole('progressbar', { name: 'Loading page' })).toBeVisible()

    release({ ok: true })
    await waitFor(() => {
      expect(screen.queryByRole('progressbar', { name: 'Loading page' })).not.toBeInTheDocument()
    })
  })
})
