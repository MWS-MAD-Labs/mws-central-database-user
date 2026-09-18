import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { useLocation } from 'react-router'
import { renderWithProviders } from '../../helpers/render.jsx'
import { usePagedSearchParams } from '../../../src/lib/usePagedSearchParams.js'

function Harness(props) {
  const state = usePagedSearchParams(props)
  const location = useLocation()
  return (
    <div>
      <output data-testid="params">{JSON.stringify(state.params)}</output>
      <output data-testid="search">{location.search}</output>
      <button type="button" onClick={() => state.updateParams({ search: 'Ari', status: '', page: 3 })}>Update</button>
      <button type="button" onClick={() => state.resetPageAndUpdate({ status: 'INACTIVE' })}>Reset page</button>
    </div>
  )
}

describe('usePagedSearchParams', () => {
  it('normalizes invalid paging and sort values', () => {
    renderWithProviders(
      <Harness
        filterKeys={['grade_id']}
        sortFields={new Set(['created_at', 'full_name'])}
      />,
      { route: '/students?page=0&size=nope&sort_by=invalid&grade_id=grade-1' },
    )
    expect(JSON.parse(screen.getByTestId('params').textContent)).toEqual({
      page: 1,
      size: 10,
      search: '',
      status: 'ACTIVE',
      sort_by: 'created_at',
      sort_order: 'desc',
      grade_id: 'grade-1',
    })
  })

  it('updates, removes empty values, and resets page', async () => {
    const { user } = renderWithProviders(<Harness />, { route: '/students?status=ACTIVE&page=2' })
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?page=3&search=Ari')

    await user.click(screen.getByRole('button', { name: 'Reset page' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?page=1&search=Ari&status=INACTIVE')
  })
})
