import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { Button } from '../../src/components/ui/Button.jsx'
import { renderWithProviders } from '../helpers/render.jsx'

describe('Bun frontend test setup', () => {
  it('renders React components with jest-dom matchers and user-event', async () => {
    let clicked = false
    const { user } = renderWithProviders(
      <Button type="button" onClick={() => { clicked = true }}>
        Save record
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Save record' })
    expect(button).toBeVisible()
    expect(button).toBeEnabled()

    await user.click(button)
    expect(clicked).toBe(true)
  })
})
