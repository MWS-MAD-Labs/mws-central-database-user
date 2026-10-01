import { describe, expect, it, mock } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { InternDetailPage } from '../../../src/features/interns/pages/InternDetailPage.jsx'
import { InternForm } from '../../../src/features/interns/components/InternForm.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const superAdmin = { id: 'admin-1', type: 'admin', role: 'SUPER_ADMIN', can_view_employee_pii: true, can_write_employee_data: true }

// What GET /interns/:id returns: the identity fields are left out.
const intern = {
  id: 'intern-1',
  unit_id: 'unit-1',
  identity: {
    full_name: 'Rina Intern',
    nick_name: 'Rina',
    email: 'rina@millennia21.id',
    mobile_phone: '0812',
    residential_address: 'Jakarta',
    education_level: 'S1',
    institution_name: 'Uni',
    major: 'Edu',
    graduation_year: 2024,
    can_view_pii: true,
  },
  employment: {
    unit: 'Elementary',
    job_position: 'Art Teacher',
    is_teaching_position: true,
    is_pc_mentor_eligible: false,
    pc_mentor_units: [],
    building: 'Main',
    join_date: '2026-01-01T00:00:00.000Z',
    end_date: '2027-01-01T00:00:00.000Z',
  },
  status: 'ACTIVE',
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
}

const revealed = {
  gender: 'FEMALE',
  religion: 'ISLAM',
  religion_other: null,
  birth_place: 'Bandung',
  birth_date: '2001-05-10T00:00:00.000Z',
}

function renderDetail(extraRoutes = []) {
  const fetchMock = createFetchRouter([
    { path: '/api/admin/interns/intern-1', response: jsonResponse({ data: intern }) },
    { path: '/api/admin/interns/intern-1/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: revealed }) },
    { path: /^\/api\/admin\/interns\/intern-1\/(teaching-assignments|support-assignments|pc-activity-mentorships|mutation-history)/, response: jsonResponse({ data: [] }) },
    ...extraRoutes,
  ])
  globalThis.fetch = fetchMock
  return {
    fetchMock,
    ...renderWithProviders(
      <AuthContext.Provider value={{ user: superAdmin }}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={['/interns/intern-1']}>
            <Routes>
              <Route path="/interns/:internId" element={<InternDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ConfirmProvider>
      </AuthContext.Provider>,
      { withRouter: false },
    ),
  }
}

describe('Intern sensitive identity', () => {
  it('keeps gender, religion and birth details hidden until Show, and Hide forgets the reveal', async () => {
    const { user, fetchMock } = renderDetail()
    expect(await screen.findByRole('heading', { level: 1, name: 'Rina Intern' })).toBeVisible()
    expect(screen.queryByText('Bandung')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sensitive-fields/access'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Show Sensitive Fields' }))
    const dialog = await screen.findByRole('dialog', { name: 'View sensitive fields' })
    expect(dialog).toHaveTextContent('This access is logged')
    await user.click(within(dialog).getByRole('button', { name: 'View' }))
    expect(await screen.findByText('Bandung')).toBeVisible()
    expect(sessionStorage.getItem('pii-reveal:intern:intern-1')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(sessionStorage.getItem('pii-reveal:intern:intern-1')).toBeNull()
    expect(screen.queryByText('Bandung')).not.toBeInTheDocument()
  })

  it('edit form stays hidden until Show, never sends unrevealed fields, and loads values without going dirty', async () => {
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/interns/intern-1/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: revealed }) },
      { path: /^\/api\/admin\/.*/, response: jsonResponse({ data: [] }) },
    ])
    const onSubmit = mock(() => {})
    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: superAdmin }}>
        <ConfirmProvider>
          <InternForm
            mode="edit"
            intern={intern}
            options={{ units: [{ id: 'unit-1', name: 'Elementary' }], jobPositions: [{ id: 'jp-1', name: 'Art Teacher' }], buildings: [{ id: 'b-1', name: 'Main' }] }}
            isSubmitting={false}
            onSubmit={onSubmit}
          />
        </ConfirmProvider>
      </AuthContext.Provider>,
    )

    expect(screen.queryByText('Gender')).not.toBeInTheDocument()
    // Saving something else leaves the hidden fields out of the payload.
    const name = screen.getByDisplayValue('Rina Intern')
    await user.clear(name)
    await user.type(name, 'Rina Changed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const review = await screen.findByRole('dialog', { name: /Review changes/ })
    await user.click(within(review).getByRole('button', { name: /Save changes/ }))
    const payload = onSubmit.mock.calls[0][0]
    for (const key of ['gender', 'religion', 'religion_other', 'birth_place', 'birth_date']) {
      expect(payload).not.toHaveProperty(key)
    }
  })

  it('shows the values after Show without marking the form dirty', async () => {
    globalThis.fetch = createFetchRouter([
      { path: '/api/admin/interns/intern-1/sensitive-fields/access', method: 'POST', response: jsonResponse({ data: revealed }) },
      { path: /^\/api\/admin\/.*/, response: jsonResponse({ data: [] }) },
    ])
    const { user } = renderWithProviders(
      <AuthContext.Provider value={{ user: superAdmin }}>
        <ConfirmProvider>
          <InternForm
            mode="edit"
            intern={intern}
            options={{ units: [{ id: 'unit-1', name: 'Elementary' }], jobPositions: [{ id: 'jp-1', name: 'Art Teacher' }], buildings: [{ id: 'b-1', name: 'Main' }] }}
            isSubmitting={false}
            onSubmit={() => {}}
          />
        </ConfirmProvider>
      </AuthContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: 'Show Sensitive Fields' }))
    const dialog = await screen.findByRole('dialog', { name: 'View sensitive fields' })
    await user.click(within(dialog).getByRole('button', { name: 'View' }))
    expect(await screen.findByDisplayValue('Bandung')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument())
  })
})
