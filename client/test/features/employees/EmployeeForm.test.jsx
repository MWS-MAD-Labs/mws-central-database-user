import { describe, expect, it, mock, setSystemTime } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { EmployeeForm } from '../../../src/features/employees/components/EmployeeForm.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import {
  employeeDatabaseAdmin,
  employeeFixture,
  employeeFormOptions,
  employeeSuperAdmin,
} from '../../fixtures/employees.js'

function jsonResponse(data = {}) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function renderEmployeeForm({
  mode = 'edit',
  employee = employeeFixture(),
  options = employeeFormOptions,
  user = employeeSuperAdmin,
  onSubmit = mock(() => {}),
  isSubmitting = false,
} = {}) {
  globalThis.fetch = mock(async (url) => {
    if (url.includes('/education-suggestions')) {
      return jsonResponse({ institution_names: [], majors: [] })
    }
    return jsonResponse([])
  })
  const result = renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <EmployeeForm
          mode={mode}
          employee={mode === 'edit' ? employee : undefined}
          options={options}
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
        />
      </ConfirmProvider>
    </AuthContext.Provider>,
  )
  return { ...result, onSubmit }
}

function field(name) {
  return document.querySelector(`[data-field="${name}"]`)
}

async function chooseSelect(user, buttonName, optionName) {
  await user.click(screen.getByRole('button', { name: buttonName }))
  await user.click(screen.getByRole('option', { name: optionName }))
}

function setDate(name, value) {
  const input = field(name).querySelector('input')
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe('EmployeeForm', () => {
  it('shows required create errors and does not submit', async () => {
    const { user, onSubmit } = renderEmployeeForm({ mode: 'create' })

    await user.click(screen.getByRole('button', { name: 'Create employee' }))

    expect(screen.getByText('Full name is required.')).toBeVisible()
    expect(screen.getByText('Employee ID is required.')).toBeVisible()
    expect(screen.getByText('Unit is required.')).toBeVisible()
    expect(screen.getByText('Contract end date is required for non-permanent employment types.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a valid normalized create payload', async () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    const { user, onSubmit } = renderEmployeeForm({ mode: 'create' })

    await user.type(field('full_name').querySelector('input'), 'ari employee')
    await user.type(field('nick_name').querySelector('input'), 'ari')
    await user.type(field('email_local').querySelector('input'), 'ari.employee!')
    await chooseSelect(user, 'Select Gender', 'Male')
    await chooseSelect(user, 'Select Religion', 'Islam')
    await user.type(field('birth_place').querySelector('input'), 'jakarta')
    await user.type(field('employee_id').querySelector('input'), '1111111')
    await chooseSelect(user, 'Probation', 'Permanent')
    await chooseSelect(user, 'Select unit', 'Elementary')
    await chooseSelect(user, 'Select level', /Teacher/)
    await chooseSelect(user, 'Select position', 'Classroom Teacher')
    await chooseSelect(user, 'Select building', 'Main Building')
    setDate('birth_date', '10/05/1990')
    setDate('join_date', '01/07/2020')
    await user.type(field('mobile_phone').querySelector('input'), '+62 812-3456')

    fireEvent.submit(document.querySelector('form'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      full_name: 'Ari Employee',
      nick_name: 'Ari',
      email: 'ari.employee@millennia21.id',
      gender: 'MALE',
      religion: 'ISLAM',
      religion_other: null,
      birth_place: 'Jakarta',
      employee_id: '11.11.111',
      status: 'ACTIVE',
      employment_type: 'PERMANENT',
      unit_id: 'unit-elementary',
      job_level_id: 'level-teacher',
      job_position_id: 'position-teacher',
      building_id: 'building-main',
      marital_status: 'SINGLE',
      mobile_phone: '+628123456',
    })
    expect(onSubmit.mock.calls[0][1]).toBeNull()
  })

  it('shows conditional religion and contract fields', async () => {
    const { user } = renderEmployeeForm({ mode: 'create' })

    await chooseSelect(user, 'Select Religion', 'Other')
    expect(field('religion_other')).toBeInTheDocument()
    expect(screen.getByText('Contract End Date')).toBeVisible()

    await chooseSelect(user, 'Probation', 'Permanent')
    expect(screen.queryByText('Contract End Date')).not.toBeInTheDocument()
  })

  it('limits database admins to their unit and restricts PII editing', async () => {
    const { user } = renderEmployeeForm({ mode: 'create', user: employeeDatabaseAdmin })

    await user.click(screen.getByRole('button', { name: 'Select unit' }))
    expect(screen.getByRole('option', { name: 'Elementary' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Secondary' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(screen.getByPlaceholderText('XXXX XXXX XXXX XXXX')).toBeDisabled()
    expect(screen.getAllByText(/Restricted.*permission/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('checkbox', { name: 'This is a legacy KPJ number' })).not.toBeInTheDocument()
  })

  it('locks sensitive identity fields after the one-day edit window', () => {
    setSystemTime(new Date('2026-09-19T12:00:00.000Z'))
    renderEmployeeForm({ employee: employeeFixture() })

    expect(screen.getByDisplayValue('3174 0101 0190 0001')).toBeDisabled()
    expect(screen.getByText(/Locked. Past the 1-day edit window/)).toBeVisible()
  })

  it('shows reset only for dirty edits and restores initial values', async () => {
    const { user } = renderEmployeeForm()
    const name = field('full_name').querySelector('input')
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()

    await user.clear(name)
    await user.type(name, 'Changed Employee')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(name).toHaveValue('Ari Employee')
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('disables save and reset while submission is pending', async () => {
    const { user } = renderEmployeeForm({ isSubmitting: true })
    const name = field('full_name').querySelector('input')
    await user.clear(name)
    await user.type(name, 'Changed Employee')

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('opens photo cropping for valid create photos and rejects oversized files', async () => {
    const { container } = renderEmployeeForm({ mode: 'create' })
    const input = container.querySelector('input[type="file"]')
    const photo = new File(['photo'], 'employee.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [photo] } })
    expect(await screen.findByRole('dialog', { name: 'Crop photo' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const oversized = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [oversized] } })
    expect(screen.queryByRole('dialog', { name: 'Crop photo' })).not.toBeInTheDocument()
  })
})
