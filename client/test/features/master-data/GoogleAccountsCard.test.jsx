import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoogleAccountsCard } from '../../../src/features/master-data/components/GoogleAccountsCard.jsx'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
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

const protectedAdmin = { id: 'a1', type: 'admin', role: 'SUPER_ADMIN', is_protected: true }
const plainAdmin = { id: 'a2', type: 'admin', role: 'SUPER_ADMIN', is_protected: false }

function renderCard(kind, data, extra = [], user = protectedAdmin) {
  const fetchMock = createFetchRouter([
    { path: `/api/admin/google/link-existing${kind === 'students' ? '?kind=students' : ''}`, method: 'GET', response: jsonResponse({ data }) },
    ...extra,
  ])
  globalThis.fetch = fetchMock
  return {
    ...renderWithProviders(
      <AuthContext.Provider value={{ user }}>
        <ConfirmProvider><GoogleAccountsCard kind={kind} /></ConfirmProvider>
      </AuthContext.Provider>,
    ),
    fetchMock,
  }
}

const many = (count, over = {}) =>
  Array.from({ length: count }, (_, index) =>
    person({ person_id: `p${index}`, full_name: `Person ${String(index + 1).padStart(2, '0')}`, email: `person${index + 1}@millennia21.id`, ...over }),
  )

