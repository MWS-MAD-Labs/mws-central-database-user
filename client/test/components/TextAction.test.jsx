import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Link } from 'react-router'
import { TextAction } from '../../src/components/ui/TextAction.jsx'

describe('TextAction', () => {
  it('has the same size and weight as a link made with asChild, even as a button', () => {
    render(
      <MemoryRouter>
        <TextAction>Rotate Token</TextAction>
        <TextAction asChild>
          <Link to="/x">Add Role</Link>
        </TextAction>
      </MemoryRouter>,
    )
    // The ! keeps index.css (font: inherit on buttons) from making the button bigger than the link.
    expect(screen.getByRole('button', { name: 'Rotate Token' }).className).toContain('text-xs!')
    expect(screen.getByRole('button', { name: 'Rotate Token' }).className).toContain('font-medium!')
    expect(screen.getByRole('link', { name: 'Add Role' }).className).toContain('text-xs!')
  })
})
