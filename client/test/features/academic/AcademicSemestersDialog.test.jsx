import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AcademicYearsPanel } from '../../../src/features/academic/components/AcademicYearsPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { academicYears, paging, superAdminUser, viewerUser } from '../../fixtures/academic.js'

function renderPanel(user = superAdminUser) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>
        <AcademicYearsPanel />
      </ConfirmProvider>
    </AuthContext.Provider>,
    { route: '/' },
  )
}

const semester = (extra = {}) => ({
  id: 'sem-1',
  academic_year_id: 'year-2026',
  name: 'Semester 1',
  position: 1,
  start_date: '2026-07-01T00:00:00.000Z',
  end_date: '2026-12-31T00:00:00.000Z',
  ...extra,
})

function routes(list, onCall = () => {}) {
  return [
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears, paging }) },
    {
      path: '/api/admin/academic-years/year-2026/semesters/defaults',
      method: 'POST',
      response: () => {
        onCall('defaults')
        return jsonResponse({ data: [semester(), semester({ id: 'sem-2', name: 'Semester 2', position: 2 })] })
      },
    },
    {
      path: '/api/admin/academic-years/semesters/sem-1',
      method: 'DELETE',
      response: () => {
        onCall('delete')
        return jsonResponse({ data: true })
      },
    },
    { path: '/api/admin/academic-years/year-2026/semesters', method: 'GET', response: () => jsonResponse({ data: list() }) },
  ]
}

describe('AcademicSemestersDialog', () => {
  it('says there are none, and adds Semester 1 and 2 with one button', async () => {
    const calls = []
    let rows = []
    globalThis.fetch = createFetchRouter(
      routes(() => rows, (name) => {
        calls.push(name)
        rows = [semester(), semester({ id: 'sem-2', name: 'Semester 2', position: 2 })]
      }),
    )
    const { user } = renderPanel()
    await screen.findByText('2026/2027')
    await user.click(screen.getAllByRole('button', { name: 'Semesters' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Semesters of 2026/2027' })
    expect(await within(dialog).findByText(/No semesters yet/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Add Semester 1 And 2' }))
    await waitFor(() => expect(calls).toEqual(['defaults']))
    expect(await within(dialog).findByText('Semester 2')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Add Semester 1 And 2' })).toBeNull()
  })

  it('deletes a semester after asking, and shows a viewer the list without the buttons', async () => {
    const calls = []
    let rows = [semester()]
    globalThis.fetch = createFetchRouter(
      routes(() => rows, (name) => {
        calls.push(name)
        rows = []
      }),
    )
    const { user } = renderPanel()
    await screen.findByText('2026/2027')
    await user.click(screen.getAllByRole('button', { name: 'Semesters' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Semesters of 2026/2027' })
    await user.click(await within(dialog).findByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Semester' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls).toEqual(['delete']))
  })

  it('shows a viewer the semesters but no way to change them', async () => {
    globalThis.fetch = createFetchRouter(routes(() => [semester()]))
    const { user } = renderPanel(viewerUser)
    await screen.findByText('2026/2027')
    await user.click(screen.getAllByRole('button', { name: 'Semesters' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Semesters of 2026/2027' })
    expect(await within(dialog).findByText('Semester 1')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Add Semester' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})