describe('GoogleAccountsCard', () => {
  it('opens the names behind Failed, with what Google said', async () => {
    renderCard('staff', {
      ...base,
      failed: 1,
      failed_list: [person({ full_name: 'Budi Santoso', email: 'budi@millennia21.id', reason: 'Google refused the request' })],
    })
    await screen.findByText('Linked')
    await userEvent.click(screen.getByRole('button', { name: 'Failed, 1, show people' }))
    const dialog = await screen.findByRole('dialog', { name: 'Failed' })
    expect(within(dialog).getByText('Budi Santoso')).toBeVisible()
    expect(within(dialog).getByText('budi@millennia21.id · Employee')).toBeVisible()
    expect(within(dialog).getByText('Google refused the request')).toBeVisible()
  })

  it('looks the same for every number, and only the ones with people are buttons', async () => {
    renderCard('staff', { ...base, failed: 1, failed_list: many(1), missing: 0 })
    await screen.findByText('Linked')
    expect(screen.getAllByRole('button', { name: /show people/ })).toHaveLength(1)
    // The ones that do nothing are the same tile, not a different thing: label above, number below.
    const plain = screen.getByText('Deleted In Google').parentElement
    const clickable = screen.getByRole('button', { name: 'Failed, 1, show people' })
    expect(plain.className).toContain('rounded-2xl')
    expect(clickable.className).toContain('rounded-2xl')
    expect(within(plain).getByText('0').className).toBe(within(clickable).getByText('1').className)
  })

  it('keeps a long list to ten a page, and searches it', async () => {
    renderCard('staff', { ...base, missing: 25, missing_list: many(25) })
    await screen.findByText('Linked')
    await userEvent.click(screen.getByRole('button', { name: 'Deleted In Google, 25, show people' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deleted In Google' })
    expect(within(dialog).getByText('Page 1 of 3 / 25 people')).toBeVisible()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10)
    expect(within(dialog).getByText('Person 01')).toBeVisible()

    await userEvent.click(within(dialog).getByRole('button', { name: /next/i }))
    expect(within(dialog).getByText('Page 2 of 3 / 25 people')).toBeVisible()
    expect(within(dialog).getByText('Person 11')).toBeVisible()
    expect(within(dialog).queryByText('Person 01')).toBeNull()

    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search people' }), 'person23')
    expect(within(dialog).getByText('Page 1 of 1 / 1 person')).toBeVisible()
    expect(within(dialog).getByText('Person 23')).toBeVisible()
    await userEvent.clear(within(dialog).getByRole('searchbox', { name: 'Search people' }))
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search people' }), 'nobody here')
    expect(within(dialog).getByText('Nobody matches.')).toBeVisible()
  })

  it('says so when the server cut the list short', async () => {
    renderCard('staff', { ...base, failed: 500, failed_list: many(200) })
    await screen.findByText('Linked')
    await userEvent.click(screen.getByRole('button', { name: 'Failed, 500, show people' }))
    expect(await screen.findByText('Showing the first 200 of 500.')).toBeVisible()
  })

  it('opens the people who can be linked from its tile', async () => {
    renderCard('staff', { ...base, matches: [{ person_id: 'm1', full_name: 'Gita Lestari', email: 'gita@millennia21.id', person_type: 'EMPLOYEE' }] })
    expect(await screen.findByText('1 person can be linked')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'In Google, Not Linked, 1, show people' }))
    expect(within(await screen.findByRole('dialog', { name: 'In Google, Not Linked' })).getByText('Gita Lestari')).toBeVisible()
  })

  it('is the students card with kind students: its own title, the students endpoint, and a Cannot Be Linked tile', async () => {
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
    expect(await screen.findByText('1 student can be linked')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cannot Be Linked, 1, show people' }))
    const dialog = await screen.findByRole('dialog', { name: 'Cannot Be Linked' })
    expect(within(dialog).getByText(/Orang Lain/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Close Dialog' }))

    await user.click(screen.getByRole('button', { name: 'Link' }))
    const confirmDialog = await screen.findByRole('dialog', { name: 'Link Existing Accounts' })
    expect(within(confirmDialog).getByText(/1 student has an email that is already a Google account/)).toBeVisible()
    await user.click(within(confirmDialog).getByRole('button', { name: 'Link' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, options]) => String(url) === '/api/admin/google/link-existing?kind=students' && options?.method === 'POST')).toBe(true),
    )
  })

  it('has no Cannot Be Linked tile for staff', async () => {
    renderCard('staff', base)
    await screen.findByText('Linked')
    expect(screen.queryByText('Cannot Be Linked')).toBeNull()
  })
  describe('linking the students the rule refused', () => {
    const blocked = [
      person({ person_id: 's1', full_name: 'Alradya Hafzah Adienda', email: 'radya@millennia21.id', person_type: 'STUDENT', code: 'NAME_DIFFERS', forceable: true, google_name: 'Alradya Hafsah Adienda', reason: 'The name in Google (Alradya Hafsah Adienda) is not the name here (Alradya Hafzah Adienda), so it is not linked' }),
      person({ person_id: 's2', full_name: 'Ari Putra', email: 'ari@millennia21.id', person_type: 'STUDENT', code: 'ADMIN_ACCOUNT', forceable: false, google_name: 'Ari Putra', reason: 'That email belongs to a Workspace admin, which is not managed from here' }),
      person({ person_id: 's3', full_name: 'Aleysia Cyra Shakila', email: 'aleysia@millennia21.id', person_type: 'STUDENT', code: 'NOT_LEGACY', forceable: true, google_name: 'Aleysia Cyra Shakila', reason: 'Google already has this email. Only a legacy student can be linked to it.' }),
    ]
    const data = { ...base, kind: 'students', blocked }
    const route = { path: '/api/admin/google/link-students', method: 'POST', response: jsonResponse({ data: { linked: 2, results: [] } }) }

    it('lets a protected Super Admin tick the ones that can be linked, sees both names, and links only those', async () => {
      const { user, fetchMock } = renderCard('students', data, [route])
      await user.click(await screen.findByRole('button', { name: 'Cannot Be Linked, 3, show people' }))
      const dialog = await screen.findByRole('dialog', { name: 'Cannot Be Linked' })
      expect(within(dialog).getByText('Google: Alradya Hafsah Adienda · Central: Alradya Hafzah Adienda')).toBeVisible()
      // The admin account cannot be ticked.
      expect(within(dialog).getByRole('checkbox', { name: 'Link Ari Putra anyway' })).toBeDisabled()
      expect(within(dialog).getByRole('button', { name: 'Link Selected (0)' })).toBeDisabled()

      await user.click(within(dialog).getByRole('checkbox', { name: 'Select everyone who can be linked anyway' }))
      expect(within(dialog).getByRole('checkbox', { name: 'Link Ari Putra anyway' })).not.toBeChecked()
      await user.click(within(dialog).getByRole('button', { name: 'Link Selected (2)' }))
      const confirmDialog = await screen.findByRole('dialog', { name: 'Link Selected Students' })
      expect(within(confirmDialog).getByText(/2 students are linked to the Google account that has their email/)).toBeVisible()
      await user.click(within(confirmDialog).getByRole('button', { name: 'Link' }))
      await waitFor(() => {
        const post = fetchMock.mock.calls.find(([url, options]) => String(url) === '/api/admin/google/link-students' && options?.method === 'POST')
        expect(post).toBeTruthy()
        expect(JSON.parse(post[1].body).person_ids.sort()).toEqual(['s1', 's3'])
      })
    })

    it('offers no tick boxes to a Super Admin who is not protected', async () => {
      const { user } = renderCard('students', data, [route], plainAdmin)
      await user.click(await screen.findByRole('button', { name: 'Cannot Be Linked, 3, show people' }))
      const dialog = await screen.findByRole('dialog', { name: 'Cannot Be Linked' })
      expect(within(dialog).getByText('Alradya Hafzah Adienda')).toBeVisible()
      expect(within(dialog).queryByRole('checkbox')).toBeNull()
      expect(within(dialog).queryByRole('button', { name: /Link Selected/ })).toBeNull()
    })
  })
})
