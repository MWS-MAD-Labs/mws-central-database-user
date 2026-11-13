import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoogleAccountsCard } from '../../../src/features/master-data/components/GoogleAccountsCard.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const base = {
  applied: false,
  linked: 0,
  matches: [],
  skipped: { admin: 0, linked_elsewhere: 0, not_allowed: 0 },
  linked_total: 4,
  not_in_google: 0,
  not_checked: 0,
  suspended: 0,
  missing: 0,
  failed: 0,
  blocked: [],
  suspended_list: [],
  missing_list: [],
  failed_list: [],
}

const person = (over) => ({ person_id: 'p', full_name: 'Ari Putra', email: 'ari@millennia21.id', person_type: 'EMPLOYEE', reason: null, ...over })

function renderCard(kind, data, extra = []) {
  const fetchMock = createFetchRouter([
    { path: `/api/admin/google/link-existing${kind === 'students' ? '?kind=students' : ''}`, method: 'GET', response: jsonResponse({ data }) },
    ...extra,
  ])
  globalThis.fetch = fetchMock
  return { ...renderWithProviders(<ConfirmProvider><GoogleAccountsCard kind={kind} /></ConfirmProvider>), fetchMock }
}

describe('GoogleAccountsCard', () => {
  it('opens the names behind Failed and Deleted In Google, with what Google said', async () => {
    renderCard('staff', {
      ...base,
      failed: 1,
      missing: 2,
      failed_list: [person({ full_name: 'Budi Santoso', email: 'budi@millennia21.id', reason: 'Google refused the request' })],
      missing_list: [
        person({ person_id: 'a', full_name: 'Citra Dewi', reason: 'Deleted in Google, can be restored for about 20 days' }),
        person({ person_id: 'b', full_name: 'Dian Ayu', person_type: 'INTERN', reason: 'Not found in Google' }),
      ],
    })
    await screen.findByText('Linked')
    await userEvent.click(screen.getByRole('button', { name: '1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Failed' })
    expect(within(dialog).getByText('Budi Santoso')).toBeVisible()
    expect(within(dialog).getByText('budi@millennia21.id · Employee · Google refused the request')).toBeVisible()
  })

  it('shows a plain number when nobody is behind it', async () => {
    renderCard('staff', base)
    await screen.findByText('Linked')
    expect(screen.queryByRole('button', { name: '0' })).toBeNull()
  })

  it('is the students card with kind students: its own title, the students endpoint, and who cannot be linked', async () => {
    const link = { path: '/api/admin/google/link-existing?kind=students', method: 'POST', response: jsonResponse({ data: { ...base, applied: true, linked: 1 } }) }
    const { user, fetchMock } = renderCard(
      'students',
      {
        ...base,
        kind: 'students',
        matches: [{ person_id: 's1', full_name: 'Eka Putra', email: 'eka@millennia21.id', person_type: 'STUDENT' }],
        blocked: [person({ person_id: 's2', full_name: 'Fajar Nur', email: 'fajar@millennia21.id', person_type: 'STUDENT', reason: 'The name in Google (Orang Lain) is not the name here (Fajar Nur), so it is not linked' })],
      },
      [link],
    )
    expect(await screen.findByText('Student Google Accounts')).toBeVisible()
    expect(await screen.findByText('Students who can be linked')).toBeVisible()

    // The second list is the students who cannot be linked, with the reason.
    await user.click(screen.getAllByRole('button', { name: 'List' })[1])
    expect(await screen.findByText(/Orang Lain/)).toBeVisible()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Link' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Link Existing Accounts' })
    expect(within(confirmDialog).getByText(/1 student has an email that is already a Google account/)).toBeVisible()
    await user.click(within(confirmDialog).getByRole('button', { name: 'Link' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, options]) => String(url) === '/api/admin/google/link-existing?kind=students' && options?.method === 'POST')).toBe(true),
    )
  })
})
