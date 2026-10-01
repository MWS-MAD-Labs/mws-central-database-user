import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { RequestIdentifierChangeDialog } from '../../../src/features/change-requests/components/RequestIdentifierChangeDialog.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function renderDialog(status) {
  globalThis.fetch = createFetchRouter([
    { path: '/api/admin/identifier-change-requests/approver-status', response: jsonResponse({ data: status }) },
  ])
  return renderWithProviders(
    <RequestIdentifierChangeDialog
      entityType="Employee"
      entityId="employee-1"
      fieldName="nik"
      fieldLabel="NIK"
      currentValue="3171000000000001"
      onClose={() => {}}
    />,
  )
}

describe('RequestIdentifierChangeDialog approver check', () => {
  it('warns and blocks sending when nobody can review employee requests', async () => {
    renderDialog({ employee: false, student: true })
    expect(await screen.findByRole('alert')).toHaveTextContent("No approver is set up yet")
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled()
  })

  it('lets the request through when an approver exists', async () => {
    renderDialog({ employee: true, student: true })
    expect(await screen.findByText('Current NIK')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled()
  })
})
