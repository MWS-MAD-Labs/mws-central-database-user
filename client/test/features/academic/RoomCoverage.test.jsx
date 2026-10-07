import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { RoomCoverage, RoomMentors } from '../../../src/features/academic/components/RoomCoverage.jsx'
import { coverageGroups, coverageSummary } from '../../../src/features/academic/utils/roomCoverage.js'
import { renderWithProviders } from '../../helpers/render.jsx'

const named = (...names) => names.map((name, index) => ({ id: `id-${index}`, name }))

const room = (extra = {}) => ({
  id: 'room-1',
  display_name: 'Robotics Monday',
  units: named('Elementary'),
  grades: named('Grade 1', 'Grade 2', 'Grade 3'),
  classes: [],
  mentors: named('Alpha Teacher', 'Beta Teacher'),
  ...extra,
})

describe('coverageSummary', () => {
  it('names only what narrows the room, one line', () => {
    expect(coverageSummary(room())).toBe('Elementary · 3 Grades')
    expect(coverageSummary(room({ units: named('A', 'B'), grades: named('Grade 1'), classes: named('1A', '1B') }))).toBe('2 Units · Grade 1 · 2 Classes')
    expect(coverageSummary(room({ grades: [], classes: named('1A') }))).toBe('Elementary · 1A')
  })

  it('says all units when nothing narrows it', () => {
    expect(coverageSummary(room({ units: [], grades: [], classes: [] }))).toBe('All Units')
  })

  it('leaves out the unit when only grades or classes narrow it', () => {
    expect(coverageSummary(room({ units: [], grades: named('Grade 1', 'Grade 2'), classes: [] }))).toBe('2 Grades')
  })
})

describe('coverageGroups', () => {
  it('lists every name, and says what an empty list means', () => {
    const groups = coverageGroups(room())
    expect(groups.map((group) => group.title)).toEqual(['Units', 'Grades', 'Classes'])
    expect(groups[1].items).toEqual(['Grade 1', 'Grade 2', 'Grade 3'])
    expect(groups[2]).toMatchObject({ items: ['Any class'], hideCount: true })
    expect(coverageGroups(room({ units: [] }))[0]).toMatchObject({ items: ['All units'], hideCount: true })
  })
})

describe('RoomCoverage', () => {
  it('shows the summary and opens the full lists on a click', async () => {
    const { user } = renderWithProviders(<RoomCoverage room={room()} />)
    await user.click(screen.getByRole('button', { name: 'Elementary · 3 Grades' }))
    const dialog = screen.getByRole('dialog', { name: 'Coverage of Robotics Monday' })
    expect(within(dialog).getByText('Grade 2')).toBeVisible()
    expect(within(dialog).getByText('Elementary')).toBeVisible()
    expect(within(dialog).getByText('Any class')).toBeVisible()
  })
})

describe('RoomMentors', () => {
  it('says there is no mentor, shows one name, and opens the list for several', async () => {
    const none = renderWithProviders(<RoomMentors room={room({ mentors: [] })} />)
    expect(screen.getByText('No mentor')).toBeVisible()
    none.unmount()

    const single = renderWithProviders(<RoomMentors room={room({ mentors: named('Alpha Teacher') })} />)
    expect(screen.getByText('Alpha Teacher')).toBeVisible()
    single.unmount()

    const many = renderWithProviders(<RoomMentors room={room()} />)
    expect(screen.queryByText('Beta Teacher')).not.toBeInTheDocument()
    await many.user.click(screen.getByRole('button', { name: /2 mentors/ }))
    expect(within(screen.getByRole('dialog', { name: 'Mentors of Robotics Monday' })).getByText('Beta Teacher')).toBeVisible()
  })
})
