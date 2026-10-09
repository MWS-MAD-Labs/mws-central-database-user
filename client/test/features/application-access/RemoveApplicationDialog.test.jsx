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
    expect(await screen.findByText('This application is still in use, so it cannot be deleted.')).toBeVisible()
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
    await user.type(screen.getByLabelText('Type demo to confirm'), 'demo')
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
    expect(calls).toEqual(['delete'])
  })
})
