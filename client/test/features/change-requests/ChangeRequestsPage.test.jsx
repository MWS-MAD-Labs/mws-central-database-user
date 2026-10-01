import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { ChangeRequestsPage } from '../../../src/features/change-requests/pages/ChangeRequestsPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function request(index, overrides = {}) {
  return {
    id: `request-${index}`,
    entity_type: 'Employee',
    entity_id: `employee-${index}`,
    entity_name: `Person ${index}`,
    field_name: 'nik',
    field_label: 'NIK',
    old_value: '111',
    new_value: '222',
    values_masked: false,
    reason: 'Typo when the record was created',
    status: 'PENDING',
    requested_by: { id: 'admin-1', full_name: 'Requester One', email: 'r@millennia21.id' },
    requested_at: '2026-10-01T02:00:00.000Z',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    can_decide: true,
    can_cancel: false,
    ...overrides,
  }
}

function renderPage() {
  return renderWithProviders(
    <MemoryRouter>
      <ConfirmProvider>
        <ChangeRequestsPage />
      </ConfirmProvider>
    </MemoryRouter>,
    { withRouter: false },
  )
}

describe('ChangeRequestsPage', () => {
  it('shows a compact paged table and asks the server for the next page', async () => {
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/identifier-change-requests\?.*/,
        response: ({ url }) => jsonResponse({
          data: [request(url.includes('page=2') ? 11 : 1)],
          paging: { current_page: url.includes('page=2') ? 2 : 1, total_page: 2, total_item: 11, size: 10 },
          can_approve: true,
          pending_decidable_count: 11,
        }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()

    expect(await screen.findByText('Person 1')).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Reason' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Person 11')).toBeVisible()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true)
  })

  it('asks for History from the server and caps the note at 100 characters', async () => {
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/identifier-change-requests\?.*/,
        response: ({ url }) => jsonResponse({
          data: url.includes('history=true')
            ? [request(2, { status: 'REJECTED', can_decide: false, decided_by: { id: 'a', full_name: 'Care Head', email: 'c@millennia21.id' }, decided_at: '2026-10-01T03:00:00.000Z', decision_note: 'Not needed' })]
            : [request(1)],
          paging: { current_page: 1, total_page: 1, total_item: 1, size: 10 },
          can_approve: true,
          pending_decidable_count: 1,
        }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()

    await screen.findByText('Person 1')
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject Request' })
    const note = within(dialog).getByRole('textbox')
    expect(note).toHaveAttribute('maxlength', '100')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByText('Person 2')).toBeVisible()
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('history=true'))).toBe(true))
    expect(screen.getByText('Not needed')).toBeVisible()
  })
})
