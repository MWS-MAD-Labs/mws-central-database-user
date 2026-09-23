import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { LiveIndicator } from '../../../src/components/ui/LiveIndicator.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('LiveIndicator', () => {
  it('renders a pulsing green live state', () => {
    const { container } = renderWithProviders(<LiveIndicator />)

    expect(screen.getByRole('status')).toHaveTextContent('Live')
    expect(screen.getByRole('status')).toHaveClass('text-[#3f6a3b]')
    expect(container.querySelector('.motion-safe\\:animate-ping')).toBeInTheDocument()
  })

  it('renders a static amber syncing state', () => {
    const { container } = renderWithProviders(<LiveIndicator isSyncing />)

    expect(screen.getByRole('status')).toHaveTextContent('Syncing')
    expect(screen.getByRole('status')).toHaveClass('text-[#8a6419]')
    expect(container.querySelector('.motion-safe\\:animate-ping')).not.toBeInTheDocument()
  })
})
