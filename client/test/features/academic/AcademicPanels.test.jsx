import { describe, expect, it } from 'bun:test'
import { act, screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/features/auth/context/authContext.js'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import { AcademicPage } from '../../../src/features/academic/pages/AcademicPage.jsx'
import { AcademicYearsPanel } from '../../../src/features/academic/components/AcademicYearsPanel.jsx'
import { ClassesPanel } from '../../../src/features/academic/components/ClassesPanel.jsx'
import { PcActivityRoomsPanel } from '../../../src/features/academic/components/PcActivityRoomsPanel.jsx'
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
    const { queryClient, unmount } = renderPanel(<AcademicPage />, { route: '/academic?tab=classes' })
    expect(screen.getByRole('heading', { level: 1, name: 'Academic' })).toBeVisible()
    expect(await screen.findByRole('heading', { level: 2, name: 'Classes' })).toBeVisible()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    unmount()

    globalThis.fetch = createFetchRouter([
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears, paging }) },
    ])
    const { queryClient: fallbackQueryClient, unmount: unmountFallback } = renderPanel(<AcademicPage />, { route: '/academic?tab=unknown' })
    expect(await screen.findByRole('heading', { level: 2, name: 'Academic Years' })).toBeVisible()
    await waitFor(() => expect(fallbackQueryClient.isFetching()).toBe(0))
    unmountFallback()
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
    const { queryClient, user } = renderPanel(<AcademicYearsPanel />)
    await screen.findByText('2026/2027')

    await user.click(screen.getByRole('button', { name: 'New Year' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/academic-years' && options.method === 'POST',
    )).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Academic Year' })).not.toBeInTheDocument())
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    const confirm = screen.getByRole('dialog', { name: 'Delete academic year' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      url === '/api/admin/academic-years/year-2026' && options.method === 'DELETE',
    )).toBe(true))
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  })
})

