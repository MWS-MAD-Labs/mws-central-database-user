import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentHealthPanel } from '../../../src/features/students/components/sensitivePanels/StudentHealthPanel.jsx'
import { StudentPcActivitiesPanel } from '../../../src/features/students/components/sensitivePanels/StudentPcActivitiesPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function renderPanel(panel) {
  return renderWithProviders(<ConfirmProvider>{panel}</ConfirmProvider>)
}

describe('StudentHealthPanel mutations', () => {
  it('creates a health note and a health record', async () => {
    sessionStorage.setItem('pii-reveal:student-health:student-1', String(Date.now()))
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/health-record', response: ({ method }) => method === 'POST' ? jsonResponse({ data: { blood_type: null, needs_assistance: true } }) : jsonResponse({ data: null }) },
      { path: '/api/admin/students/student-1/health-notes?is_deleted=false', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/students/student-1/health-notes', method: 'POST', response: jsonResponse({ data: { id: 'note-1' } }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<StudentHealthPanel studentId="student-1" canWrite canViewSensitive />)
    expect(await screen.findByText('No health or special needs notes yet.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Health Note' }))
    const dialog = screen.getByRole('dialog', { name: 'New Health Note' })
    await user.type(dialog.querySelector('[data-field="description"] textarea'), 'Updated health information')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/health-notes') && options.method === 'POST' &&
      JSON.parse(options.body).category === 'HEALTH_INFO',
    )).toBe(true))

    await user.click(screen.getByRole('button', { name: 'More Actions' }))
    await user.click(screen.getByRole('button', { name: 'Edit Blood Type' }))
    const bloodTypeDialog = screen.getByRole('dialog', { name: 'Edit Blood Type' })
    await user.click(within(bloodTypeDialog).getByRole('button', { name: 'Select Blood Type' }))
    await user.click(screen.getByRole('option', { name: 'A' }))
    await user.click(within(bloodTypeDialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/health-record') && options.method === 'POST' &&
      JSON.parse(options.body).blood_type === 'A',
    )).toBe(true))
  })

  it('edits, deletes, and restores health data', async () => {
    sessionStorage.setItem('pii-reveal:student-health:student-1', String(Date.now()))
    const note = {
      id: 'note-1', category: 'HEALTH_INFO', description: 'Asthma plan', status: 'ACTIVE',
      noted_date: '2026-09-01T00:00:00.000Z', resolved_date: null, deleted_at: null,
    }
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/health-record', response: jsonResponse({ data: { blood_type: 'O', needs_assistance: false } }) },
      { path: '/api/admin/students/student-1/health-notes?is_deleted=false', response: jsonResponse({ data: [note] }) },
      { path: '/api/admin/students/student-1/health-notes/note-1', method: 'PATCH', response: jsonResponse({ data: note }) },
      { path: '/api/admin/students/student-1/health-notes/delete/note-1', method: 'PATCH', response: jsonResponse({ data: note }) },
      { path: '/api/admin/students/student-1/health-record/delete', method: 'PATCH', response: jsonResponse({ data: true }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<StudentHealthPanel studentId="student-1" canWrite canViewSensitive />)
    expect(await screen.findByText('Asthma plan')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Health Note' })
    await user.clear(dialog.querySelector('[data-field="description"] textarea'))
    await user.type(dialog.querySelector('[data-field="description"] textarea'), 'Updated asthma plan')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/health-notes/note-1') && options.method === 'PATCH',
    )).toBe(true))

    const noteCard = screen.getByText('Asthma plan').closest('article')
    await user.click(within(noteCard).getAllByRole('button')[1])
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/health-notes/delete/note-1'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'More Actions' }))
    await user.click(screen.getByRole('button', { name: 'Delete Blood Type' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/health-record/delete'))).toBe(true))
  })
})

describe('StudentPcActivitiesPanel', () => {
  it('filters activities by unit and creates, edits, deletes, and restores a record', async () => {
    const activity = {
      id: 'pc-1', day: 'MONDAY', activity_id: 'activity-1', activity: 'Reading Club',
      mentor_name: 'Taylor Mentor', academic_year_id: 'year-1', deleted_at: null,
    }
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/pc-activities?is_deleted=false', response: jsonResponse({ data: [activity] }) },
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: [{ id: 'year-1', name: '2026/2027' }] }) },
      { path: /^\/api\/admin\/pc-activities-master(?:\?.*)?$/, response: jsonResponse({ data: [
        { id: 'activity-1', name: 'Reading Club', units: [{ id: 'unit-1' }] },
        { id: 'activity-2', name: 'Other Unit Club', units: [{ id: 'unit-2' }] },
      ] }) },
      { path: '/api/admin/students/student-1/pc-activities', method: 'POST', response: jsonResponse({ data: activity }) },
      { path: '/api/admin/students/student-1/pc-activities/pc-1', method: 'PATCH', response: jsonResponse({ data: activity }) },
      { path: '/api/admin/students/student-1/pc-activities/delete/pc-1', method: 'PATCH', response: jsonResponse({ data: activity }) },
      { path: '/api/admin/students/student-1/pc-activities?is_deleted=true', response: jsonResponse({ data: [{ ...activity, deleted_at: '2026-09-17T10:00:00.000Z' }] }) },
      { path: '/api/admin/students/student-1/pc-activities/restore/pc-1', method: 'PATCH', response: jsonResponse({ data: activity }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<StudentPcActivitiesPanel studentId="student-1" canWrite studentUnitId="unit-1" />)
    expect(await screen.findByText('Reading Club')).toBeVisible()
    expect(screen.getByText(/Taylor Mentor \/ 2026\/2027/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Activity' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Activity is required.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Select Activity' }))
    expect(screen.getByRole('option', { name: 'Reading Club' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Other Unit Club' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Reading Club' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/pc-activities') && options.method === 'POST',
    )).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/pc-activities/pc-1') && options.method === 'PATCH',
    )).toBe(true))

    const card = screen.getByText('Reading Club').closest('article')
    await user.click(within(card).getAllByRole('button')[1])
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/pc-activities/delete/pc-1'))).toBe(true))

    await user.click(screen.getByRole('switch', { name: 'Show Deleted' }))
    expect(await screen.findByText('Deleted')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/pc-activities/restore/pc-1'))).toBe(true))
  })
})
