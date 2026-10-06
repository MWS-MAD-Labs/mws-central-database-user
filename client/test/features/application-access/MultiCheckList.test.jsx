import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { MultiCheckList } from '../../../src/features/application-access/components/MultiCheckList.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('MultiCheckList', () => {
  it('summarizes long unit requirements and opens the complete list', async () => {
    const units = ['MAD Lab', 'Elementary', 'Junior High', 'Kindergarten', 'CARE']
    const { user } = renderWithProviders(
      <MultiCheckList
        label="Job Positions"
        allLabel="All Positions"
        items={[
          {
            id: 'position-1',
            name: 'IT Support',
            disabled: true,
            reason: { kind: 'units', names: units },
          },
        ]}
        selection={{ selected: [], setSelected: () => {} }}
      />,
    )

    expect(screen.getByText('Needs one of')).toBeVisible()
    expect(screen.queryByText('MAD Lab')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '5 units' }))

    const dialog = screen.getByRole('dialog', { name: 'Units required by IT Support' })
    for (const unit of units) expect(dialog).toHaveTextContent(unit)
  })
})
