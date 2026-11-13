import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { UserAvatar } from '../../../src/components/ui/UserAvatar.jsx'

describe('UserAvatar', () => {
  it('shows the photo when there is one', () => {
    const { container } = render(<UserAvatar src="https://example.org/me.avif" initials="AB" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.org/me.avif')
    expect(screen.queryByText('AB')).not.toBeInTheDocument()
  })

  it('shows the initials when there is no photo', () => {
    const { container } = render(<UserAvatar src={null} initials="AB" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AB')).toBeVisible()
  })

  it('falls back to the initials when the photo link no longer works, and tries a new link again', () => {
    const { container, rerender } = render(<UserAvatar src="https://example.org/old.avif" initials="AB" />)
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AB')).toBeVisible()

    rerender(<UserAvatar src="https://example.org/new.avif" initials="AB" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.org/new.avif')
  })
})
