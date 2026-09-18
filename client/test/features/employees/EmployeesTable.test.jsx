import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { EmployeesTable } from '../../../src/features/employees/components/EmployeesTable.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { employeeListItem } from '../../fixtures/employees.js'

function renderTable(overrides = {}) {
  const props = {
    employees: [employeeListItem()],
    sorting: [{ id: 'created_at', desc: true }],
    onSortingChange: mock(() => {}),
    isLoading: false,
    isTrash: false,
    canRestore: false,
    restoringId: null,
    onRestore: mock(() => {}),
    canSelect: true,
    selectedIds: new Set(),
    onToggleSelected: mock(() => {}),
    onToggleAll: mock(() => {}),
    allSelected: false,
    ...overrides,
  }
  return { ...renderWithProviders(<EmployeesTable {...props} />), props }
}

describe('EmployeesTable', () => {
  it('renders loading and empty states with selection-aware column spans', () => {
    const { rerender, props } = renderTable({ employees: [], isLoading: true })
    expect(screen.getByText('Preparing employee records...').closest('td')).toHaveAttribute('colspan', '10')

    rerender(<EmployeesTable {...props} isLoading={false} canSelect={false} />)
    expect(screen.getByText('No employees are ready to review.').closest('td')).toHaveAttribute('colspan', '9')
  })

  it('renders employee fields, status, and detail action', () => {
    renderTable()
    expect(screen.getByText('Ari Employee')).toBeVisible()
    expect(screen.getByText('ari.employee@millennia21.id')).toBeVisible()
    expect(screen.getByText('12.34.567')).toBeVisible()
    expect(screen.getByText('Elementary')).toBeVisible()
    expect(screen.getByText('Contract')).toBeVisible()
    expect(screen.getByText('Active')).toBeVisible()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute('href', '/employees/employee-1')
  })

  it('handles sorting and row selection', async () => {
    const { user, props } = renderTable()
    await user.click(screen.getByRole('button', { name: 'Name' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Ari Employee' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select All Employees' }))

    expect(props.onSortingChange).toHaveBeenCalledTimes(1)
    expect(props.onToggleSelected).toHaveBeenCalledWith('employee-1')
    expect(props.onToggleAll).toHaveBeenCalledTimes(1)
  })

  it('renders and disables restore actions in trash mode', async () => {
    const { user, props, rerender } = renderTable({ isTrash: true, canRestore: true })
    await user.click(screen.getByRole('button', { name: /Restore/ }))
    expect(props.onRestore).toHaveBeenCalledWith('employee-1')

    rerender(<EmployeesTable {...props} restoringId="employee-1" />)
    expect(screen.getByRole('button', { name: /Restore/ })).toBeDisabled()
  })
})
