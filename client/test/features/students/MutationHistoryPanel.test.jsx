import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { StudentMutationHistoryPanel } from '../../../src/features/students/components/StudentMutationHistoryPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const history = [
  {
    id: 'history-1',
    field: 'ENTRY_TYPE',
    value: 'TRANSFER',
    start_date: '2026-09-01T00:00:00.000Z',
    end_date: null,
    can_rollback: true,
  },
  {
    id: 'history-2',
    field: 'JOIN_GRADE',
    value: 'Grade 7',
    start_date: '2026-09-01T00:00:00.000Z',
    end_date: null,
    can_rollback: false,
  },
]

describe('StudentMutationHistoryPanel', () => {
  it('loads, groups, formats, and rolls back history', async () => {
    const fetchMock = createFetchRouter([
      { path: '/api/admin/students/student-1/mutation-history', response: jsonResponse({ data: history }) },
      { path: '/api/admin/students/student-1/mutation-history/history-1/rollback', method: 'PATCH', response: jsonResponse({ data: true }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <StudentMutationHistoryPanel studentId="student-1" canWrite />
      </ConfirmProvider>,
    )

    expect(await screen.findByText('Transfer')).toBeVisible()
    expect(screen.getByText('Grade 7')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    await user.click(screen.getByTitle('Undo this Entry Type change'))
    expect(screen.getByRole('dialog', { name: 'Roll back change' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Roll back' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/history-1/rollback') && options.method === 'PATCH',
    )).toBe(true))
  })

  it('renders empty history and hides rollback for read-only users', async () => {
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/students/student-1/mutation-history', response: jsonResponse({ data: [] }) },
    ])
    renderWithProviders(
      <ConfirmProvider>
        <StudentMutationHistoryPanel studentId="student-1" canWrite={false} />
      </ConfirmProvider>,
    )
    expect(await screen.findByText('No mutation history found.')).toBeVisible()
    expect(screen.queryByTitle(/Undo/)).not.toBeInTheDocument()
  })
})
