import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { useState } from 'react'
import { renderWithProviders } from '../../../helpers/render.jsx'
import {
  EmailField,
  LimitedField,
  PhoneField,
  ReligionFields,
} from '../../../../src/components/ui/formControls/CompositeFields.jsx'

describe('composite form fields', () => {
  it('limits and transforms text values', async () => {
    const updateValue = mock(() => {})
    const { user } = renderWithProviders(
      <LimitedField
        label="Full name"
        field="full_name"
        max={10}
        values={{ full_name: '' }}
        errors={{}}
        updateValue={updateValue}
        required
        transform={(value) => value.toUpperCase()}
        placeholder="Enter name"
      />,
    )

    await user.type(screen.getByPlaceholderText('Enter name'), 'ari')
    expect(updateValue).toHaveBeenLastCalledWith('full_name', 'I')
    expect(screen.getByText('Up to 10 characters')).toBeVisible()
    expect(screen.getByText('0/10 characters')).toBeVisible()
  })

  it('normalizes phone input and supports custom field names', async () => {
    function Harness() {
      const [values, setValues] = useState({ phone: '' })
      return (
        <PhoneField
          label="Parent phone"
          field="phone"
          values={values}
          errors={{}}
          updateValue={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
        />
      )
    }
    const { user } = renderWithProviders(
      <Harness />,
    )

    const input = screen.getByPlaceholderText('08xx, +628xx, or 628xx')
    await user.type(input, '+62 812-a')
    expect(input).toHaveValue('+62812')
  })

  it('renders a fixed email domain and sanitizes the local part', async () => {
    const updateValue = mock(() => {})
    const { user } = renderWithProviders(
      <EmailField
        domain="millennia21.id"
        max={20}
        values={{ email_local: '' }}
        errors={{}}
        updateValue={updateValue}
        sanitize={(value) => value.toLowerCase().replace(/[^a-z.]/g, '')}
      />,
    )

    expect(screen.getByText('@millennia21.id')).toBeVisible()
    await user.type(screen.getByRole('textbox'), 'Ari 1')
    expect(updateValue).toHaveBeenLastCalledWith('email_local', '')
    expect(screen.getByText('Format: name@millennia21.id')).toBeVisible()
    expect(screen.getByText(/0\/20 characters/)).toBeVisible()
  })

  it('shows and clears the OTHER religion detail field', async () => {
    function Harness() {
      const [values, setValues] = useState({ religion: 'OTHER', religion_other: 'Sikh' })
      return (
        <>
          <ReligionFields
            values={values}
            errors={{}}
            setValues={setValues}
            religionOptions={['ISLAM', 'OTHER']}
            required
          />
          <output>{JSON.stringify(values)}</output>
        </>
      )
    }

    const { user } = renderWithProviders(<Harness />)
    expect(screen.getByPlaceholderText('e.g. Sikh')).toHaveValue('Sikh')

    await user.click(screen.getByRole('button', { name: /Other/ }))
    await user.click(screen.getByRole('option', { name: 'Islam' }))

    expect(screen.queryByPlaceholderText('e.g. Sikh')).not.toBeInTheDocument()
    expect(screen.getByText(/"religion_other":""/)).toBeVisible()
  })
})
