import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { ApiClientsPage } from '../../../src/features/api-clients/pages/ApiClientsPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { superAdminUser } from '../../fixtures/employees.js'

const scopes = [
  { name: 'employees:read', description: 'Read employees', is_sensitive: false },
  { name: 'students:health:read', description: 'Read health', is_sensitive: true },
]

const hubProfile = {
  id: 'profile-hub',
  code: 'hub',
  name: 'MWS Hub',
  description: 'Hub integration',
  status: 'ACTIVE',
  version: 2,
  is_system: true,
  client_count: 1,
  scopes: [scopes[0]],
}

function renderPage(extraRoutes = [], { profiles = [hubProfile], clients = [], endpoints = [] } = {}) {
  const fetchMock = createFetchRouter([
    ...extraRoutes,
    { path: '/api/admin/api-clients', method: 'GET', response: () => jsonResponse({ data: clients }) },
    { path: '/api/admin/api-clients/internal-endpoints', response: () => jsonResponse({ data: endpoints }) },
    {
      path: '/api/admin/application-integration-profiles',
      method: 'GET',
      response: () => jsonResponse({ data: profiles, environment: 'DEVELOPMENT' }),
    },
    { path: '/api/admin/application-integration-profiles/scopes', response: () => jsonResponse({ data: scopes }) },
  ])
  globalThis.fetch = fetchMock
  const result = renderWithProviders(
    <AuthContext.Provider value={{ user: superAdminUser }}>
      <ConfirmProvider>
        <ApiClientsPage />
      </ConfirmProvider>
    </AuthContext.Provider>,
  )
  return { ...result, fetchMock }
}

const legacyClient = {
  id: 'legacy-1',
  name: 'Old Reporting Tool',
  description: 'Before applications',
  status: 'ACTIVE',
  is_active: true,
  profile: null,
  effective_scopes: ['employees:read'],
  credentials: [],
  last_used_at: null,
}

const appClient = {
  id: 'c1',
  name: 'MWS Hub (DEVELOPMENT/backend)',
  status: 'ACTIVE',
  is_active: true,
  profile: { id: 'profile-hub', code: 'hub', name: 'MWS Hub', version: 2 },
  effective_scopes: ['employees:read'],
  credentials: [],
}

