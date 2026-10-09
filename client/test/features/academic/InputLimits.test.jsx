import { describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { NumberInput } from '../../../src/components/ui/formControls/NumberInput.jsx'
import { AcademicYearBulkCreateDialog } from '../../../src/features/academic/components/AcademicYearBulkCreateDialog.jsx'
import { AcademicYearDialog } from '../../../src/features/academic/components/AcademicYearDialog.jsx'
import { GradeDialog } from '../../../src/features/academic/components/GradeDialog.jsx'
import { LIMITS } from '../../../src/lib/limits.js'
import { renderWithProviders } from '../../helpers/render.jsx'

function Probe(props) {
  const [value, setValue] = useState('')
  return <NumberInput aria-label="Amount" value={value} onChange={setValue} {...props} />
}

describe('NumberInput', () => {
  it('takes digits only and no more of them than the largest number has', async () => {
    const user = userEvent.setup()
    render(<Probe min={2000} max={2100} />)
    await user.type(screen.getByLabelText('Amount'), 'ab20x2753445455445')
    expect(screen.getByLabelText('Amount')).toHaveValue('2027')
  })

  it('accepts a minus sign only when the lowest number is below zero', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Probe min={-2} max={20} />)
    await user.type(screen.getByLabelText('Amount'), '-15')
    expect(screen.getByLabelText('Amount')).toHaveValue('-15')
    unmount()
    render(<Probe min={1} max={100} />)
    await user.type(screen.getByLabelText('Amount'), '-15')
    expect(screen.getByLabelText('Amount')).toHaveValue('15')
  })
})

describe('GradeDialog', () => {
  const open = (onSubmit = mock()) => {
    render(<GradeDialog dialog={{ mode: 'create' }} isSubmitting={false} onClose={() => {}} onSubmit={onSubmit} />)
    const [name, level, age] = screen.getAllByRole('textbox')
    return { name, level, age, onSubmit }
  }

  it('stops the name at its limit and counts the characters', async () => {
    const user = userEvent.setup()
    const { name } = open()
    await user.type(name, 'x'.repeat(LIMITS.GRADE_NAME_MAX + 10))
    expect(name.value.length).toBe(LIMITS.GRADE_NAME_MAX)
    expect(screen.getByText(`${LIMITS.GRADE_NAME_MAX}/${LIMITS.GRADE_NAME_MAX}`)).toBeVisible()
  })

  it('refuses a level and an age outside their ranges, and sends the ones inside', async () => {
    const user = userEvent.setup()
    const { name, level, age, onSubmit } = open()
    await user.type(name, 'Grade 1')
    await user.type(level, '99')
    await user.type(age, '1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(`Use a level from ${LIMITS.GRADE_LEVEL_MIN} to ${LIMITS.GRADE_LEVEL_MAX}.`)).toBeVisible()
    expect(screen.getByText(`Use an age from ${LIMITS.GRADE_AGE_MIN} to ${LIMITS.GRADE_AGE_MAX}.`)).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.clear(level)
    await user.type(level, '7')
    await user.clear(age)
    await user.type(age, '12')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Grade 1', level: 7, typical_age: 12 })
  })
})

describe('AcademicYearDialog', () => {
  it('cannot be given a year like 202753445455445, and makes no name from a half typed year', async () => {
    const { user } = renderWithProviders(
      <AcademicYearDialog dialog={{ mode: 'create' }} suggestedStartYear={2026} isSubmitting={false} onClose={() => {}} onSubmit={() => {}} />,
    )
    const year = screen.getByRole('textbox')
    await user.clear(year)
    await user.type(year, '202753445455445')
    expect(year).toHaveValue('2027')
    expect(screen.getByText('Academic year name will be: 2027/2028')).toBeVisible()
    await user.clear(year)
    await user.type(year, '20')
    expect(screen.getByText('Academic year name will be: ...')).toBeVisible()
  })

  it('refuses a year outside the range on save', async () => {
    const onSubmit = mock()
    const { user } = renderWithProviders(<AcademicYearDialog dialog={{ mode: 'create' }} suggestedStartYear={2026} isSubmitting={false} onClose={() => {}} onSubmit={onSubmit} />)
    const year = screen.getByRole('textbox')
    await user.clear(year)
    await user.type(year, '1999')
    await user.click(screen.getByRole('button', { name: /Save|Create/ }))
    expect(screen.getByText(`Use a year between ${LIMITS.ACADEMIC_YEAR_MIN} and ${LIMITS.ACADEMIC_YEAR_MAX}.`)).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('AcademicYearBulkCreateDialog', () => {
  it('keeps both years to four digits', async () => {
    const user = userEvent.setup()
    render(<AcademicYearBulkCreateDialog suggestedStartYear={2026} existingYears={[]} isSubmitting={false} onClose={() => {}} onSubmit={() => {}} />)
    const [start, end] = screen.getAllByRole('textbox')
    await user.clear(start)
    await user.type(start, '20268888')
    await user.type(end, '203099999')
    expect(start).toHaveValue('2026')
    expect(end).toHaveValue('2030')
  })
})
