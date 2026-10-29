import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { InternsPage } from '../../../src/features/interns/pages/InternsPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const paging = { current_page: 1, total_page: 1, total_item: 0, size: 10 }

function renderPage(user, total = 1) {
  globalThis.fetch = createFetchRouter([
    { path: /^\/api\/admin\/interns(?:\?.*)?$/, response: jsonResponse({ data: [], paging: { ...paging, total_item: total } }) },
    { path: /^\/api\/admin\/units(?:\?.*)?$/, response: jsonResponse({ data: [] }) },
    { path: /^\/api\/admin\/job-positions(?:\?.*)?$/, response: jsonResponse({ data: [] }) },
    { path: /^\/api\/admin\/buildings(?:\?.*)?$/, response: jsonResponse({ data: [] }) },
  ])
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider><InternsPage /></ConfirmProvider>
    </AuthContext.Provider>,
    { route: '/interns' },
  )
}

describe('InternsPage import and export', () => {
  it('lets a Super Admin import and export interns', async () => {
    renderPage({ role: 'SUPER_ADMIN' })
    expect(await screen.findByRole('button', { name: 'Import' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('lets a Database Admin with the employee write permission export but not import', async () => {
    renderPage({ role: 'DATABASE_ADMIN', can_write_employee_data: true })
    expect(await screen.findByRole('button', { name: 'Export' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('keeps a Database Admin without the permission away from both', async () => {
    renderPage({ role: 'DATABASE_ADMIN', can_write_employee_data: false })
    expect(await screen.findByRole('button', { name: 'Export' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('disables Export for an empty list and leaves Import open', async () => {
    renderPage({ role: 'SUPER_ADMIN' }, 0)
    const exportButton = await screen.findByRole('button', { name: 'Export' })
    await waitFor(() => expect(exportButton).toBeDisabled())
    expect(exportButton).toHaveAttribute('title', 'Nothing to export for this list')
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })
})
