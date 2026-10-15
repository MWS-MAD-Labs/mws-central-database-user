import { describe, expect, it, mock } from 'bun:test'
import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../../../helpers/render.jsx'
import { SearchableSelect } from '../../../../src/components/ui/formControls/SearchableSelect.jsx'

const options = [
  { value: 'active', label: 'Active', description: 'Current students', badge: 'Live', tone: 'green' },
  { value: 'inactive', label: 'Inactive', description: 'Not currently active' },
  { value: 'archived', label: 'Archived', disabled: true },
]

describe('SearchableSelect', () => {
  it('opens in a portal and selects an option', async () => {
    const onChange = mock(() => {})
    const { user } = renderWithProviders(
      <SearchableSelect value="" onChange={onChange} options={options} placeholder="Select status" />,
    )

    const trigger = screen.getByRole('button', { name: 'Select status' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeVisible()
    await user.click(screen.getByRole('option', { name: /Inactive/ }))

    expect(onChange).toHaveBeenCalledWith('inactive')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows search at the threshold and filters all option metadata', async () => {
    const { user } = renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={options} searchableThreshold={3} />,
    )
    await user.click(screen.getByRole('button', { name: 'Select' }))

    const search = screen.getByRole('searchbox')
    await user.type(search, 'students')
    const clear = screen.getByRole('button', { name: 'Clear Search' })
    expect(clear).toHaveClass('text-(--mws-burgundy)')
    expect(screen.getByRole('option', { name: /Active/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Inactive/ })).not.toBeInTheDocument()

    await user.click(clear)
    expect(search).toHaveValue('')
    await user.type(search, 'live')
    expect(screen.getByRole('option', { name: /Active/ })).toBeVisible()
  })

  it('highlights only one option: none before anything is picked, then the pointed or picked one', async () => {
    const { user } = renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={options} placeholder="Select status" />,
    )
    await user.click(screen.getByRole('button', { name: 'Select status' }))
    const highlighted = () => screen.getAllByRole('option').filter((option) => option.className.includes('bg-(--mws-soft)'))
    expect(highlighted()).toHaveLength(0)

    await user.hover(screen.getByRole('option', { name: /Inactive/ }))
    expect(highlighted().map((option) => option.textContent)).toEqual([expect.stringContaining('Inactive')])
  })

  it('does not keep a stale highlight when it is opened again after another option was picked', async () => {
    function Harness() {
      const [value, setValue] = useState('active')
      return <SearchableSelect value={value} onChange={setValue} options={options.map((option) => ({ ...option, disabled: false }))} placeholder="Pick" />
    }
    const { user } = renderWithProviders(<Harness />)
    await user.click(screen.getByRole('button', { name: /Active/ }))
    await user.click(screen.getByRole('option', { name: /Archived/ }))

    await user.click(screen.getByRole('button', { name: /Archived/ }))
    const highlighted = screen.getAllByRole('option').filter((option) => option.className.includes('bg-(--mws-soft)'))
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]).toHaveTextContent('Archived')
    // The picked one carries the tick, not the first one.
    expect(screen.getByRole('option', { name: /Archived/ }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('option', { name: /Active/ }).querySelector('svg')).toBeNull()
  })

  it('does not select disabled options', async () => {
    const onChange = mock(() => {})
    const { user } = renderWithProviders(
      <SearchableSelect value="" onChange={onChange} options={options} />,
    )
    await user.click(screen.getByRole('button', { name: 'Select' }))

    const archived = screen.getByRole('option', { name: 'Archived' })
    expect(archived).toBeDisabled()
    await user.click(archived)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('creates a trimmed value without duplicating existing labels', async () => {
    const onChange = mock(() => {})
    const { user } = renderWithProviders(
      <SearchableSelect value="" onChange={onChange} options={options} creatable />,
    )
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.type(screen.getByRole('searchbox'), '  Pending  ')

    await user.click(screen.getByRole('option', { name: 'Use "Pending"' }))
    expect(onChange).toHaveBeenCalledWith('Pending')

    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.type(screen.getByRole('searchbox'), 'active')
    expect(screen.queryByRole('option', { name: /Use/ })).not.toBeInTheDocument()
  })

  it('supports keyboard opening, navigation, selection, and escape', async () => {
    const onChange = mock(() => {})
    const { user } = renderWithProviders(
      <SearchableSelect value="active" onChange={onChange} options={options} />,
    )
    const trigger = screen.getByRole('button', { name: /Active/ })

    trigger.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('inactive')

    await user.click(trigger)
    expect(screen.getByRole('listbox')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on outside click and can force upward positioning', async () => {
    const { user } = renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={options} openUpward />,
    )
    const trigger = screen.getByRole('button', { name: 'Select' })
    Object.defineProperty(trigger.parentElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, width: 180, top: 500, bottom: 544 }),
    })
    await user.click(trigger)

    const listbox = screen.getByRole('listbox')
    const popup = listbox.parentElement
    expect(popup.style.bottom).not.toBe('')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('renders required and disabled trigger states', () => {
    const { rerender } = renderWithProviders(
      <SearchableSelect value="" onChange={() => {}} options={options} required />,
    )
    expect(screen.getByRole('button', { name: 'Select' })).toHaveClass('border-[#c75f64]')

    rerender(<SearchableSelect value="" onChange={() => {}} options={options} disabled />)
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled()
  })
})
