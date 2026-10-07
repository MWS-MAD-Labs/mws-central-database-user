import { describe, expect, it } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { WorkspaceTable } from '../../../src/features/tableTecher/pages/WorkspaceTable.jsx'
import { defaultAcademicYearId } from '../../../src/features/tableTecher/utils/academicYear.js'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import { paging, superAdminUser } from '../../fixtures/academic.js'

const years = [
  { id: 'year-2027', name: '2027/2028', status: 'UPCOMING' },
  { id: 'year-2026', name: '2026/2027', status: 'ACTIVE' },
  { id: 'year-2025', name: '2025/2026', status: 'COMPLETED' },
]

const classesByYear = {
  'year-2027': [{ id: 'class-27', name: 'Grade 1A 2027', grade: { id: 'g1', name: 'Grade 1' }, academic_year: { id: 'year-2027', name: '2027/2028' } }],
  'year-2026': [{ id: 'class-26', name: 'Grade 1A 2026', grade: { id: 'g1', name: 'Grade 1' }, academic_year: { id: 'year-2026', name: '2026/2027' } }],
  'year-2025': [{ id: 'class-25', name: 'Grade 1A 2025', grade: { id: 'g1', name: 'Grade 1' }, academic_year: { id: 'year-2025', name: '2025/2026' } }],
}

function setup() {
  const fetchMock = createFetchRouter([
    { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: jsonResponse({ data: [{ id: 'g1', name: 'Grade 1', level: 1 }], paging }) },
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: years, paging }) },
    {
      path: /^\/api\/admin\/classes(?:\?.*)?$/,
      response: ({ url }) => {
        const year = new URL(url, 'http://x').searchParams.get('academic_year_id')
        return jsonResponse({ data: classesByYear[year] || [], paging })
      },
    },
    { path: /^\/api\/admin\/students(?:\?.*)?$/, response: jsonResponse({ data: [], paging: { ...paging, total_item: 0 } }) },
  ])
  globalThis.fetch = fetchMock
  const result = renderWithProviders(
    <AuthContext.Provider value={{ user: superAdminUser }}>
      <ConfirmProvider>
        <WorkspaceTable />
      </ConfirmProvider>
    </AuthContext.Provider>,
  )
  return { ...result, fetchMock }
}

const studentCalls = (fetchMock) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/admin/students'))

describe('defaultAcademicYearId', () => {
  it('prefers the active year, then the newest', () => {
    expect(defaultAcademicYearId(years)).toBe('year-2026')
    expect(defaultAcademicYearId(years.map((year) => ({ ...year, status: 'COMPLETED' })))).toBe('year-2027')
    expect(defaultAcademicYearId([])).toBe('')
  })
})

describe('WorkspaceTable', () => {
  it('opens on the active year, lists students enrolled that year and offers only that year\'s classes', async () => {
    const { fetchMock, user } = setup()

    await waitFor(() => {
      expect(studentCalls(fetchMock).some((url) => url.includes('enrolled_academic_year_id=year-2026'))).toBe(true)
    })
    expect(studentCalls(fetchMock).every((url) => !url.includes('join_academic_year_id'))).toBe(true)

    await user.click(await screen.findByRole('button', { name: 'All Classes' }))
    expect(await screen.findByRole('option', { name: /Grade 1A 2026/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Grade 1A 2025/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Grade 1A 2027/ })).not.toBeInTheDocument()
  })

  it('has no way to look at every year at once', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: /2026\/2027/ }))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).not.toContain('All Join Years')
    expect(options.some((option) => /All Years/i.test(option.textContent))).toBe(false)
    expect(within(document.body).queryByText('All Join Years')).not.toBeInTheDocument()
  })

  it('moves to another year with its own classes and brings the default back on Reset', async () => {
    const { fetchMock, user } = setup()
    await user.click(await screen.findByRole('button', { name: /2026\/2027/ }))
    await user.click(await screen.findByRole('option', { name: /2025\/2026/ }))

    await waitFor(() => {
      expect(studentCalls(fetchMock).some((url) => url.includes('enrolled_academic_year_id=year-2025'))).toBe(true)
    })
    await user.click(screen.getByRole('button', { name: 'All Classes' }))
    expect(await screen.findByRole('option', { name: /Grade 1A 2025/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Grade 1A 2026/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(await screen.findByRole('button', { name: /2026\/2027/ })).toBeVisible()
  })
})
