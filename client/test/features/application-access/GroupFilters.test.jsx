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

const none = { units: [], levels: [], all: [] }

function makeState(setUnits, unsupported) {
  return {
    units: { selected: ['mad', 'ele'], setSelected: setUnits },
    levels: { selected: ['lead'], setSelected: () => {} },
    positions: { selected: null, setSelected: () => {} },
    availability: null,
    unsupported: unsupported || { units: [{ id: 'ele', name: 'Elementary' }], levels: [], all: [{ id: 'ele', name: 'Elementary', kind: 'units' }] },
    dropPicks: (picks) => setUnits(picks),
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/Elementary.*no matching job level or position|no matching job level or position.*Elementary/)
    expect(screen.getByText('Remove the picks above before saving.')).toBeVisible()
    expect(screen.queryByText('Scope is ready to save.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Elementary' }))
    expect(picked).toEqual({ units: ['ele'] })
  })

  it('offers Remove right away on the Levels step', async () => {
    let picked = null
    const state = makeState((next) => { picked = next })
    const { user } = renderWithProviders(<GroupFilters audience="EMPLOYEES" options={options} state={state} showErrors />)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Elementary.*no matching job level or position|no matching job level or position.*Elementary/)
    await user.click(screen.getByRole('button', { name: 'Remove Elementary' }))
    expect(picked).toEqual({ units: ['ele'] })
  })

  it('lists several picks in one notice and clears them with Remove all', async () => {
    let picked = null
    const many = {
      units: [{ id: 'ele', name: 'Elementary' }, { id: 'jh', name: 'Junior High' }],
      levels: [{ id: 'lead', name: 'Lead' }],
      all: [
        { id: 'ele', name: 'Elementary', kind: 'units' },
        { id: 'jh', name: 'Junior High', kind: 'units' },
        { id: 'lead', name: 'Lead', kind: 'levels' },
      ],
    }
    const state = makeState((next) => { picked = next }, many)
    const { user } = renderWithProviders(<GroupFilters audience="EMPLOYEES" options={options} state={state} showErrors />)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Remove Junior High' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(picked).toEqual({ units: ['ele', 'jh'], levels: ['lead'] })
  })

  it('counts the unit as an error for the save check', () => {
    expect(groupFilterErrors(makeState(() => {}), 'EMPLOYEES').units).toMatch(/Elementary has no matching job level or position/)
    expect(groupFilterErrors({ ...makeState(() => {}), unsupported: none }, 'EMPLOYEES').units).toBeUndefined()
    const lead = { units: [], levels: [{ id: 'lead', name: 'Lead' }], all: [{ id: 'lead', name: 'Lead', kind: 'levels' }] }
    expect(groupFilterErrors(makeState(() => {}, lead), 'EMPLOYEES').levels).toMatch(/Lead has no matching unit or position/)
  })

  it('points out units without students on a student group and removes them', async () => {
    let picked = null
    const students = {
      units: { selected: ['ele', 'mad'], setSelected: () => {} },
      levels: { selected: null, setSelected: () => {} },
      positions: { selected: null, setSelected: () => {} },
      availability: null,
      unsupported: { units: [], levels: [], all: [] },
      dropPicks: (next) => { picked = next },
      removed: null,
    }
    const { user } = renderWithProviders(
      <GroupFilters audience="STUDENTS" options={options} state={students} studentUnits={[{ id: 'ele', name: 'Elementary' }]} showErrors />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('This unit has no students.')
    await user.click(screen.getByRole('button', { name: 'Remove MAD Lab' }))
    expect(picked).toEqual({ units: ['mad'] })
    expect(groupFilterErrors(students, 'STUDENTS', undefined, new Set(['ele'])).units).toMatch(/have no students/)
  })
})