describe('ApiClientsPage as a reference', () => {
  const owned = { ...hubProfile, application: { application_id: 'hub', name: 'Hub App' } }

  it('has no way to make clients or profiles, those belong to Application Access', async () => {
    renderPage([], { profiles: [owned], clients: [appClient] })
    expect(await screen.findByRole('heading', { name: 'API Reference' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /New Client|New Profile|New Standalone Profile/ })).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('leaves out the clients of applications and hides Other Clients when none are left', async () => {
    renderPage([], { profiles: [owned], clients: [appClient] })
    await screen.findByRole('heading', { name: 'API Reference' })
    await waitFor(() => expect(screen.queryByText('Other Clients')).toBeNull())
    expect(screen.queryByText('MWS Hub')).toBeNull()
  })

  it('lists clients that belong to no application and revokes one after confirming', async () => {
    const revoked = []
    const { user } = renderPage(
      [
        {
          path: '/api/admin/api-clients/revoke/legacy-1',
          method: 'PATCH',
          response: () => {
            revoked.push('legacy-1')
            return jsonResponse({ data: { ...legacyClient, is_active: false, status: 'REVOKED' } })
          },
        },
      ],
      { profiles: [owned], clients: [appClient, legacyClient] },
    )
    expect(await screen.findByText('Other Clients')).toBeVisible()
    expect(screen.getByText('Old Reporting Tool')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Actions for Old Reporting Tool/ }))
    await user.click(await screen.findByRole('button', { name: 'Revoke Client' }))
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revoked).toEqual(['legacy-1']))
  })

  it('rotates a client token and shows the new one', async () => {
    const { user } = renderPage(
      [
        {
          path: '/api/admin/api-clients/rotate/legacy-1',
          method: 'PATCH',
          response: () => jsonResponse({ data: { ...legacyClient, token: 'mws_new.secret', credentials: [] } }),
        },
      ],
      { profiles: [owned], clients: [legacyClient] },
    )
    await user.click(await screen.findByRole('button', { name: /Actions for Old Reporting Tool/ }))
    await user.click(await screen.findByRole('button', { name: 'Rotate Credentials' }))
    await user.click(await screen.findByRole('button', { name: 'Rotate' }))
    await user.click(await screen.findByRole('button', { name: 'Start Rotation' }))
    expect(await screen.findByText('Rotated Credentials')).toBeVisible()
  })

  it('shows the note of an endpoint that takes an application id', async () => {
    renderPage([], {
      endpoints: [
        {
          method: 'PUT',
          path: '/api/internal/application-permissions/{application_id}',
          scope: 'employees:read',
          title: 'Publish application permissions',
          group: 'Application Access',
          purpose: 'An application sends the permissions its code understands.',
          note: 'Use me instead of the application ID to mean the application this token was made for.',
        },
      ],
    })
    expect(await screen.findByText(/Use me instead of the application ID/)).toBeVisible()
  })

  describe('per app view of the endpoints', () => {
    const endpoints = [
      { method: 'GET', path: '/api/internal/employees', scope: 'employees:read', title: 'List employees', group: 'Employees', purpose: 'Gets employees.' },
      { method: 'GET', path: '/api/internal/students/roster', scope: 'students:roster_export:read', title: 'Full student roster', group: 'Students', purpose: 'Gets the roster.' },
      { method: 'GET', path: '/api/internal/orphan', scope: 'classes:read', title: 'List classes', group: 'Classes and Teachers', purpose: 'Gets classes.' },
    ]
    const profile = (code, name, names) => ({
      ...hubProfile,
      id: `profile-${code}`,
      code,
      name,
      scopes: names.map((scopeName) => ({ name: scopeName, description: '', is_sensitive: false })),
    })
    const profiles = [
      profile('hub', 'MWS Hub', ['employees:read']),
      profile('daily-checkin', 'Daily Check-in', ['employees:read', 'students:roster_export:read']),
    ]

    it('says which apps use each scope, and that a scope used by one app is only for it', async () => {
      renderPage([], { profiles, endpoints })
      const all = (await screen.findByText('List employees')).closest('tr')
      expect(within(all).getByText('All Apps')).toBeVisible()
      const only = screen.getByText('Full student roster').closest('tr')
      expect(within(only).getByText('Daily Check-in')).toBeVisible()
      expect(within(screen.getByText('List classes').closest('tr')).getByText('No app yet')).toBeVisible()
    })

    it('filters the endpoints by app', async () => {
      const { user } = renderPage([], { profiles, endpoints })
      await screen.findByText('List employees')
      await user.click(screen.getByRole('button', { name: 'All Apps' }))
      await user.click(await screen.findByRole('option', { name: 'Daily Check-in' }))
      expect(await screen.findByText('Full student roster')).toBeVisible()
      expect(screen.getByText('List employees')).toBeVisible()
      expect(screen.queryByText('List classes')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Daily Check-in' }))
      await user.click(await screen.findByRole('option', { name: 'MWS Hub' }))
      expect(await screen.findByText('List employees')).toBeVisible()
      expect(screen.queryByText('Full student roster')).not.toBeInTheDocument()
    })
  })

  describe('endpoint details', () => {
    const endpoints = [
      { method: 'GET', path: '/api/internal/students', scope: 'students:read', title: 'List students', group: 'Students', purpose: 'Gets the list of students.' },
    ]

    it('keeps the method and path out of the way until Details is opened', async () => {
      const { user } = renderPage([], { endpoints })
      await screen.findByText('List students')
      expect(screen.queryByText('/api/internal/students')).not.toBeInTheDocument()
      expect(screen.getByText('Students')).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'Details of List students' }))
      expect(await screen.findByText('/api/internal/students')).toBeVisible()
      expect(screen.getByText('GET')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Copy path of List students' })).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'Details of List students' }))
      expect(screen.queryByText('/api/internal/students')).not.toBeInTheDocument()
    })
  })

  describe('Try dialog', () => {
    const endpoints = [
      { method: 'GET', path: '/api/internal/students', scope: 'students:read', title: 'List students', group: 'Students', purpose: 'Gets the list of students.' },
      { method: 'GET', path: '/api/internal/students/{student_id}/health', scope: 'students:health:read', title: 'Student health information', group: 'Students', purpose: 'Gives health information.' },
    ]

    it('opens a guided dialog with Send disabled until a token is typed', async () => {
      const { user } = renderPage([], { endpoints })
      await screen.findByText('List students')
      const row = screen.getByText('List students').closest('tr')
      await user.click(within(row).getByRole('button', { name: 'Try' }))

      const dialog = await screen.findByRole('dialog', { name: 'Try "List students"' })
      expect(within(dialog).getByText('Gets the list of students.')).toBeVisible()
      const send = within(dialog).getByRole('button', { name: 'Send request' })
      expect(send).toBeDisabled()
      await user.type(within(dialog).getByRole('textbox', { name: /API Token/ }), 'mws_token')
      expect(send).not.toBeDisabled()
    })

    it('keeps Send disabled while the path still has placeholders', async () => {
      const { user } = renderPage([], { endpoints })
      await screen.findByText('Student health information')
      const row = screen.getByText('Student health information').closest('tr')
      await user.click(within(row).getByRole('button', { name: 'Try' }))
      const dialog = await screen.findByRole('dialog', { name: 'Try "Student health information"' })

      await user.type(within(dialog).getByRole('textbox', { name: /API Token/ }), 'mws_token')
      expect(within(dialog).getByRole('button', { name: 'Send request' })).toBeDisabled()
      expect(within(dialog).getByText(/Replace \{student_id\}/)).toBeVisible()
    })

    it('explains a missing permission in plain language', async () => {
      const { user } = renderPage([
        { path: '/api/internal/students', response: () => jsonResponse({ error: 'Forbidden' }, 403) },
      ], { endpoints })
      await screen.findByText('List students')
      const row = screen.getByText('List students').closest('tr')
      await user.click(within(row).getByRole('button', { name: 'Try' }))
      const dialog = await screen.findByRole('dialog', { name: 'Try "List students"' })

      await user.type(within(dialog).getByRole('textbox', { name: /API Token/ }), 'mws_token')
      await user.click(within(dialog).getByRole('button', { name: 'Send request' }))

      expect(await within(dialog).findByText('Not allowed')).toBeVisible()
      expect(within(dialog).getByText(/does not have the permission needed: View student profiles/)).toBeVisible()
    })

    it('shows success in plain language and the raw response only on request', async () => {
      const { user } = renderPage([
        { path: '/api/internal/students', response: () => jsonResponse({ data: [{ id: 'a' }, { id: 'b' }] }) },
      ], { endpoints })
      await screen.findByText('List students')
      const row = screen.getByText('List students').closest('tr')
      await user.click(within(row).getByRole('button', { name: 'Try' }))
      const dialog = await screen.findByRole('dialog', { name: 'Try "List students"' })

      await user.type(within(dialog).getByRole('textbox', { name: /API Token/ }), 'mws_token')
      await user.click(within(dialog).getByRole('button', { name: 'Send request' }))

      expect(await within(dialog).findByText('Success')).toBeVisible()
      expect(within(dialog).getByText('Returned 2 items.')).toBeVisible()
      expect(within(dialog).queryByText(/"id": "a"/)).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Show Technical Response' }))
      expect(within(dialog).getByText(/"id": "a"/)).toBeVisible()
    })
  })

  describe('client row actions', () => {
    const managed = {
      id: 'client-1',
      name: 'Hub client',
      description: 'Hub backend',
      status: 'ACTIVE',
      is_active: true,
      profile: { id: 'profile-hub', code: 'hub', name: 'MWS Hub', version: 2 },
      environment: 'DEVELOPMENT',
      purpose: 'backend',
      effective_scopes: ['employees:read'],
      credentials: [
        { id: 'cred-new', token_prefix: 'mws_new', status: 'ACTIVE' },
        { id: 'cred-old', token_prefix: 'mws_old', status: 'RETIRING', expires_at: '2026-10-01T00:00:00.000Z' },
      ],
    }
    const legacy = {
      id: 'client-2',
      name: 'MTSS',
      status: 'ACTIVE',
      is_active: true,
      profile: null,
      scopes: ['employees:read'],
      token_prefix: 'mws_legacy',
    }

    it('shows one compact row with environment, purpose and version and a single actions menu', async () => {
      renderPage([], { clients: [managed] })

      expect((await screen.findAllByText('MWS Hub'))[0]).toBeVisible()
      expect(screen.getByText('Development · Backend Service · v2')).toBeVisible()
      expect(screen.getByText('mws_new')).toBeVisible()
      expect(screen.getByText(/Old token retires/)).toBeVisible()
      // Nothing to click until the menu opens: no inline Rotate/Revoke buttons.
      expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Rotate/ })).not.toBeInTheDocument()
    })

    it('lists rotate, revoke old token and revoke client in the menu of a managed client', async () => {
      const { user } = renderPage([], { clients: [managed] })

      await screen.findAllByText('MWS Hub')
      await user.click(screen.getByRole('button', { name: 'Actions for MWS Hub' }))
      expect(await screen.findByRole('button', { name: 'Rotate Credentials' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Revoke Old Token' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Revoke Client' })).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Edit Legacy Scopes' })).not.toBeInTheDocument()
    })

    it('lets the same client be rotated again after a rotation finished, without reloading', async () => {
      const rotations = []
      const { user } = renderPage(
        [
          {
            path: '/api/admin/api-clients/rotate/client-1',
            method: 'PATCH',
            response: ({ options }) => {
              rotations.push(JSON.parse(options.body))
              return jsonResponse({ data: { ...managed, new_token: `mws_token_${rotations.length}`, new_token_prefix: `mws_new${rotations.length}` } })
            },
          },
        ],
        { clients: [managed] },
      )

      await screen.findAllByText('MWS Hub')
      for (const round of [1, 2]) {
        await user.click(screen.getByRole('button', { name: 'Actions for MWS Hub' }))
        const rotate = await screen.findByRole('button', { name: 'Rotate Credentials' })
        expect(rotate).toBeEnabled()
        await user.click(rotate)
        const dialog = await screen.findByRole('dialog', { name: 'Rotate Credentials' })
        await user.click(within(dialog).getByRole('button', { name: 'Rotate' }))
        await user.click(await screen.findByRole('button', { name: 'Start Rotation' }))
        const tokenDialog = await screen.findByRole('dialog', { name: 'Rotated Credentials' })
        await waitFor(() => expect(rotations).toHaveLength(round))
        // The mode chosen in the rotate dialog reaches the dialog with the new token.
        expect(within(tokenDialog).getByRole('note')).toHaveTextContent('mws_old')
        await user.click(screen.getByRole('button', { name: 'Close Dialog' }))
        await user.click(await screen.findByRole('button', { name: 'Close Anyway' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rotated Credentials' })).not.toBeInTheDocument())
      }
    })

    it('offers legacy scope editing only for legacy clients and no old-token action', async () => {
      const { user } = renderPage([], { clients: [legacy] })

      await screen.findByText('MTSS')
      expect(screen.getByText('Legacy')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Actions for MTSS' }))
      expect(await screen.findByRole('button', { name: 'Edit Legacy Scopes' })).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Revoke Old Token' })).not.toBeInTheDocument()
    })
  })
})
