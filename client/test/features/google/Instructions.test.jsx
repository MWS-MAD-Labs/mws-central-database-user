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

  it('writes the steps in Indonesian by default with blank lines between blocks', () => {
    const text = signInInstructions('ari@millennia21.id', 'a***@gmail.com')
    expect(text).toContain('Email: ari@millennia21.id')
    expect(text).toContain('Lupa sandi')
    expect(text).toContain('a***@gmail.com')
    expect(text).toContain('1. Buka accounts.google.com')
    expect(text).toContain('\n\nCara masuk pertama kali:\n')
    expect(text).toContain('Jangan bagikan kode')
  })

  it('has an English version and leaves out the recovery line when unknown', () => {
    const text = signInInstructions('ari@millennia21.id', '', 'en')
    expect(text).toContain('Forgot password')
    expect(text).toContain('to your recovery email.')
    expect(text).not.toContain('Code goes to')
  })

  it('shows them as numbered steps with a copy button per language', async () => {
    let closed = false
    const { user } = renderWithProviders(
      <GoogleInstructionsDialog email="ari@millennia21.id" maskedRecovery="a***@gmail.com" onClose={() => { closed = true }} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Google Account Ready' })
    expect(within(dialog).getByText('Nobody has been emailed. Pass this on to the person.')).toBeVisible()
    expect(within(dialog).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5)
    expect(within(dialog).getByRole('button', { name: 'Copy (Bahasa Indonesia)' })).toBeVisible()
    await user.click(within(dialog).getByRole('tab', { name: 'English' }))
    expect(within(dialog).getByText(/Choose "Forgot password"/)).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Copy (English)' })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(closed).toBe(true)
  })
})
