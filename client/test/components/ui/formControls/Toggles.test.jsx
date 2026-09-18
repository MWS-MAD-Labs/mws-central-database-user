import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../../helpers/render.jsx'
import { CheckboxField, ToggleChip } from '../../../../src/components/ui/formControls/Toggles.jsx'

describe('toggle controls', () => {
  it('toggles the next boolean value with switch semantics', async () => {
    const onChange = mock(() => {})
    const { user, rerender } = renderWithProviders(
      <ToggleChip checked={false} onChange={onChange}>Show deleted</ToggleChip>,
    )
    const toggle = screen.getByRole('switch', { name: 'Show deleted' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(<ToggleChip checked onChange={onChange}>Show deleted</ToggleChip>)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('renders an accessible checkbox with optional description', async () => {
    const onChange = mock(() => {})
    const { user } = renderWithProviders(
      <CheckboxField
        label="Sensitive access"
        description="Allow viewing protected student fields."
        checked={false}
        onChange={onChange}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Sensitive access/ })
    expect(screen.getByText('Allow viewing protected student fields.')).toBeVisible()
    await user.click(checkbox)
    expect(onChange).toHaveBeenCalled()
  })
})
