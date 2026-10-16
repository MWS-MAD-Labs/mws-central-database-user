import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { OrganizationNote } from '../../../src/features/application-access/components/OrganizationNote.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const ORGANIZATIONS = {
  path: '/api/admin/application-organizations',
  response: () =>
    jsonResponse({
      data: [
        { application_id: 'hub', organization_id: 'org_hub_aaaaaaaaaaaaaaaaaaaa', is_hub: true },
        { application_id: 'exima', organization_id: 'org_exima_bbbbbbbbbbbbbbbbbbbb', is_hub: false },
      ],
    }),
}

describe('OrganizationNote', () => {
  it('shows the Organization ID of the Hub like any other application', async () => {
    globalThis.fetch = createFetchRouter([ORGANIZATIONS])
    renderWithProviders(<OrganizationNote applicationId="hub" />)
    expect(await screen.findByText('org_hub_aaaaaaaaaaaaaaaaaaaa')).toBeVisible()
    expect(screen.getByText(/Central checks it when hub calls/)).toBeVisible()
  })

  it('shows the ID of another application and says it is already in its .env', async () => {
    globalThis.fetch = createFetchRouter([ORGANIZATIONS])
    renderWithProviders(<OrganizationNote applicationId="exima" />)
    expect(await screen.findByText('org_exima_bbbbbbbbbbbbbbbbbbbb')).toBeVisible()
    expect(screen.getByText(/already in the \.env block as CENTRAL_ORGANIZATION_ID/)).toBeVisible()
  })
})
