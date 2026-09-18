import { afterEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../../helpers/render.jsx'
import { DateField } from '../../../../src/components/ui/formControls/DateField.jsx'

describe('DateField', () => {
  afterEach(() => setSystemTime())

  it('renders an ISO date using the fixed display format', () => {
    const { container } = renderWithProviders(<DateField id="join-date" name="join_date" value="2026-09-17" onChange={() => {}} />)

    expect(screen.getByRole('spinbutton', { name: 'Day' })).toHaveAttribute('aria-valuenow', '17')
    expect(screen.getByRole('spinbutton', { name: 'Month' })).toHaveAttribute('aria-valuenow', '9')
    expect(screen.getByRole('spinbutton', { name: 'Year' })).toHaveAttribute('aria-valuenow', '2026')
    const input = container.querySelector('input[name="join_date"]')
    expect(input).toHaveValue('17/09/2026')
    expect(input).toHaveAttribute('name', 'join_date')
  })

  it('keeps the synthetic date input event contract', async () => {
    setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    const onChange = mock(() => {})
    const { user } = renderWithProviders(<DateField value="2026-09-17" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /Choose date/ }))
    await user.click(await screen.findByRole('gridcell', { name: '18' }))

    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({
      target: {
        value: '2026-09-18',
        validity: { badInput: false },
      },
    })
  })
})
