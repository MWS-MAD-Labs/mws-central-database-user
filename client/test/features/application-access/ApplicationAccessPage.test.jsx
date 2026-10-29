import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { Route, Routes } from 'react-router'
import toast, { Toaster } from 'react-hot-toast'
import { ApplicationAccessPage } from '../../../src/features/application-access/pages/ApplicationAccessPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const applications = [
  {
    application_id: 'exima',
    setup_completed: true,
    name: 'Exima',
    can_remove: false,
    retire_available: true,
    retired: false,
    organization_id: 'org_exima_a1b2c3',
    launch_mode: 'sso',
    session_mode: 'shared',
    health: { status: 'check_token', detail: 'Still calling with an old token', since: '2026-10-23T08:00:00.000Z' },
    scope: 'safespace',
    connection_created: true,
    connection_last_used_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    permission_count: 7,
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
    launch_mode: 'sso',
    connection_created: false,
    connection_last_used_at: null,
    permission_count: 0,
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
      path: '/api/admin/application-access/taxonomy',
      response: () => jsonResponse({ data: { categories: [], scopes: [{ key: 'safespace', name: 'Safespace' }] } }),
    },
    {
      path: /\/api\/admin\/application-access\/applications/,
      method: 'GET',
      response: () => jsonResponse({ data: applications, paging }),
    },
  ]
}

// The toast host asks for the reduced-motion setting, which the test window does not have.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })

function renderPage(user = { role: 'SUPER_ADMIN', is_protected: true }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <Toaster />
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
    expect(await screen.findByText('Only a protected Super Admin can manage application access.')).toBeVisible()
  })

  it('lists applications with connection, permissions, roles, groups, exceptions and blocked counts', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    const exima = (await screen.findByText('exima')).closest('tr')
    expect(within(exima).getByText('Exima')).toBeVisible()
    expect(await within(exima).findByText('Safespace')).toBeVisible()
    expect(within(exima).getByText('Check Token')).toBeVisible()
    expect(within(exima).getByText('7')).toBeVisible()
    expect(within(exima).getByText('3')).toBeVisible()
    expect(within(exima).getByText('2')).toBeVisible()
    expect(within(exima).getByText('4')).toBeVisible()
    expect(within(exima).getByText('1 Blocked')).toBeVisible()
    const hub = screen.getByText('hub').closest('tr')
    expect(within(hub).getByText('HUB')).toBeVisible()
    expect(within(hub).getByText('Not Connected')).toBeVisible()
    expect(within(hub).getAllByText('None')).toHaveLength(3)
  })

  it('opens the guide from the header', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    await screen.findByText('Exima')
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/application-access/guides')
    expect(screen.queryByText('No Hub has been added yet.')).toBeNull()
  })

  it('tells where to start when there is no Hub yet', async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /\/api\/admin\/application-access\/applications/,
        method: 'GET',
        response: () => jsonResponse({ data: applications.filter((row) => !row.is_hub), paging }),
      },
      ...routes().slice(0, 1),
    ])
    renderPage()
    expect(await screen.findByText('No Hub has been added yet.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open The Guide' })).toHaveAttribute('href', '/application-access/guides?part=hub')
    // One way into the guide at a time.
    expect(screen.queryByRole('link', { name: 'Guide' })).toBeNull()
  })

  it('marks an application that still uses an old token', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    await screen.findByText('Exima')
    expect(screen.getAllByText('Check Token')).toHaveLength(1)
    expect(screen.queryByText('Unreachable')).toBeNull()
  })

  it('marks an application whose new token or sign-in way has not been seen yet', async () => {
    globalThis.fetch = createFetchRouter(routes())
    applications[0].health = { status: 'token_pending', detail: 'Waiting', since: null }
    renderPage()
    await screen.findByText('Exima')
    expect(screen.getAllByText('Update Pending')).toHaveLength(1)
    applications[0].health = { status: 'check_token', detail: 'Still calling with an old token', since: '2026-10-23T08:00:00.000Z' }
  })

  it('marks a wrong path and a shared origin, and Check Now asks the address right away', async () => {
    toast.remove()
    const fetchMock = createFetchRouter(
      routes([
        {
          path: '/api/admin/application-access/apps/exima/check',
          method: 'POST',
          response: () => jsonResponse({ data: { verdict: 'wrong_path' } }),
        },
      ]),
    )
    globalThis.fetch = fetchMock
    applications[0].health = { status: 'wrong_path', detail: 'The sign-in address answers Not Found', since: null }
    applications[0].shares_origin_with = ['Learnspace']
    try {
      const { user } = renderPage()
      await screen.findByText('Exima')
      expect(screen.getAllByText('Needs Attention')).toHaveLength(1)
      expect(screen.getByText('Shared Origin')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Actions for exima' }))
      await user.click(screen.getByRole('button', { name: 'Check Now' }))
      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([url, options]) => url.endsWith('/apps/exima/check') && options?.method === 'POST')).toBe(true)
      })
      expect(await screen.findByText(/sign-in page does not exist/)).toBeInTheDocument()
    } finally {
      applications[0].health = { status: 'check_token', detail: 'Still calling with an old token', since: '2026-10-23T08:00:00.000Z' }
      delete applications[0].shares_origin_with
    }
  })

  it('marks an application that reads the shared Hub session', async () => {
    globalThis.fetch = createFetchRouter(routes())
    renderPage()
    await screen.findByText('Exima')
    expect(screen.getAllByText('Shared Session')).toHaveLength(1)
  })

  it('has no Organization ID column and copies it from the menu', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('exima')
    expect(screen.queryByText('org_exima_a1b2c3')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions for exima' }))
    await user.click(screen.getByRole('button', { name: 'Copy Organization ID' }))
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe('org_exima_a1b2c3')
    })
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
    expect(within(hubRow).getByTitle('The Hub itself. It can only be removed after every other application.')).toBeVisible()
    await user.click(within(hubRow).getByRole('button', { name: 'Actions for hub' }))
    expect(await screen.findByRole('button', { name: 'Open' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Setup Steps' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Application' })).toBeNull()
    await user.keyboard('{Escape}')
    await user.click(document.body)
    const eximaRow = screen.getByRole('button', { name: 'Actions for exima' }).closest('tr')
    await user.click(within(eximaRow).getByRole('button', { name: 'Actions for exima' }))
    expect(await screen.findByRole('button', { name: 'Retire Application' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
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

  it('opens the page of an application from the menu', async () => {
    globalThis.fetch = createFetchRouter(routes())
    const { user } = renderPage()
    await screen.findByText('exima')
    expect(screen.queryByRole('button', { name: 'Manage exima' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions for exima' }))
    await user.click(screen.getByRole('button', { name: 'Open' }))
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
