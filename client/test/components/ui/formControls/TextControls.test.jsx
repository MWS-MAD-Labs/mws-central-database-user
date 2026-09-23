import { afterEach, describe, expect, it, mock, vi } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../helpers/render.jsx'
import { DebouncedSearchInput, SelectInput, TextAreaInput, TextInput } from '../../../../src/components/ui/formControls/TextControls.jsx'

describe('text controls', () => {
  afterEach(() => vi.useRealTimers())

  it('forwards input props and invalid styling', () => {
    renderWithProviders(
      <>
        <TextInput aria-label="Name" invalid defaultValue="Ari" />
        <TextAreaInput aria-label="Notes" invalid defaultValue="Support notes" />
        <SelectInput aria-label="Status" defaultValue="active">
          <option value="active">Active</option>
        </SelectInput>
      </>,
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Ari')
    expect(screen.getByLabelText('Name')).toHaveClass('border-[#c75f64]')
    expect(screen.getByLabelText('Notes')).toHaveValue('Support notes')
    expect(screen.getByLabelText('Status')).toHaveValue('active')
  })

  it('syncs external search values and cancels the previous debounce', async () => {
    vi.useFakeTimers()
    const onChange = mock(() => {})
    const { rerender } = renderWithProviders(
      <DebouncedSearchInput value="old" onChange={onChange} placeholder="Search" delay={100} />,
    )
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.change(input, { target: { value: 'second' } })
    vi.advanceTimersByTime(100)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('second')

    rerender(<DebouncedSearchInput value="external" onChange={onChange} placeholder="Search" delay={100} />)
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('external'))
  })

  it('shows a styled clear action and clears immediately', async () => {
    const onChange = mock(() => {})
    const { user } = renderWithProviders(
      <DebouncedSearchInput value="admin" onChange={onChange} placeholder="Search Admin Name Or Email" />,
    )

    const clear = screen.getByRole('button', { name: 'Clear Search Admin Name Or Email' })
    expect(clear).toHaveClass('text-(--mws-burgundy)')
    await user.click(clear)

    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(onChange).toHaveBeenCalledWith('')
  })
})
