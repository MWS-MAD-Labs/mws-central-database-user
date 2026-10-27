import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { AppPermissionsTab } from '../../../src/features/application-access/components/AppPermissionsTab.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('AppPermissionsTab', () => {
  it('marks a key registered before the standard format, and only that one', async () => {
    globalThis.fetch = createFetchRouter([
      {
        path: /^\/api\/admin\/application-permissions\?application_id=learnspace$/,
        response: jsonResponse({
          data: {
            application_id: 'learnspace',
            has_manifest: true,
            last_synced_at: null,
            permissions: [
              { key: 'journey:write', description: null, requires: [], source: 'MANIFEST', deprecated: false, standard_key: false, role_count: 1 },
              { key: 'journey.read', description: null, requires: [], source: 'MANIFEST', deprecated: false, standard_key: true, role_count: 1 },
            ],
          },
        }),
      },
    ])
    renderWithProviders(<AppPermissionsTab applicationId="learnspace" />)
    await waitFor(() => expect(screen.getByText('journey:write')).toBeVisible())
    expect(screen.getAllByText('Old Format')).toHaveLength(1)
  })
})
