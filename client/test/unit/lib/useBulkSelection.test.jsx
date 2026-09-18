import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { useBulkSelection } from '../../../src/lib/useBulkSelection.js'
import { renderWithProviders } from '../../helpers/render.jsx'

function Harness(props) {
  const selection = useBulkSelection(props)
  return (
    <div>
      <output data-testid="selected">{Array.from(selection.selectedIds).join(',')}</output>
      <output data-testid="count">{selection.selectedCount}</output>
      <output data-testid="all">{String(selection.allVisibleSelected)}</output>
      <button type="button" onClick={() => selection.toggleSelected('a')}>Toggle A</button>
      <button type="button" onClick={() => { void selection.toggleAllVisible() }}>Toggle all</button>
      <button type="button" onClick={selection.clearSelection}>Clear</button>
    </div>
  )
}

function baseProps(overrides = {}) {
  return {
    listFn: mock(async () => ({ data: [] })),
    queryParams: { status: 'ACTIVE' },
    visibleIds: ['a', 'b'],
    hasActiveFilters: false,
    paging: { total_item: 2 },
    pageSize: 10,
    entityLabel: 'students',
    ...overrides,
  }
}

describe('useBulkSelection', () => {
  it('toggles, selects visible rows, and clears selection', async () => {
    const { user } = renderWithProviders(<Harness {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: 'Toggle A' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('a')

    await user.click(screen.getByRole('button', { name: 'Toggle all' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('a,b')
    expect(screen.getByTestId('all')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'Toggle all' }))
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('fetches up to 100 filtered rows for select all', async () => {
    const listFn = mock(async () => ({ data: [{ id: 'a' }, { id: 'c' }] }))
    const { user } = renderWithProviders(
      <Harness {...baseProps({ listFn, hasActiveFilters: true, paging: { total_item: 150 } })} />,
    )
    await user.click(screen.getByRole('button', { name: 'Toggle all' }))

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('a,c'))
    expect(listFn).toHaveBeenCalledWith({ status: 'ACTIVE', page: 1, size: 100 })
  })

  it('does nothing when the current page is empty', async () => {
    const listFn = mock(async () => ({ data: [{ id: 'a' }] }))
    const { user } = renderWithProviders(
      <Harness {...baseProps({ listFn, visibleIds: [], hasActiveFilters: true })} />,
    )
    await user.click(screen.getByRole('button', { name: 'Toggle all' }))
    expect(listFn).not.toHaveBeenCalled()
  })
})
