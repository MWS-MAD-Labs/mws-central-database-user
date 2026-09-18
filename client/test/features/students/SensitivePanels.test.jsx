import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentHealthPanel } from '../../../src/features/students/components/sensitivePanels/StudentHealthPanel.jsx'
import { StudentVaccinePanel } from '../../../src/features/students/components/sensitivePanels/StudentVaccinePanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function renderPanel(panel) {
  return renderWithProviders(<ConfirmProvider>{panel}</ConfirmProvider>)
}

describe('student sensitive panels', () => {
  it('does not request health data before explicit reveal', async () => {
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/health-record', response: jsonResponse({ data: { blood_type: 'A', needs_assistance: false } }) },
      { path: '/api/admin/students/student-1/health-notes?is_deleted=false', response: jsonResponse({ data: [] }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(
      <StudentHealthPanel studentId="student-1" canWrite canViewSensitive />,
    )

    expect(screen.getByRole('button', { name: 'Show Health & Special Needs' })).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Show Health & Special Needs' }))
    expect(screen.getByRole('dialog', { name: 'View health & special needs' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View' }))

    expect(await screen.findByText('No health or special needs notes yet.')).toBeVisible()
    expect(screen.getByText('A')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sessionStorage.getItem('pii-reveal:student-health:student-1')).not.toBeNull()
    await waitFor(() => expect(screen.queryByText('Syncing')).not.toBeInTheDocument())
  })

  it('keeps health data hidden from users without sensitive access', () => {
    const fetchMock = createFetchRouter([])
    globalThis.fetch = fetchMock
    renderPanel(
      <StudentHealthPanel studentId="student-1" canWrite canViewSensitive={false} />,
    )
    expect(screen.getByText(/Restricted/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reuses recent health reveal memory without prompting again', async () => {
    sessionStorage.setItem('pii-reveal:student-health:student-1', String(Date.now()))
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/students/student-1/health-record', response: jsonResponse({ data: null }) },
      { path: '/api/admin/students/student-1/health-notes?is_deleted=false', response: jsonResponse({ data: [] }) },
    ])
    renderPanel(
      <StudentHealthPanel studentId="student-1" canWrite={false} canViewSensitive />,
    )
    expect(await screen.findByText('No health or special needs notes yet.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show Health & Special Needs' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Syncing')).not.toBeInTheDocument())
  })

  it('reveals vaccine records and creates a record', async () => {
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/vaccine-records?is_deleted=false', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/students/student-1/vaccine-records', method: 'POST', response: jsonResponse({ data: { id: 'vaccine-1' } }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(
      <StudentVaccinePanel studentId="student-1" canWrite canViewSensitive />,
    )

    await user.click(screen.getByRole('button', { name: 'Show Vaccine Records' }))
    await user.click(screen.getByRole('button', { name: 'View' }))
    expect(await screen.findByText('No vaccine records yet.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Vaccine' }))
    expect(screen.getByRole('dialog', { name: 'New Vaccine Record' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/students/student-1/vaccine-records' && options.method === 'POST',
    )).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Vaccine Record' })).not.toBeInTheDocument())
  })
})
