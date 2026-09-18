import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../../helpers/render.jsx'
import { Field, LengthHint } from '../../../../src/components/ui/formControls/Field.jsx'

describe('Field', () => {
  it('renders labels, field markers, hints, and errors', () => {
    const { rerender } = renderWithProviders(
      <Field label="Full name" name="full_name" hint="Required field">
        <input aria-label="Full name input" />
      </Field>,
    )

    expect(screen.getByText('Full name')).toBeVisible()
    expect(screen.getByText('Required field')).toBeVisible()
    expect(document.querySelector('[data-field="full_name"]')).toBeInTheDocument()

    rerender(
      <Field label="Full name" name="full_name" error="Full name is required">
        <input aria-label="Full name input" />
      </Field>,
    )
    expect(screen.getByText('Full name is required')).toBeVisible()
    expect(screen.queryByText('Required field')).not.toBeInTheDocument()
  })

  it('counts digits by default and supports custom text counting', () => {
    const { rerender } = renderWithProviders(
      <LengthHint value="12-34" max={4} label="digits" />,
    )
    expect(screen.getByText('4/4 digits')).toHaveClass('text-[#476b43]')

    rerender(
      <LengthHint
        value="Ari"
        max={10}
        label="characters"
        prefix="Required"
        count={(value) => value.length}
      />,
    )
    expect(screen.getByText('Required')).toBeVisible()
    expect(screen.getByText('3/10 characters')).toBeVisible()
  })
})
