import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { PCActivityMentorsDialog } from '../../../src/features/master-data/components/PCActivityMentorsDialog.jsx'
import { PCActivityMentorHistoryPanel } from '../../../src/features/master-data/components/PCActivityMentorHistoryPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const activity = {
  id: 'activity-1',
  name: 'Robotics',
  units: [
    { id: 'unit-elementary', name: 'Elementary' },
    { id: 'unit-junior-high', name: 'Junior High' },
  ],
}

const grades = [
  { id: 'grade-1', unit_id: 'unit-elementary', unit_name: 'Elementary' },
  { id: 'grade-2', unit_id: 'unit-junior-high', unit_name: 'Junior High' },
]

const mentors = [
  {
    id: 'mentor-elementary',
    unit_id: 'unit-elementary',
    identity: { full_name: 'Ari Mentor', email: 'ari@example.test' },
    employment: { job_level_id: 'level-teacher', job_position: 'Teacher' },
  },
  {
    id: 'mentor-junior-high',
    unit_id: 'unit-junior-high',
    identity: { full_name: 'Jordan Mentor', email: 'jordan@example.test' },
    employment: { job_level_id: 'level-teacher', job_position: 'Teacher' },
  },
]

function mentorRoutes(extra = []) {
  return [
    { path: /^\/api\/admin\/grades\?.*$/, response: () => jsonResponse({ data: grades }) },
    { path: '/api/admin/pc-activities-master/activity-1/default-mentors', response: () => jsonResponse({ data: [
      { unit_id: 'unit-elementary', mentor_id: 'mentor-elementary', mentor_name: 'Ari Mentor', mentor_unit_name: 'Elementary' },
    ] }) },
    { path: /^\/api\/admin\/employees\?.*$/, response: () => jsonResponse({ data: mentors, paging: { current_page: 1, total_page: 1, total_item: 2, size: 100 } }) },
    { path: /^\/api\/admin\/job-levels\?.*$/, response: () => jsonResponse({ data: [
      { id: 'level-teacher', name: 'Teacher', is_teaching_role: true },
    ] }) },
    { path: '/api/admin/pc-activities-master/activity-1/mentor-history', response: () => jsonResponse({ data: [] }) },
    ...extra,
  ]
}

describe('PC activity mentor flows', () => {
  it('assigns an eligible mentor per unit after showing the change confirmation', async () => {
    const fetchMock = createFetchRouter(mentorRoutes([
      { path: '/api/admin/pc-activities-master/activity-1/default-mentors/unit-junior-high', method: 'PATCH', response: jsonResponse({ data: true }) },
    ]))
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <PCActivityMentorsDialog activity={activity} canWrite onClose={() => {}} />
      </ConfirmProvider>,
    )

    expect(await screen.findByRole('button', { name: /Ari Mentor/ })).toBeVisible()
    const emptyMentor = screen.getByRole('button', { name: 'No default mentor' })
    await user.click(emptyMentor)
    await user.click(screen.getByRole('option', { name: /Jordan Mentor/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const confirm = screen.getByRole('dialog', { name: 'Confirm mentor change' })
    expect(within(confirm).getByText('Junior High')).toBeVisible()
    expect(within(confirm).getByText('No mentor')).toBeVisible()
    expect(within(confirm).getByText('Jordan Mentor')).toBeVisible()
    await user.click(within(confirm).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/default-mentors/unit-junior-high') &&
      options.method === 'PATCH' &&
      JSON.parse(options.body).mentor_id === 'mentor-junior-high')).toBe(true))
  })

  it('groups equivalent history across units and rolls every row back', async () => {
    const history = [
      { id: 'history-1', unit_id: 'unit-elementary', unit_name: 'Elementary', mentor_id: 'mentor-elementary', mentor_name: 'Ari Mentor', start_date: '2026-09-01T08:00:00.000Z', end_date: '2026-09-10T08:00:00.000Z', can_rollback: true },
      { id: 'history-2', unit_id: 'unit-junior-high', unit_name: 'Junior High', mentor_id: 'mentor-elementary', mentor_name: 'Ari Mentor', start_date: '2026-09-01T10:00:00.000Z', end_date: '2026-09-10T10:00:00.000Z', can_rollback: true },
    ]
    const fetchMock = createFetchRouter([
      { path: '/api/admin/pc-activities-master/activity-1/mentor-history', response: jsonResponse({ data: history }) },
      { path: /\/api\/admin\/pc-activities-master\/activity-1\/mentor-history\/history-[12]\/rollback/, method: 'PATCH', response: jsonResponse({ data: true }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <PCActivityMentorHistoryPanel activityId="activity-1" canWrite />
      </ConfirmProvider>,
    )

    expect(await screen.findByText('All Units')).toBeVisible()
    expect(screen.getAllByText('Ari Mentor')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Roll back' }))
    const confirm = screen.getByRole('dialog', { name: 'Roll back change' })
    expect(within(confirm).getByText(/restore the previous mentor for every unit/)).toBeVisible()
    await user.click(within(confirm).getByRole('button', { name: 'Roll back' }))

    await waitFor(() => {
      const rollbackCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/rollback'))
      expect(rollbackCalls).toHaveLength(2)
      expect(rollbackCalls.map(([url]) => url).sort()).toEqual([
        '/api/admin/pc-activities-master/activity-1/mentor-history/history-1/rollback',
        '/api/admin/pc-activities-master/activity-1/mentor-history/history-2/rollback',
      ])
    })
  })
})
