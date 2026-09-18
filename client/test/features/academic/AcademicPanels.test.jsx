import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AcademicPage } from '../../../src/features/academic/pages/AcademicPage.jsx'
import { AcademicYearsPanel } from '../../../src/features/academic/components/AcademicYearsPanel.jsx'
import { ClassesPanel } from '../../../src/features/academic/components/ClassesPanel.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'
import {
  academicYears,
  classFixture,
  grades,
  paging,
  superAdminUser,
  viewerUser,
} from '../../fixtures/academic.js'

function renderPanel(ui, { user = superAdminUser, route = '/' } = {}) {
  return renderWithProviders(
    <AuthContext.Provider value={{ user }}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </AuthContext.Provider>,
    { route },
  )
}

function classRoutes(classes = [classFixture()]) {
  return [
    {
      path: /^\/api\/admin\/classes(?:\?.*)?$/,
      response: ({ method }) => method === 'POST'
        ? jsonResponse({ data: { id: 'class-new' } })
        : jsonResponse({ data: classes, paging }),
    },
    { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: jsonResponse({ data: grades }) },
    { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears }) },
  ]
}

describe('AcademicPage', () => {
  it('selects the requested tab and falls back to academic years', async () => {
    globalThis.fetch = createFetchRouter([
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears, paging }) },
      ...classRoutes(),
    ])
    const { unmount } = renderPanel(<AcademicPage />, { route: '/academic?tab=classes' })
    expect(screen.getByRole('heading', { level: 1, name: 'Academic' })).toBeVisible()
    expect(await screen.findByRole('heading', { level: 2, name: 'Classes' })).toBeVisible()
    unmount()

    globalThis.fetch = createFetchRouter([
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears, paging }) },
    ])
    renderPanel(<AcademicPage />, { route: '/academic?tab=unknown' })
    expect(await screen.findByRole('heading', { level: 2, name: 'Academic Years' })).toBeVisible()
  })

  it('renders loading and request errors from the active panel', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    globalThis.fetch = createFetchRouter([
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: async () => { await pending; return jsonResponse({ data: academicYears, paging }) } },
    ])
    const { queryClient, unmount } = renderPanel(<AcademicPage />)
    expect(screen.getByText('Loading academic years...')).toBeVisible()
    await act(async () => release())
    await screen.findByText('2026/2027')
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    unmount()

    globalThis.fetch = createFetchRouter([
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ message: 'Unavailable' }, 503) },
    ])
    const { queryClient: errorQueryClient, unmount: unmountError } = renderPanel(<AcademicPage />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Academic Years' })).toBeVisible())
    expect(screen.queryByText('2026/2027')).not.toBeInTheDocument()
    await waitFor(() => expect(errorQueryClient.isFetching()).toBe(0))
    unmountError()
  })
})

describe('AcademicYearsPanel', () => {
  it('enforces write permissions and maps filters', async () => {
    const fetchMock = createFetchRouter([
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears, paging }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<AcademicYearsPanel />, { user: viewerUser })

    expect(await screen.findByText('2026/2027')).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Year' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bulk Create' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Edit' })[0]).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'All Statuses' }))
    await user.click(screen.getByRole('option', { name: 'Active' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('status=ACTIVE'),
    )).toBe(true))
  })

  it('creates and deletes an academic year', async () => {
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/academic-years(?:\?.*)?$/,
        response: ({ method }) => method === 'POST'
          ? jsonResponse({ data: { id: 'year-new' } })
          : jsonResponse({ data: academicYears, paging }),
      },
      { path: '/api/admin/academic-years/year-2026', method: 'DELETE', response: jsonResponse({ data: { id: 'year-2026' } }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<AcademicYearsPanel />)
    await screen.findByText('2026/2027')

    await user.click(screen.getByRole('button', { name: 'New Year' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/academic-years' && options.method === 'POST',
    )).toBe(true))

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    const confirm = screen.getByRole('dialog', { name: 'Delete academic year' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/academic-years/year-2026' && options.method === 'DELETE',
    )).toBe(true))
  })
})

describe('ClassesPanel', () => {
  it('uses URL filters, renders class data, and blocks dependent deletion', async () => {
    const dependentClass = classFixture({ has_dependents: true })
    const fetchMock = createFetchRouter(classRoutes([dependentClass]))
    globalThis.fetch = fetchMock
    renderPanel(<ClassesPanel />, { route: '/academic?grade_id=grade-1&academic_year_id=year-2026' })

    expect(await screen.findAllByText('Grade 1A')).not.toHaveLength(0)
    expect(screen.getAllByText('1/30 students')).not.toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Delete' })[0]).toBeDisabled()
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('grade_id=grade-1') && String(url).includes('academic_year_id=year-2026'),
    )).toBe(true)
  })

  it('creates a class and navigates to its detail route', async () => {
    const fetchMock = createFetchRouter(classRoutes())
    globalThis.fetch = fetchMock
    const { user } = renderPanel(
      <>
        <ClassesPanel />
        <p>Class route destination</p>
      </>,
    )
    await screen.findAllByText('Grade 1A')
    await user.click(screen.getByRole('button', { name: 'New Class' }))
    const dialog = screen.getByRole('dialog', { name: 'New Class' })
    await user.type(within(dialog).getByRole('textbox'), 'grade 2a')
    await user.click(within(dialog).getByRole('button', { name: 'Select Grade' }))
    await user.click(screen.getByRole('option', { name: 'Grade 2' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select Year' }))
    await user.click(screen.getByRole('option', { name: '2026/2027' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) =>
        url === '/api/admin/classes' && options.method === 'POST',
      )
      expect(call).toBeDefined()
      return call
    })
    expect(JSON.parse(post[1].body)).toMatchObject({
      name: 'Grade 2a',
      grade_id: 'grade-2',
      academic_year_id: 'year-2026',
      status: 'ACTIVE',
    })
  })
})
