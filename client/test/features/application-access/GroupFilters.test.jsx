import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { GroupFilters } from '../../../src/features/application-access/components/GroupFilters.jsx'
import { groupFilterErrors } from '../../../src/features/application-access/utils/groupFilterState.js'
import { renderWithProviders } from '../../helpers/render.jsx'

const options = {
  units: [{ id: 'mad', name: 'MAD Lab' }, { id: 'ele', name: 'Elementary' }],
  jobLevels: [{ id: 'lead', name: 'Lead' }],
  jobPositions: [{ id: 'aide', name: 'Aide' }],
}

function makeState(setUnits) {
  return {
    units: { selected: ['mad', 'ele'], setSelected: setUnits },
    levels: { selected: ['lead'], setSelected: () => {} },
    positions: { selected: null, setSelected: () => {} },
    availability: null,
    unsupported: [{ id: 'ele', name: 'Elementary' }],
    removed: null,
  }
}

describe('GroupFilters review', () => {
  it('warns about a unit with nothing to hold, removes it, and blocks saving until then', async () => {
    let picked = null
    const state = makeState((next) => { picked = next })
    const { user } = renderWithProviders(<GroupFilters audience="EMPLOYEES" options={options} state={state} showErrors />)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Elementary has no matching job level or position')
    expect(screen.getByText('Remove the units above before saving.')).toBeVisible()
    expect(screen.queryByText('Scope is ready to save.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Elementary' }))
    expect(picked).toEqual(['mad'])
  })

  it('counts the unit as an error for the save check', () => {
    expect(groupFilterErrors(makeState(() => {}), 'EMPLOYEES').units).toMatch(/Elementary has no matching job level or position/)
    expect(groupFilterErrors({ ...makeState(() => {}), unsupported: [] }, 'EMPLOYEES').units).toBeUndefined()
  })
})
