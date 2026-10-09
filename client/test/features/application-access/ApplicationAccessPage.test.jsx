import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { Route, Routes } from 'react-router'
import { ApplicationAccessPage } from '../../../src/features/application-access/pages/ApplicationAccessPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const applications = [
  {
    application_id: 'exima',
    name: 'Exima',
    can_remove: false,
    retire_available: true,
    retired: false,
    organization_id: 'org_exima_a1b2c3',
    role_count: 3,
    active_group_count: 2,
    exception_count: 4,
    blocked_count: 1,
    updated_at: '2026-10-02T03:00:00.000Z',
  },
  {
    application_id: 'hub',
    name: 'HUB',
    is_hub: true,
    can_remove: false,
    retire_available: false,
    retired: false,
    organization_id: null,
    role_count: 0,
    active_group_count: 0,
    exception_count: 0,
    blocked_count: 0,
    updated_at: null,
  },
]

const paging = { current_page: 1, total_page: 2, total_item: 12, size: 10 }

function routes(extra = []) {
  return [
    ...extra,
    {
      path: /\/api\/admin\/application-access\/applications/,
      method: 'GET',
      response: () => jsonResponse({ data: applications, paging }),
    },
  ]
}

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Routes>
          <Route path="/application-access" element={<ApplicationAccessPage />} />
          <Route path="/application-access/apps/new" element={<div>New application page</div>} />
          <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
        </Routes>
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route: '/application-access' },
  )
}

describe('ApplicationAccessPage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('lists applications with roles, groups, exceptions and blocked counts', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    const exima = (await screen.findByText('exima')).closest('tr')
    expect(within(exima).getByText('org_exima_a1b2c3')).toBeVisible()
    expect(within(exima).getByText('3')).toBeVisible()
    expect(within(exima).getByText('2')).toBeVisible()
    expect(within(exima).getByText('4')).toBeVisible()
    expect(within(exima).getByText('1 Blocked')).toBeVisible()
    const hub = screen.getByText('hub').closest('tr')
    expect(within(hub).getAllByText('None')).toHaveLength(2)
  })

  it('copies the organization id when it is clicked and has no Copy button', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Copy org_exima_a1b2c3' }))
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe('org_exima_a1b2c3')
    })
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  })

  it('pages and searches on the server', async () => {
    const fetchMock = createFetchRouter(routes())
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await screen.findByText('exima')
    expect(screen.getByText(/Page 1 of 2/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url.includes('page=2'))).toBe(true)
    })

    await user.type(screen.getByPlaceholderText('Search applications'), 'exi')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url.includes('search=exi'))).toBe(true)
    })
  })

  it('marks the Hub and gives it no Delete in its menu, while other rows keep Delete', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    const hubRow = (await screen.findByRole('button', { name: 'Actions for hub' })).closest('tr')
    expect(within(hubRow).getByText('Core')).toBeVisible()
    expect(within(hubRow).getByTitle('The Hub itself. It cannot be retired or deleted.')).toBeVisible()
    await user.click(within(hubRow).getByRole('button', { name: 'Actions for hub' }))
    expect(await screen.findByRole('button', { name: 'Setup Steps' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Delete Application' })).toBeNull()
    await user.keyboard('{Escape}')
    await user.click(document.body)
    const eximaRow = screen.getByRole('button', { name: 'Actions for exima' }).closest('tr')
    await user.click(within(eximaRow).getByRole('button', { name: 'Actions for exima' }))
    expect(await screen.findByRole('button', { name: 'Retire Application' })).toBeVisible()
  })

  describe('the row menu offers what applies', () => {
    async function menuFor(row) {
      const rows = [{ ...applications[0], ...row }]
      globalThis.fetch = createFetchRouter([
        ...routes().slice(0, 0),
        { path: /\/api\/admin\/application-access\/applications/, method: 'GET', response: () => jsonResponse({ data: rows, paging }) },
        { path: '/api/admin/application-access/apps/exima/restore', method: 'POST', response: () => jsonResponse({ data: {} }) },
      ])
      const { user } = renderPage()
      await user.click(await screen.findByRole('button', { name: 'Actions for exima' }))
      return user
    }

    it('offers Retire alone while it cannot be deleted', async () => {
      await menuFor({})
      expect(await screen.findByRole('button', { name: 'Retire Application' })).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Delete Application' })).toBeNull()
    })

    it('offers Retire and Delete when it can be deleted', async () => {
      await menuFor({ can_remove: true, retire_available: false })
      expect(await screen.findByRole('button', { name: 'Retire Application' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Delete Application' })).toBeVisible()
    })

    it('offers Restore and Delete for a retired application, and restores it', async () => {
      const user = await menuFor({ retired: true, can_remove: true, retire_available: false })
      expect(screen.queryByRole('button', { name: 'Retire Application' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Delete Application' })).toBeVisible()
      await user.click(await screen.findByRole('button', { name: 'Restore Application' }))
      await waitFor(() => expect(globalThis.fetch.mock.calls.some(([url, options]) => String(url).endsWith('/restore') && options?.method === 'POST')).toBe(true))
    })
  })

  it('opens the page of an application from Manage', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('exima')
    await user.click(screen.getByRole('button', { name: 'Manage exima' }))
    expect(await screen.findByText('App page')).toBeVisible()
  })

  it('opens the add application page', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('exima')
    await user.click(screen.getByRole('button', { name: 'Add Application' }))
    expect(await screen.findByText('New application page')).toBeVisible()
  })
})
