import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { BulkExtendContractDialog } from '../../../src/features/employees/components/BulkExtendContractDialog.jsx'
import { ExtendContractDialog } from '../../../src/features/employees/components/ExtendContractDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

function employee(overrides = {}) {
  return {
    id: 'employee-1',
    identity: { full_name: 'Taylor Employee' },
    employment: { employee_id: 'EMP-1' },
    status_info: {
      employment_type: 'CONTRACT',
      status: 'ACTIVE',
      contract_end_date: '2026-09-30T00:00:00.000Z',
      ...overrides,
    },
  }
}

describe('ExtendContractDialog', () => {
  it('requires an extension beyond the current end date and submits ISO payload', async () => {
    const onConfirm = mock(() => {})
    const { user } = renderWithProviders(
      <ExtendContractDialog
        employee={employee()}
        onClose={() => {}}
        onConfirm={onConfirm}
        isSaving={false}
      />,
    )

    expect(screen.getByText(/Current end date:/)).toHaveTextContent('2026-09-30')
    await user.click(screen.getByRole('button', { name: 'Extend' }))

    expect(onConfirm).toHaveBeenCalledWith('2026-10-01T00:00:00.000Z')
  })

  it('uses a selected duration to calculate the new end date', async () => {
    const onConfirm = mock(() => {})
    const { user } = renderWithProviders(
      <ExtendContractDialog
        employee={employee()}
        onClose={() => {}}
        onConfirm={onConfirm}
        isSaving={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select Duration' }))
    await user.click(screen.getByRole('option', { name: '6 months' }))
    await user.click(screen.getByRole('button', { name: 'Extend' }))

    expect(onConfirm).toHaveBeenCalledWith('2027-03-30T00:00:00.000Z')
  })
})

describe('BulkExtendContractDialog', () => {
  it('skips ineligible employees, supports exclusions, and submits duration payload', async () => {
    const onConfirm = mock(() => {})
    const employees = [
      employee(),
      { ...employee({ employment_type: 'PERMANENT' }), id: 'employee-2', identity: { full_name: 'Permanent Employee' } },
      { ...employee(), id: 'employee-3', identity: { full_name: 'Jordan Employee' }, employment: { employee_id: 'EMP-3' } },
    ]
    const { user } = renderWithProviders(
      <BulkExtendContractDialog
        employees={employees}
        isLoadingEmployees={false}
        onClose={() => {}}
        onConfirm={onConfirm}
        isSaving={false}
      />,
    )

    expect(screen.getByText(/1 selected employee\(s\) are PERMANENT/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Select Duration' }))
    await user.click(screen.getByRole('option', { name: '3 months' }))
    const exclusionButtons = screen.getAllByRole('button', { name: 'Exclude this employee' })
    await user.click(exclusionButtons[1])
    await user.click(screen.getByRole('button', { name: 'Extend' }))

    expect(onConfirm).toHaveBeenCalledWith(
      { durationMonths: 3, baselineOverrides: [] },
      ['employee-1'],
    )
  })
})
