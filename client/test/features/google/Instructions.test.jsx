import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { GoogleInstructionsDialog } from '../../../src/features/google/components/GoogleInstructionsDialog.jsx'
import { maskEmail, signInInstructions } from '../../../src/features/google/utils/instructions.js'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('sign-in instructions', () => {
  it('masks an address down to its first letter and domain', () => {
    expect(maskEmail('budi.santoso@gmail.com')).toBe('b***@gmail.com')
    expect(maskEmail('nope')).toBe('')
  })

  it('tells the person what to do and that nobody was emailed', () => {
    const text = signInInstructions('ari@millennia21.id', 'a***@gmail.com')
    expect(text).toContain('ari@millennia21.id')
    expect(text).toContain('Forgot password')
    expect(text).toContain('a***@gmail.com')
    expect(signInInstructions('ari@millennia21.id', '')).toContain('to your recovery email.')
  })

  it('shows them in a dialog with Copy and Done', async () => {
    let closed = false
    const { user } = renderWithProviders(
      <GoogleInstructionsDialog email="ari@millennia21.id" maskedRecovery="a***@gmail.com" onClose={() => { closed = true }} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Google Account Ready' })
    expect(within(dialog).getByText('Nobody has been emailed. Pass this on to the person.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Copy instructions' })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(closed).toBe(true)
  })
})
