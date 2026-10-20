import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import { ChildrenField } from '../../../src/features/employees/components/ChildrenField.jsx'
import { emptyChildrenValue } from '../../../src/features/employees/utils/childrenRules.js'
import { renderWithProviders } from '../../helpers/render.jsx'

const yearsAgo = (years) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10)
}

const dated = (rows) => ({ ...emptyChildrenValue(), mode: 'BIRTH_DATES', rows })
const counted = (counts, extra = {}) => ({
  ...emptyChildrenValue(),
  mode: 'COUNTS',
  counts: { under_23: '', age_23_plus: '', adopted: '', ...counts },
  ...extra,
})

function renderField(props = {}) {
  const onChange = mock(() => {})
  renderWithProviders(
    <ChildrenField value={dated([])} onChange={onChange} maritalStatus="MARRIED" parentBirthDate={yearsAgo(40)} {...props} />,
  )
  return onChange
}

describe('ChildrenField', () => {
  it('offers the three ways to record, with none picked by default', () => {
    renderField({ value: emptyChildrenValue() })
    expect(screen.getByRole('tab', { name: 'No Children Recorded' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'With Birth Dates' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Numbers Only' })).toHaveAttribute('aria-selected', 'false')
  })

  it('switches the way without losing what was typed in the other', () => {
    const value = { ...dated([{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }]) }
    const onChange = renderField({ value })
    fireEvent.click(screen.getByRole('tab', { name: 'Numbers Only' }))
    expect(onChange).toHaveBeenCalledWith({ ...value, mode: 'COUNTS' })
  })

  it('shows a blank row to fill in right away, with no add button until the date is filled', () => {
    renderField()
    expect(screen.queryByRole('button', { name: /^add child$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add another child after child 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove child 1' })).toBeDisabled()
  })

  it('adds a blank row right under the one whose date is filled', () => {
    const rows = [{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }, { birth_date: yearsAgo(8), relation: 'BIOLOGICAL' }]
    const onChange = renderField({ value: dated(rows) })
    fireEvent.click(screen.getByRole('button', { name: 'Add another child after child 1' }))
    expect(onChange.mock.calls[0][0].rows).toEqual([rows[0], { birth_date: '', relation: 'BIOLOGICAL' }, rows[1]])
  })

  it('adds an adopted row when the employee is single, since it is the only choice', () => {
    const onChange = renderField({ maritalStatus: 'SINGLE', value: dated([{ birth_date: yearsAgo(5), relation: 'ADOPTED' }]) })
    fireEvent.click(screen.getByRole('button', { name: 'Add another child after child 1' }))
    expect(onChange.mock.calls[0][0].rows[1]).toEqual({ birth_date: '', relation: 'ADOPTED' })
  })

  it('disables biological and step while single, and keeps every choice for a married employee', () => {
    const rows = [{ birth_date: yearsAgo(5), relation: 'ADOPTED' }]
    const { unmount } = renderWithProviders(
      <ChildrenField value={dated(rows)} onChange={() => {}} maritalStatus="SINGLE" parentBirthDate={yearsAgo(40)} />,
    )
    fireEvent.click(document.querySelector('[aria-haspopup="listbox"]'))
    expect(screen.getByRole('option', { name: /Biological/ })).toBeDisabled()
    expect(screen.getByRole('option', { name: /Step/ })).toBeDisabled()
    expect(screen.getByRole('option', { name: /Adopted/ })).not.toBeDisabled()
    unmount()

    renderWithProviders(
      <ChildrenField value={dated(rows)} onChange={() => {}} maritalStatus="MARRIED" parentBirthDate={yearsAgo(40)} />,
    )
    fireEvent.click(document.querySelector('[aria-haspopup="listbox"]'))
    expect(screen.getByRole('option', { name: /Biological/ })).not.toBeDisabled()
    expect(screen.getByRole('option', { name: /Step/ })).not.toBeDisabled()
  })

  it('shows the numbers worked out from the dates, as the list changes', () => {
    renderField({ value: dated([{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }, { birth_date: yearsAgo(25), relation: 'ADOPTED' }]) })
    expect(screen.getByText('2 children: 1 under 23, 1 aged 23 or over')).toBeTruthy()
  })

  it('removes the row that is asked for', () => {
    const rows = [{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }, { birth_date: yearsAgo(8), relation: 'BIOLOGICAL' }]
    const onChange = renderField({ value: dated(rows) })
    fireEvent.click(screen.getByRole('button', { name: 'Remove child 1' }))
    expect(onChange.mock.calls[0][0].rows).toEqual([rows[1]])
  })

  it('marks a row that was biological before the status became single', () => {
    renderField({ maritalStatus: 'SINGLE', value: dated([{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }]) })
    expect(screen.getByText(/single can only have an adopted child/i)).toBeTruthy()
  })

  it('says a child is too close in age to the employee', () => {
    renderField({ parentBirthDate: yearsAgo(30), value: dated([{ birth_date: yearsAgo(20), relation: 'BIOLOGICAL' }]) })
    expect(screen.getByText(/at least 18 years younger/i)).toBeTruthy()
  })

  it('takes the three numbers and adds them up', () => {
    const onChange = renderField({ value: counted({ under_23: '2', age_23_plus: '1', adopted: '1' }) })
    expect(screen.getByLabelText('U-23')).toHaveValue('2')
    expect(screen.getByText('3 children: 2 under 23, 1 aged 23 or over')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('23 or Older'), { target: { value: '3' } })
    expect(onChange.mock.calls[0][0].counts.age_23_plus).toBe('3')
  })

  it('says why the numbers do not fit a single employee', () => {
    renderField({ maritalStatus: 'SINGLE', value: counted({ under_23: '2', adopted: '1' }) })
    expect(screen.getByText(/single can only have adopted children/i)).toBeTruthy()
  })

  it('asks for a review when the numbers were last confirmed over a year ago, and confirms on request', () => {
    const old = new Date()
    old.setUTCFullYear(old.getUTCFullYear() - 2)
    const value = counted({ under_23: '1', adopted: '0' }, { declared_at: old.toISOString(), needs_review: true })
    const onChange = renderField({ value })
    expect(screen.getByText(/Needs review/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm still correct' }))
    expect(onChange.mock.calls[0][0].confirmed).toBe(true)
  })
})
