import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/render.jsx'
import { PaginationBar } from '../../../src/components/ui/PaginationBar.jsx'

function renderPagination(overrides = {}) {
  const props = {
    paging: { current_page: 2, total_page: 10, total_item: 95, size: 10 },
    itemLabel: 'students',
    isLoading: false,
    onPrevious: mock(() => {}),
    onNext: mock(() => {}),
    onPageSizeChange: mock(() => {}),
    onPageChange: mock(() => {}),
    ...overrides,
  }
  return { ...renderWithProviders(<PaginationBar {...props} />), props }
}

describe('PaginationBar', () => {
  it('renders summary and moves between pages', async () => {
    const { user, props } = renderPagination()
    expect(screen.getByText('Page 2 of 10 / 95 students')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /Prev/ }))
    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(props.onPrevious).toHaveBeenCalledTimes(1)
    expect(props.onNext).toHaveBeenCalledTimes(1)
  })

  it('disables navigation at boundaries and during loading', () => {
    const { rerender, props } = renderPagination({
      paging: { current_page: 1, total_page: 1, total_item: 0, size: 10 },
    })
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()

    rerender(<PaginationBar {...props} isLoading />)
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })

  it('changes the page size through SearchableSelect', async () => {
    const { user, props } = renderPagination()
    await user.click(screen.getByRole('button', { name: '10' }))
    await user.click(screen.getByRole('option', { name: '30' }))
    expect(props.onPageSizeChange).toHaveBeenCalledWith(30)
  })

  it('shows page jump only for long result sets and validates input', async () => {
    const { user, props, rerender } = renderPagination()
    const input = screen.getByPlaceholderText('Page')

    await user.type(input, '20')
    expect(input).toHaveValue(10)
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(props.onPageChange).toHaveBeenCalledWith(10)

    rerender(<PaginationBar {...props} paging={{ current_page: 1, total_page: 7, total_item: 70, size: 10 }} />)
    expect(screen.queryByPlaceholderText('Page')).not.toBeInTheDocument()
  })
})
