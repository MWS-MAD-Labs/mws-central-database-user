import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { PageHeader } from '../../../src/components/layout/PageHeader.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('PageHeader', () => {
  it('renders title, description, and actions', () => {
    const { rerender } = renderWithProviders(
      <PageHeader
        title="Employees"
        description="Manage employee records."
        actions={<button type="button">New Employee</button>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Employees' })).toBeVisible()
    expect(screen.getByText('Manage employee records.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Employee' })).toBeVisible()
    rerender(<PageHeader title="Employees" />)
    expect(screen.queryByText('Manage employee records.')).not.toBeInTheDocument()
  })
})
