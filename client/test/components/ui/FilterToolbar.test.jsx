import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { FilterResetButton } from '../../../src/components/ui/FilterResetButton.jsx'
import { FilterToolbar } from '../../../src/components/ui/FilterToolbar.jsx'
import { SensitiveToggle } from '../../../src/components/ui/SensitiveToggle.jsx'

const filters = (count) => Array.from({ length: count }, (_, index) => <select key={index} aria-label={`filter ${index}`} />)

describe('FilterToolbar', () => {
  it('keeps up to three filters on the row of the search', () => {
    render(<FilterToolbar search={<input aria-label="search" />} reset={<button>reset</button>}>{filters(3)}</FilterToolbar>)
    expect(screen.getByTestId('filter-toolbar')).toHaveAttribute('data-layout', 'inline')
  })

  it('puts four filters or more under the search', () => {
    render(<FilterToolbar search={<input aria-label="search" />}>{filters(4)}</FilterToolbar>)
    expect(screen.getByTestId('filter-toolbar')).toHaveAttribute('data-layout', 'stacked')
  })

  it('does not count filters that are not shown', () => {
    render(
      <FilterToolbar search={<input aria-label="search" />}>
        {filters(3)}
        {null}
        {false}
      </FilterToolbar>,
    )
    expect(screen.getByTestId('filter-toolbar')).toHaveAttribute('data-layout', 'inline')
  })
})

describe('FilterResetButton', () => {
  it('is an icon with a name, and only shows when a filter is on', () => {
    const onReset = mock(() => {})
    const { rerender } = render(<FilterResetButton visible={false} onReset={onReset} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<FilterResetButton visible onReset={onReset} />)
    const button = screen.getByRole('button', { name: 'Clear filters' })
    expect(button.textContent.trim()).toBe('')
    fireEvent.click(button)
    expect(onReset).toHaveBeenCalled()
  })
})

describe('SensitiveToggle', () => {
  it('shows a burgundy Show button and a bordered Hide button, both icon only', () => {
    const { rerender } = render(<SensitiveToggle revealed={false} onShow={() => {}} />)
    const show = screen.getByRole('button', { name: 'Show Sensitive Fields' })
    expect(show.className).toContain('bg-(--mws-burgundy)')
    expect(show.textContent.trim()).toBe('')
    rerender(<SensitiveToggle revealed onHide={() => {}} />)
    const hide = screen.getByRole('button', { name: 'Hide' })
    expect(hide.className).not.toContain('bg-(--mws-burgundy)')
  })
})
