import { describe, expect, it, mock, setSystemTime } from 'bun:test'
import { fireEvent, screen, within } from '@testing-library/react'
import { BulkEditEmployeeDialog } from '../../../src/features/employees/components/BulkEditEmployeeDialog.jsx'
import { employeeFormOptions, employeeListItem } from '../../fixtures/employees.js'
import { renderWithProviders } from '../../helpers/render.jsx'

function employees() {
  return [
    employeeListItem(),
    employeeListItem({
      id: 'employee-2',
      identity: { full_name: 'Bea Employee' },
      employment: { employee_id: '98.76.543' },
    }),
  ]
}

function renderDialog(overrides = {}) {
  const props = {
    employees: employees(),
    isLoadingEmployees: false,
    options: employeeFormOptions,
    isSaving: false,
    onClose: mock(() => {}),
    onConfirm: mock(() => {}),
    ...overrides,
  }

  return { ...renderWithProviders(<BulkEditEmployeeDialog {...props} />), props }
}

async function chooseOption(user, triggerName, optionName) {
  await user.click(screen.getByRole('button', { name: triggerName }))
  await user.click(screen.getByRole('option', { name: optionName }))
}

function setDate(input, value) {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

function employeeRow(name) {
  return screen.getByText(name).closest('div.flex.min-w-0')
}

describe('BulkEditEmployeeDialog', () => {
  it('renders the initial state with apply disabled', () => {
    renderDialog()

    expect(screen.getByRole('heading', { name: 'Bulk Edit Employees' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Employment Type' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Select Value' })).toBeVisible()
    expect(screen.getByText('2 of 2 employee(s) will be updated.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('renders the loading state', () => {
    renderDialog({ employees: [], isLoadingEmployees: true })

    expect(screen.getByText('Apply one change to ... selected employee(s).')).toBeVisible()
    expect(screen.getByText('Loading selected employees...')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('selects a field and value, excludes and reincludes employees, and submits exact ids', async () => {
    const { user, props } = renderDialog()

    await chooseOption(user, 'Employment Type', 'Unit')
    expect(screen.getAllByText(/Current: Elementary/)).toHaveLength(2)
    await chooseOption(user, 'Select Value', 'Secondary')

    await user.click(within(employeeRow('Bea Employee')).getByRole('button', { name: 'Exclude this employee' }))
    expect(screen.getByText('1 of 2 employee(s) will be updated.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(props.onConfirm).toHaveBeenLastCalledWith({
      ids: ['employee-1'],
      unit_id: 'unit-secondary',
      effective_date: undefined,
      contract_end_date_overrides: undefined,
      last_working_date_overrides: undefined,
    })

    await user.click(within(employeeRow('Bea Employee')).getByRole('button', { name: 'Include this employee' }))
    expect(screen.getByText('2 of 2 employee(s) will be updated.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(props.onConfirm).toHaveBeenLastCalledWith({
      ids: ['employee-1', 'employee-2'],
      unit_id: 'unit-secondary',
      effective_date: undefined,
      contract_end_date_overrides: undefined,
      last_working_date_overrides: undefined,
    })
  })

  it('computes contract duration, permits per-row overrides, and includes an effective date', async () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    const { user, props, container } = renderDialog()

    await chooseOption(user, 'Select Value', 'Contract')
    expect(screen.getByText('Set Contract Duration For All')).toBeVisible()
    await chooseOption(user, 'Select Duration', '6 months')

    const dateInputs = container.querySelectorAll('input')
    expect(dateInputs).toHaveLength(3)
    expect(dateInputs[1]).toHaveValue('17/03/2027')
    expect(dateInputs[2]).toHaveValue('17/03/2027')

    setDate(dateInputs[0], '01/09/2026')
    setDate(dateInputs[2], '30/04/2027')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(props.onConfirm).toHaveBeenCalledWith({
      ids: ['employee-1', 'employee-2'],
      employment_type: 'CONTRACT',
      effective_date: '2026-09-01T00:00:00.000Z',
      contract_end_date_overrides: [
        { id: 'employee-1', contract_end_date: '2027-03-17T00:00:00.000Z' },
        { id: 'employee-2', contract_end_date: '2027-04-30T00:00:00.000Z' },
      ],
      last_working_date_overrides: undefined,
    })
  })

  it('warns that permanent employment clears contract end dates and submits clear intent', async () => {
    const { user, props } = renderDialog()

    await chooseOption(user, 'Select Value', 'Permanent')

    expect(screen.getByText(/Any existing end date will be cleared/)).toBeVisible()
    expect(screen.queryByText('Set Contract Duration For All')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(props.onConfirm).toHaveBeenCalledWith({
      ids: ['employee-1', 'employee-2'],
      employment_type: 'PERMANENT',
      effective_date: undefined,
      contract_end_date_overrides: undefined,
      last_working_date_overrides: undefined,
    })
  })

  it('submits only included resigned employees with last-working-date overrides', async () => {
    const { user, props, container } = renderDialog()

    await chooseOption(user, 'Employment Type', 'Status')
    await chooseOption(user, 'Select Value', 'Resigned')

    expect(screen.getByText(/Resigned requires a last working date/)).toBeVisible()
    const dateInputs = container.querySelectorAll('input')
    expect(dateInputs).toHaveLength(3)
    setDate(dateInputs[1], '20/09/2026')
    setDate(dateInputs[2], '30/09/2026')
    await user.click(within(employeeRow('Bea Employee')).getByRole('button', { name: 'Exclude this employee' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(props.onConfirm).toHaveBeenCalledWith({
      ids: ['employee-1'],
      status: 'RESIGNED',
      effective_date: undefined,
      contract_end_date_overrides: undefined,
      last_working_date_overrides: [
        { id: 'employee-1', last_working_date: '2026-09-20T00:00:00.000Z' },
      ],
    })
  })

  it('disables apply when every employee is excluded', async () => {
    const { user } = renderDialog()

    await chooseOption(user, 'Select Value', 'Permanent')
    for (const button of screen.getAllByRole('button', { name: 'Exclude this employee' })) {
      await user.click(button)
    }
    expect(screen.getByText('0 of 2 employee(s) will be updated.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('disables actions and shows saving state while applying', () => {
    renderDialog({ isSaving: true })

    const applyButton = screen.getByRole('button', { name: 'Apply' })
    expect(applyButton).toBeDisabled()
    expect(applyButton).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
