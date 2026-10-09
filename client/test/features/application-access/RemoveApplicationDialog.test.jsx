import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { RemoveApplicationDialog } from '../../../src/features/application-access/components/RemoveApplicationDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const REMOVAL = '/api/admin/application-access/apps/demo/removal'
const DELETE = '/api/admin/application-access/apps/demo'

function renderDialog(routes, handlers = {}) {
  globalThis.fetch = createFetchRouter(routes)
  return renderWithProviders(
    <RemoveApplicationDialog applicationId="demo" onClose={handlers.onClose ?? mock()} onRemoved={handlers.onRemoved ?? mock()} />,
  )
}

describe('RemoveApplicationDialog', () => {
  it('names what still uses the application and offers no delete button', async () => {
    renderDialog([
      {
        path: REMOVAL,
        response: () =>
          jsonResponse({
            data: {
              can_remove: false,
              blockers: ['It is showing in the Hub. Hide it from the Hub first.', '3 people have access to it. Remove that access first.'],
              will_delete: { roles: 1, groups: 1, permissions: 2, clients: 1 },
            },
          }),
      },
    ])
    expect(await screen.findByText('This application is still in use, so it cannot be deleted yet.')).toBeVisible()
    expect(screen.getByText('3 people have access to it. Remove that access first.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Delete Application' })).toBeNull()
  })

  it('lists what goes with it and only deletes after the id is typed', async () => {
    const onRemoved = mock()
    const calls = []
    const { user } = renderDialog(
      [
        {
          path: REMOVAL,
          response: () =>
            jsonResponse({ data: { can_remove: true, blockers: [], will_delete: { roles: 2, groups: 1, permissions: 5, clients: 1 } } }),
        },
        {
          path: DELETE,
          method: 'DELETE',
          response: () => {
            calls.push('delete')
            return jsonResponse({ data: true })
          },
        },
      ],
      { onRemoved },
    )
    expect(await screen.findByText('2 roles')).toBeVisible()
    expect(screen.getByText('1 API connection (revoked)')).toBeVisible()
    const button = screen.getByRole('button', { name: 'Delete Application' })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText('Type "demo" to confirm'), 'demo')
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
    expect(calls).toEqual(['delete'])
  })
  it('offers Retire when it is blocked, and retires it', async () => {
    const retired = []
    const onClose = mock()
    const { user } = renderDialog(
      [
        {
          path: REMOVAL,
          response: () =>
            jsonResponse({
              data: {
                can_remove: false,
                blockers: ['It is showing in the Hub.'],
                retire_available: true,
                retired: false,
                is_hub: false,
                will_delete: { roles: 1, groups: 1, permissions: 1, clients: 1, people: 2 },
              },
            }),
        },
        {
          path: '/api/admin/application-access/apps/demo/retire',
          method: 'POST',
          response: () => {
            retired.push('demo')
            return jsonResponse({ data: { retired_at: new Date().toISOString() } })
          },
        },
      ],
      { onClose },
    )
    expect(await screen.findByText('Retire it first')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retire Application' }))
    await waitFor(() => expect(retired).toEqual(['demo']))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('has no Retire for the Hub and says why', async () => {
    renderDialog([
      {
        path: REMOVAL,
        response: () =>
          jsonResponse({
            data: {
              can_remove: false,
              blockers: ["This is the Hub's own application. Removing it would lock everyone out of the Hub."],
              retire_available: false,
              retired: false,
              is_hub: true,
              will_delete: { roles: 0, groups: 0, permissions: 0, clients: 0, people: 0 },
            },
          }),
      },
    ])
    expect(await screen.findByText('This is the Hub itself, so it cannot be retired or deleted.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Retire Application' })).toBeNull()
  })

  it('lets a retired application be deleted and counts the people who lose access', async () => {
    renderDialog([
      {
        path: REMOVAL,
        response: () =>
          jsonResponse({
            data: {
              can_remove: true,
              blockers: [],
              retire_available: false,
              retired: true,
              is_hub: false,
              will_delete: { roles: 1, groups: 1, permissions: 0, clients: 1, people: 3 },
            },
          }),
      },
    ])
    expect(await screen.findByText(/This application is retired\./)).toBeVisible()
    expect(screen.getByText('3 people lose access')).toBeVisible()
  })

  it('opens the guide on how removing works', async () => {
    const { user } = renderDialog([
      {
        path: REMOVAL,
        response: () =>
          jsonResponse({ data: { can_remove: true, blockers: [], retire_available: false, retired: false, is_hub: false, will_delete: { roles: 0, groups: 0, permissions: 0, clients: 0, people: 0 } } }),
      },
    ])
    await user.click(await screen.findByRole('button', { name: 'How removing works' }))
    expect(await screen.findByText('1. Retire')).toBeVisible()
    expect(screen.getByText('The Hub itself')).toBeVisible()
  })
})
