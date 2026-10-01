import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { MyChangeRequestsPage } from '../../../src/features/change-requests/pages/MyChangeRequestsPage.jsx'
import { RequestStatusHint } from '../../../src/features/change-requests/components/RequestStatusHint.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function request(id, overrides = {}) {
  return {
    id,
    entity_type: 'Employee',
    entity_id: `employee-${id}`,
    entity_name: `Person ${id}`,
    field_name: 'nik',
    field_label: 'NIK',
    old_value: '111',
    new_value: '222',
    values_masked: false,
    reason: 'Typo when the record was created',
    status: 'PENDING',
    requested_by: { id: 'me', full_name: 'Me', email: 'me@millennia21.id' },
    requested_at: '2026-10-01T02:00:00.000Z',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    can_decide: false,
    can_cancel: false,
    ...overrides,
  }
}

const decidedBy = { id: 'care', full_name: 'Care Head', email: 'care@millennia21.id' }

function renderPage() {
  return renderWithProviders(
    <MemoryRouter>
      <ConfirmProvider>
        <MyChangeRequestsPage />
      </ConfirmProvider>
    </MemoryRouter>,
    { withRouter: false },
  )
}

describe('MyChangeRequestsPage', () => {
  it('shows the decision and note, and marks the decisions as seen once', async () => {
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/identifier-change-requests\/mine\?.*/,
        response: jsonResponse({
          data: [
            request('1', { status: 'REJECTED', decided_by: decidedBy, decided_at: '2026-10-01T03:00:00.000Z', decision_note: 'Please attach the KTP' }),
            request('2', { status: 'PENDING', can_cancel: true }),
          ],
          paging: { current_page: 1, total_page: 1, total_item: 2, size: 10 },
          unseen_decided_count: 1,
        }),
      },
      { path: '/api/admin/identifier-change-requests/mine/seen', method: 'POST', response: jsonResponse({ data: 1 }) },
    ])
    globalThis.fetch = fetchMock
    renderPage()

    expect(await screen.findByText('Person 1')).toBeVisible()
    expect(screen.getByText('Please attach the KTP')).toBeVisible()
    expect(screen.getByText('Care Head')).toBeVisible()
    expect(screen.getByText('Waiting for an approver')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible()

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/mine/seen'))).toHaveLength(1),
    )
  })

  it('does not call mark-seen when there is nothing new', async () => {
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/identifier-change-requests\/mine\?.*/,
        response: jsonResponse({
          data: [request('3')],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
          unseen_decided_count: 0,
        }),
      },
    ])
    globalThis.fetch = fetchMock
    renderPage()
    await screen.findByText('Person 3')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/mine/seen'))).toBe(false)
  })
})

describe('RequestStatusHint', () => {
  it('describes pending, approved and rejected requests, and ignores cancelled ones', () => {
    const { rerender } = renderWithProviders(<RequestStatusHint request={request('4', { status: 'PENDING' })} />)
    expect(screen.getByText('Change request pending.')).toBeVisible()

    rerender(<RequestStatusHint request={request('5', { status: 'APPROVED' })} />)
    expect(screen.getByText('Last request approved.')).toBeVisible()

    rerender(<RequestStatusHint request={request('6', { status: 'REJECTED', decision_note: 'Not needed' })} />)
    expect(screen.getByText('Last request rejected: Not needed')).toBeVisible()

    rerender(<RequestStatusHint request={request('7', { status: 'CANCELLED' })} />)
    expect(screen.queryByText(/Last request|pending/)).not.toBeInTheDocument()
  })
})
