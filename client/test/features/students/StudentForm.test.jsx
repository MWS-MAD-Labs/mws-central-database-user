import { beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { StudentForm } from '../../../src/features/students/components/StudentForm.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import {
  elementaryDatabaseAdmin,
  studentFixture,
  studentFormOptions,
  superAdminUser,
} from '../../fixtures/students.js'

function renderStudentForm({
  mode = 'edit',
  student = studentFixture(),
  options = studentFormOptions,
  user = superAdminUser,
  onSubmit = mock(() => {}),
  isSubmitting = false,
} = {}) {
  const result = renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <StudentForm
          mode={mode}
          student={mode === 'edit' ? student : undefined}
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

async function chooseSelect(user, placeholder, optionName) {
  await user.click(screen.getByRole('button', { name: placeholder }))
  await user.click(screen.getByRole('option', { name: optionName }))
}

describe('StudentForm', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('does not save an untouched create form as a draft', async () => {
    const first = renderStudentForm({ mode: 'create' })

    await new Promise((resolve) => setTimeout(resolve, 450))
    first.unmount()
    renderStudentForm({ mode: 'create' })

    expect(screen.queryByRole('dialog', { name: 'Continue student draft?' })).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem('mws:create-draft:student')).toBeNull()
  })

  it('saves only user changes as a create draft', async () => {
    const first = renderStudentForm({ mode: 'create' })
    await first.user.type(field('full_name').querySelector('input'), 'Draft Student')

    await waitFor(() => {
      const saved = JSON.parse(window.sessionStorage.getItem('mws:create-draft:student'))
      expect(saved.filled_field_count).toBe(1)
    })
    first.unmount()
    renderStudentForm({ mode: 'create' })

    expect(screen.getByRole('dialog', { name: 'Continue student draft?' })).toBeVisible()
    expect(screen.getByText(/draft with 1 filled fields/i)).toBeVisible()
  })

  it('keeps the submit disabled while required fields are blank', async () => {
    const { onSubmit } = renderStudentForm({ mode: 'create' })

    const submit = screen.getByRole('button', { name: 'Create student' })
    expect(submit).toBeDisabled()
    expect(submit.title).toStartWith('Fix before saving:')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a valid create payload with normalized values and services', async () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    const { user, onSubmit } = renderStudentForm({ mode: 'create' })

    await user.type(field('full_name').querySelector('input'), 'ari student')
    await user.type(field('nick_name').querySelector('input'), 'ari')
    await user.type(field('email_local').querySelector('input'), 'ari.student')
    await chooseSelect(user, 'Select Gender', 'Male')
    await chooseSelect(user, 'Select Religion', 'Islam')
    await user.type(field('birth_place').querySelector('input'), 'jakarta')

    await chooseSelect(user, 'Select Current Grade', 'Grade 1')
    await chooseSelect(user, 'Select Join Year', '2025/2026')
    await chooseSelect(user, 'Select Join Grade', 'Grade 1')
    await user.click(screen.getByRole('checkbox', { name: 'Pickup/Drop' }))
    await user.click(screen.getByRole('checkbox', { name: 'PSB Guide' }))

    const birthDate = field('birth_date')
    await user.click(within(birthDate).getByRole('button', { name: 'Choose date' }))
    await user.click(await screen.findByRole('gridcell', { name: '1' }))
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await user.keyboard('{Escape}')
    fireEvent.submit(document.querySelector('form'))
    const review = await screen.findByRole('dialog', { name: 'Review before creating' })
    await user.click(within(review).getByRole('button', { name: 'Create student' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      full_name: 'Ari Student',
      nick_name: 'Ari',
      email: 'ari.student@millennia21.id',
      gender: 'MALE',
      religion: 'ISLAM',
      religion_other: null,
      birth_place: 'Jakarta',
      entry_type: 'PSB',
      current_grade_id: 'grade-1',
      join_academic_year_id: 'year-2025',
      join_grade_id: 'grade-1',
      pickup_drop_service: true,
      catering_service: false,
      psb_guide: true,
    })
    expect(onSubmit.mock.calls[0][1]).toBeNull()
  })

  it('requires religion details when OTHER is selected', async () => {
    const { user, onSubmit } = renderStudentForm({ mode: 'create' })
    await user.click(screen.getByRole('button', { name: 'Select Religion' }))
    await user.click(screen.getByRole('option', { name: 'Other' }))

    // Without the religion detail the form still counts as incomplete.
    expect(screen.getByRole('button', { name: 'Create student' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('requires legacy NIS and graduation fields for a migrated graduate', async () => {
    const { user, onSubmit } = renderStudentForm({ mode: 'create' })
    await user.click(screen.getByRole('checkbox', { name: /Historical Data/ }))
    await chooseSelect(user, 'Not set (create as Registered)', 'Graduated')

    // Legacy graduate data is required before submit unlocks.
    expect(screen.getByRole('button', { name: 'Create student' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('locks encoded and enrollment-owned academic fields in edit mode', () => {
    renderStudentForm({
      student: studentFixture({
        academic: {
          has_active_enrollment_history: true,
          has_completed_enrollment: true,
        },
        status: 'GRADUATED',
      }),
    })

    expect(screen.getByRole('button', { name: 'PSB' })).toBeDisabled()
    expect(within(field('current_grade_id')).getByRole('button', { name: 'Grade 1' })).toBeDisabled()
    expect(screen.getAllByText(/real completed enrollment/)).toHaveLength(2)
  })

  it('limits current grades to the database admin unit while keeping join grades broad', async () => {
    const { user } = renderStudentForm({
      user: elementaryDatabaseAdmin,
      student: studentFixture({ academic: { current_grade: 'Grade 1', join_grade: 'Grade 7' } }),
    })

    await user.click(screen.getByRole('button', { name: 'Grade 1' }))
    expect(screen.getByRole('option', { name: 'Grade 2' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Grade 7' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Grade 7' }))
    expect(screen.getByRole('option', { name: 'Grade 7' })).toBeVisible()
  })

  it('locks NISN after the edit window', () => {
    setSystemTime(new Date('2026-09-19T12:00:00.000Z'))
    renderStudentForm({ student: studentFixture() })

    expect(field('nisn')?.querySelector('input') ?? screen.getByDisplayValue('1234567890')).toBeDisabled()
    expect(screen.getByText(/Locked, past the 1-day edit window/)).toBeVisible()
  })

  it('requires confirmation before changing NISN', async () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    const { user, onSubmit } = renderStudentForm({ student: studentFixture() })
    const nisn = screen.getByDisplayValue('1234567890')
    await user.clear(nisn)
    await user.type(nisn, '0987654321')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('dialog', { name: 'Review changes before saving' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await user.click(screen.getByRole('button', { name: 'Save and lock NISN' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].nisn).toBe('0987654321')
  })

  it('shows reset only for dirty edit state and restores initial values', async () => {
    const { user } = renderStudentForm()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    const name = field('full_name').querySelector('input')
    await user.clear(name)
    await user.type(name, 'Changed Name')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(name).toHaveValue('Ari Student')
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('disables save while a submission is pending', () => {
    renderStudentForm({ isSubmitting: true })
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('aria-busy', 'true')
  })

  it('rejects oversized create photos before opening the crop dialog', () => {
    const { container } = renderStudentForm({ mode: 'create' })
    const input = container.querySelector('input[type="file"]')
    const oversized = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [oversized] } })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