describe('ClassesPanel', () => {
  it('uses URL filters, renders class data, and blocks dependent deletion', async () => {
    const dependentClass = classFixture({ has_dependents: true })
    const fetchMock = createFetchRouter(classRoutes([dependentClass]))
    globalThis.fetch = fetchMock
    renderPanel(<ClassesPanel />, { route: '/academic?grade_id=grade-1&academic_year_id=year-2026' })

    expect(await screen.findAllByText('Grade 1A')).not.toHaveLength(0)
    expect(screen.getAllByText('1/30 Students')).not.toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Delete' })[0]).toBeDisabled()
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('grade_id=grade-1') && String(url).includes('academic_year_id=year-2026'),
    )).toBe(true)
  })

  it('shows the teachers of a class in one line that opens their names by role', async () => {
    const teacher = (id, name, extra = {}) => ({ id, workforce_member: { id: `emp-${id}`, type: 'EMPLOYEE', full_name: name }, ...extra })
    const klass = classFixture({
      homeroom_teachers: [teacher('t1', 'Alpha Teacher'), teacher('t2', 'Beta Teacher')],
      supporting_homeroom_teachers: [teacher('t3', 'Gamma Teacher')],
      subject_teachers: [teacher('t4', 'Delta Teacher', { subject: 'Math' })],
    })
    globalThis.fetch = createFetchRouter(classRoutes([klass]))
    const { user } = renderPanel(<ClassesPanel />)
    await screen.findAllByText('Grade 1A')

    expect(screen.queryByText('Beta Teacher')).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '2 Homeroom · 1 Supporting · 1 Subject' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Teachers of Grade 1A' })
    expect(within(dialog).getByText('Beta Teacher')).toBeVisible()
    expect(within(dialog).getByText('Delta Teacher (Math)')).toBeVisible()
    expect(within(dialog).getByText('Homeroom')).toBeVisible()
    expect(within(dialog).getByText('Subject')).toBeVisible()
  })

  it('shows a lone teacher by name as a link to the profile, and a dash when there is none', async () => {
    const lone = classFixture({
      homeroom_teachers: [{ id: 't1', workforce_member: { id: 'emp-t1', type: 'EMPLOYEE', full_name: 'Alpha Teacher' } }],
    })
    globalThis.fetch = createFetchRouter(classRoutes([lone, classFixture({ id: 'class-2', name: 'Grade 1B' })]))
    const { container } = renderPanel(<ClassesPanel />)
    await screen.findAllByText('Grade 1A')
    expect(screen.getAllByRole('link', { name: 'Alpha Teacher' })[0]).toHaveAttribute('href', '/employees/emp-t1')
    const second = container.querySelectorAll('tbody tr')[1]
    expect(within(second).getAllByText('-').length).toBeGreaterThan(0)
  })

  it('names every grade of a mixed class and opens how past students left', async () => {
    const mixed = classFixture({
      additional_grades: [{ id: 'grade-2', name: 'Grade 2' }],
      enrollment_history_counts: { transferred: 2, withdrawn: 0, completed: 1 },
    })
    globalThis.fetch = createFetchRouter(classRoutes([mixed]))
    const { user, container } = renderPanel(<ClassesPanel />)
    await screen.findAllByText('Grade 1A')

    const row = container.querySelector('tbody tr')
    await user.click(within(row).getByRole('button', { name: '2 Grades' }))
    expect(within(screen.getByRole('dialog', { name: 'Grades of Grade 1A' })).getByText('Grade 2')).toBeVisible()
    await user.keyboard('{Escape}')

    await user.click(within(row).getByRole('button', { name: '+3 Past' }))
    const past = screen.getByRole('dialog', { name: 'Past enrollments of Grade 1A' })
    expect(within(past).getByText('2 transferred')).toBeVisible()
    expect(within(past).getByText('1 completed')).toBeVisible()
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
    // Save stays disabled until name, grade, and academic year are all set.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox'), 'grade 2a')
    await user.click(within(dialog).getByRole('button', { name: 'Select Grade' }))
    await user.click(screen.getByRole('option', { name: 'Grade 2' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select Year' }))
    await user.click(screen.getByRole('option', { name: '2026/2027' }))
    expect(within(dialog).getByRole('button', { name: 'Save' })).not.toBeDisabled()
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

describe('PcActivityRoomsPanel', () => {
  it('filters by academic year and submits explicit year plus compatible class scope', async () => {
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms(?:\?.*)?$/,
        response: ({ method }) => method === 'POST'
          ? jsonResponse({ data: { id: 'room-new' } })
          : jsonResponse({ data: [], paging: { ...paging, total_item: 0 } }),
      },
      {
        path: /^\/api\/admin\/grades(?:\?.*)?$/,
        response: jsonResponse({
          data: [
            ...grades,
            { id: 'grade-kindergarten', name: 'Kindergarten', level: 0, unit_id: 'unit-kindergarten', unit_name: 'Kindergarten' },
          ],
        }),
      },
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears }) },
      { path: /^\/api\/admin\/classes(?:\?.*)?$/, response: jsonResponse({ data: [classFixture()] }) },
      { path: /^\/api\/admin\/pc-activities-master(?:\?.*)?$/, response: jsonResponse({ data: [{ id: 'activity-1', name: 'Coding' }] }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<PcActivityRoomsPanel />)
    await screen.findByText('No PC Activity rooms found.')

    // Defaults to the active academic year - no filter click needed.
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('academic_year_id=year-2026'))).toBe(true))
    expect(screen.getByRole('button', { name: '2026/2027' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Create Room' }))
    const dialog = screen.getByRole('dialog', { name: 'Create Room' })
    expect(within(dialog).getByRole('checkbox', { name: 'Allow All Units' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '2026/2027 (Active)' })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Select PC Activity' }))
    await user.click(screen.getByRole('option', { name: 'Coding' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select day' }))
    await user.click(screen.getByRole('option', { name: 'Monday' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select duration' }))
    expect(screen.queryByRole('option', { name: /Six Months/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /^One Semester/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Elementary' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Grade 1' }))
    expect(within(dialog).getByPlaceholderText('Search class or grade')).toBeVisible()
    await user.click(within(dialog).getByRole('checkbox', { name: /^Grade 1A/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const post = await waitFor(() => fetchMock.mock.calls.find(([url, options]) =>
      url === '/api/admin/pc-activity-rooms' && options.method === 'POST'))
    expect(JSON.parse(post[1].body)).toMatchObject({
      academic_year_id: 'year-2026',
      unit_ids: ['unit-elementary'],
      class_ids: ['class-1'],
    })
  })

  it('supports selecting all compatible classes explicitly', async () => {
    const secondClass = classFixture({ id: 'class-2', name: 'Grade 1B' })
    const fetchMock = createFetchRouter([
      {
        path: /^\/api\/admin\/pc-activity-rooms(?:\?.*)?$/,
        response: ({ method }) => method === 'POST'
          ? jsonResponse({ data: { id: 'room-new' } })
          : jsonResponse({ data: [], paging: { ...paging, total_item: 0 } }),
      },
      { path: /^\/api\/admin\/grades(?:\?.*)?$/, response: jsonResponse({ data: grades }) },
      { path: /^\/api\/admin\/academic-years(?:\?.*)?$/, response: jsonResponse({ data: academicYears }) },
      { path: /^\/api\/admin\/classes(?:\?.*)?$/, response: jsonResponse({ data: [classFixture(), secondClass], paging }) },
      { path: /^\/api\/admin\/pc-activities-master(?:\?.*)?$/, response: jsonResponse({ data: [{ id: 'activity-1', name: 'Coding' }] }) },
    ])
    globalThis.fetch = fetchMock
    const { user } = renderPanel(<PcActivityRoomsPanel />)
    await screen.findByText('No PC Activity rooms found.')

    await user.click(screen.getByRole('button', { name: 'Create Room' }))
    const dialog = screen.getByRole('dialog', { name: 'Create Room' })
    await user.click(within(dialog).getByRole('button', { name: 'Select PC Activity' }))
    await user.click(screen.getByRole('option', { name: 'Coding' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select day' }))
    await user.click(screen.getByRole('option', { name: 'Monday' }))
    await user.click(within(dialog).getByRole('button', { name: 'Select duration' }))
    await user.click(screen.getByRole('option', { name: /^One Semester/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Elementary' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Grade 1' }))
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Allow All Classes (2)' }))
    expect(within(dialog).queryByPlaceholderText('Search class or grade')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const post = await waitFor(() => fetchMock.mock.calls.find(([url, options]) =>
      url === '/api/admin/pc-activity-rooms' && options.method === 'POST'))
    expect(JSON.parse(post[1].body).class_ids).toEqual(['class-1', 'class-2'])
  })
})
