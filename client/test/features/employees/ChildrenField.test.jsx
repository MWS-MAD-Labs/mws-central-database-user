import { describe, expect, it, mock } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import { ChildrenField } from '../../../src/features/employees/components/ChildrenField.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

const yearsAgo = (years) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10)
}

function renderField(props = {}) {
  const onChange = mock(() => {})
  renderWithProviders(
    <ChildrenField value={[]} onChange={onChange} maritalStatus="MARRIED" parentBirthDate={yearsAgo(40)} {...props} />,
  )
  return onChange
}

describe('ChildrenField', () => {
  it('adds an empty biological row', () => {
    const onChange = renderField()
    expect(screen.getByText('No children')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /add child/i }))
    expect(onChange).toHaveBeenCalledWith([{ birth_date: '', relation: 'BIOLOGICAL' }])
  })

  it('shows the numbers worked out from the dates, as the list changes', () => {
    renderField({ value: [{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }, { birth_date: yearsAgo(25), relation: 'ADOPTED' }] })
    expect(screen.getByText('2 children: 1 under 23, 1 aged 23 or over')).toBeTruthy()
  })

  it('removes the row that is asked for', () => {
    const rows = [{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }, { birth_date: yearsAgo(8), relation: 'BIOLOGICAL' }]
    const onChange = renderField({ value: rows })
    fireEvent.click(screen.getByRole('button', { name: 'Remove child 1' }))
    expect(onChange).toHaveBeenCalledWith([rows[1]])
  })

  it('says why a row is wrong, in the row', () => {
    renderField({ maritalStatus: 'SINGLE', value: [{ birth_date: yearsAgo(5), relation: 'BIOLOGICAL' }] })
    expect(screen.getByText(/single can only have an adopted child/i)).toBeTruthy()
  })

  it('says a child is too close in age to the employee', () => {
    renderField({ parentBirthDate: yearsAgo(30), value: [{ birth_date: yearsAgo(20), relation: 'BIOLOGICAL' }] })
    expect(screen.getByText(/at least 18 years younger/i)).toBeTruthy()
  })
})
