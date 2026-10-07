import { describe, expect, it } from 'bun:test'
import { screen, within } from '@testing-library/react'
import { RoomCoverage, RoomMentors } from '../../../src/features/academic/components/RoomCoverage.jsx'
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

describe('RoomCoverage', () => {
  it('shows one name as is, several as a count that opens the list, nothing as everything', async () => {
    const { user } = renderWithProviders(<RoomCoverage room={room()} />)
    const coverage = screen.getByLabelText('Coverage of Robotics Monday')
    expect(within(coverage).getByText('Elementary')).toBeVisible()
    // Classes are empty, so any class counts.
    expect(within(coverage).getByText('Any')).toBeVisible()

    await user.click(within(coverage).getByRole('button', { name: /3 grades/ }))
    const dialog = screen.getByRole('dialog', { name: 'Grades of Robotics Monday' })
    expect(within(dialog).getByText('Grade 2')).toBeVisible()
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
