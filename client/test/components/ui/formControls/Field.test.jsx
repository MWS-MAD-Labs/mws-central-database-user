import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../../helpers/render.jsx'
import { Field } from '../../../../src/components/ui/formControls/Field.jsx'

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

  it('shows the count in the label row, digits by default, and turns green when full and red when over', () => {
    const { rerender } = renderWithProviders(
      <Field label="NIK" counter={{ value: '12-34', max: 4 }}>
        <input aria-label="nik" />
      </Field>,
    )
    expect(screen.getByText('4/4')).toHaveClass('text-[#476b43]')
    // Nothing but the count: no "Up to", no unit.
    expect(screen.queryByText(/Up to|digits/)).not.toBeInTheDocument()

    rerender(
      <Field label="Name" counter={{ value: 'Ari', max: 10, count: (value) => value.length }}>
        <input aria-label="name" />
      </Field>,
    )
    expect(screen.getByText('3/10')).toHaveClass('text-(--mws-muted)')

    rerender(
      <Field label="Name" counter={{ value: 'Ari Employee', max: 10, count: (value) => value.length }}>
        <input aria-label="name" />
      </Field>,
    )
    expect(screen.getByText('12/10')).toHaveClass('text-[#a43c41]')
  })

  it('keeps the star and the count on the same row as the label', () => {
    renderWithProviders(
      <Field label="Recovery Email" required counter={{ value: '', max: 100, count: (value) => value.length }}>
        <input aria-label="recovery" />
      </Field>,
    )
    const label = screen.getByText('Recovery Email')
    expect(label.textContent).toContain('*')
    expect(label.parentElement).toContainElement(screen.getByText('0/100'))
  })
})
