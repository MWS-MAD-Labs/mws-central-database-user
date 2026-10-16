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
  it('says nothing for the Hub, which reads no Organization ID', async () => {
    globalThis.fetch = createFetchRouter([ORGANIZATIONS])
    const { container } = renderWithProviders(<OrganizationNote applicationId="hub" />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('Organization ID')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the ID of another application and says it is already in its .env', async () => {
    globalThis.fetch = createFetchRouter([ORGANIZATIONS])
    renderWithProviders(<OrganizationNote applicationId="exima" />)
    expect(await screen.findByText('org_exima_bbbbbbbbbbbbbbbbbbbb')).toBeVisible()
    expect(screen.getByText(/already in the \.env of exima as CENTRAL_ORGANIZATION_ID/)).toBeVisible()
  })
})
