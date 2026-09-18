import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { PageHeader } from '../../../src/components/layout/PageHeader.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('PageHeader', () => {
  it('renders title, description, actions, and refresh behavior', async () => {
    const onRefresh = mock(() => {})
    const { user, rerender } = renderWithProviders(
      <PageHeader
        title="Employees"
        description="Manage employee records."
        actions={<button type="button">New Employee</button>}
        onRefresh={onRefresh}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Employees' })).toBeVisible()
    expect(screen.getByText('Manage employee records.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Employee' })).toBeVisible()
    await user.click(screen.getByTitle('Refresh'))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    rerender(
      <PageHeader title="Employees" onRefresh={onRefresh} isFetching />,
    )
    expect(screen.getByTitle('Refresh')).toBeDisabled()
    expect(screen.getByTitle('Refresh').querySelector('svg')).toHaveClass('animate-spin')
    expect(screen.queryByText('Manage employee records.')).not.toBeInTheDocument()
  })
})
