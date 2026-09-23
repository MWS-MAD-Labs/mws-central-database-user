import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { InternMutationHistoryPanel } from '../../../src/features/interns/components/InternMutationHistoryPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('InternMutationHistoryPanel', () => {
  it('loads intern fields and rolls back the current value', async () => {
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/interns/intern-1/mutation-history',
        response: jsonResponse({
          data: [
            {
              id: 'history-1',
              field: 'BUILDING',
              value: 'Annex',
              start_date: '2026-09-01T00:00:00.000Z',
              end_date: null,
              can_rollback: true,
            },
          ],
        }),
      },
      {
        path: '/api/admin/interns/intern-1/mutation-history/history-1/rollback',
        method: 'PATCH',
        response: jsonResponse({ data: true }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <InternMutationHistoryPanel internId="intern-1" canWrite />
      </ConfirmProvider>,
    )

    expect(await screen.findByText('Annex')).toBeVisible()
    await user.click(screen.getByTitle('Undo this Building change'))
    await user.click(screen.getByRole('button', { name: 'Roll back' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url.endsWith('/history-1/rollback') && options.method === 'PATCH',
    )).toBe(true))
  })
})
