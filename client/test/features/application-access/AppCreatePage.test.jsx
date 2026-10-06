import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { AppCreatePage } from '../../../src/features/application-access/pages/AppCreatePage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

function renderPage(user = { role: 'SUPER_ADMIN' }) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <Routes>
        <Route path="/application-access/apps/new" element={<AppCreatePage />} />
        <Route path="/application-access/apps/:applicationId" element={<div>App page</div>} />
      </Routes>
    </AuthContext.Provider>,
    { route: '/application-access/apps/new' },
  )
}

describe('AppCreatePage', () => {
  it('refuses anyone who is not a Super Admin', async () => {
    globalThis.fetch = createFetchRouter([])
    renderPage({ role: 'DATABASE_ADMIN' })
    expect(await screen.findByText('Only Super Admin can manage application access.')).toBeVisible()
  })

  it('turns capital letters into lowercase as they are typed', async () => {
    globalThis.fetch = createFetchRouter([])
    const { user } = renderPage()
    await user.type(screen.getByRole('textbox'), 'ExIMa')
    expect(screen.getByRole('textbox')).toHaveValue('exima')
  })

  it('turns spaces into underscores and drops other symbols', async () => {
    globalThis.fetch = createFetchRouter([])
    const { user } = renderPage()
    await user.type(screen.getByRole('textbox'), 'My App!')
    expect(screen.getByRole('textbox')).toHaveValue('my_app')
  })

  it('rejects a badly formatted id without calling the server', async () => {
    const fetchMock = createFetchRouter([])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByRole('textbox'), '9 lives')
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    expect(await screen.findByText(/^Use lowercase letters/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the application and opens it on the Roles tab', async () => {
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/application-access/applications',
        method: 'POST',
        response: () => jsonResponse({ data: { application_id: 'demo', organization_id: 'org_demo_x' } }),
      },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPage()
    await user.type(screen.getByRole('textbox'), 'demo')
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    expect(await screen.findByText('App page')).toBeVisible()
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')
      expect(JSON.parse(call[1].body)).toEqual({ application_id: 'demo' })
    })
  })
})
