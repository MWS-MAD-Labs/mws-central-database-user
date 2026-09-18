import { afterEach, describe, expect, it, mock, vi } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import { DebouncedSearchInput } from '../../../../src/components/ui/formControls/TextControls.jsx'
import { renderWithProviders } from '../../../helpers/render.jsx'

describe('DebouncedSearchInput', () => {
  afterEach(() => vi.useRealTimers())

  it('emits the latest value after the debounce delay', async () => {
    const onChange = mock(() => {})
    const { user } = renderWithProviders(
      <DebouncedSearchInput value="" onChange={onChange} placeholder="Search students" delay={20} />,
    )

    await user.type(screen.getByRole('searchbox'), 'Ari')
    expect(onChange).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('Ari')
  })

  it('supports Bun fake timers for deterministic debounce tests', async () => {
    vi.useFakeTimers()
    const onChange = mock(() => {})
    renderWithProviders(
      <DebouncedSearchInput value="" onChange={onChange} placeholder="Search students" delay={400} />,
    )

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'B' } })
    expect(onChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(400)
    expect(onChange).toHaveBeenCalledWith('B')
  })
})
