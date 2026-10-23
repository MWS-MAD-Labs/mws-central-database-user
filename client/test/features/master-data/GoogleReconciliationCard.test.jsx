import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoogleReconciliationCard } from '../../../src/features/master-data/components/GoogleReconciliationCard.jsx'
import { reconciliationCsv } from '../../../src/features/master-data/utils/reconciliationCsv.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const empty = { count: 0, rows: [], truncated: false }
const report = {
  generated_at: '2026-10-22T08:30:00.000Z',
  central_people: 120,
  google_users: 118,
  groups: {
    only_in_central: { count: 1, rows: [{ person_id: 'p1', type: 'Employee', name: 'Ari Putra', email: 'ari@millennia21.id', detail: 'No Google account for this email' }], truncated: false },
    only_in_google: { count: 2, rows: [{ person_id: null, type: 'Google', name: 'Old, Account', email: 'old@millennia21.id', detail: 'Nobody in Central has this email' }], truncated: true },
    not_linked: empty,
    email_differs: empty,
    name_differs: empty,
    should_be_suspended: empty,
    suspended_in_google: empty,
    link_broken: empty,
  },
}

describe('GoogleReconciliationCard', () => {
  it('asks Google nothing until Run Report is pressed, then shows the counts', async () => {
    const fetchMock = createFetchRouter([{ path: '/api/admin/google/reconcile', response: jsonResponse({ data: report }) }])
    globalThis.fetch = fetchMock
    renderWithProviders(<GoogleReconciliationCard />)
    expect(screen.getByText('Not run yet.')).toBeVisible()
    expect(fetchMock.mock.calls).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Run Report' }))
    await waitFor(() => expect(screen.getByText('Only In Google')).toBeVisible())
    expect(screen.getByText(/120 People In Central, 118 Accounts In Google/)).toBeVisible()
    expect(screen.getByText('First 1 shown. The CSV has the same.')).toBeVisible()
    expect(screen.getByRole('button', { name: /Download CSV/ })).toBeVisible()
  })

  it('writes one quoted line per row for a spreadsheet', () => {
    const csv = reconciliationCsv(report).split('\n')
    expect(csv[0]).toBe('section,type,name,email,detail')
    expect(csv).toContain('"Only In Central","Employee","Ari Putra","ari@millennia21.id","No Google account for this email"')
    expect(csv).toContain('"Only In Google","Google","Old, Account","old@millennia21.id","Nobody in Central has this email"')
  })
})
