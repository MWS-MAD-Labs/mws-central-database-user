import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import toast from 'react-hot-toast'
import { ConfirmProvider } from '../../../src/components/ui/ConfirmDialog.jsx'
import {
  DataTransferActions,
  ImportDialog,
} from '../../../src/features/import-export/components/DataTransferActions.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const originalToastError = toast.error
const originalToastSuccess = toast.success
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
const originalAnchorClick = window.HTMLAnchorElement.prototype.click

afterEach(() => {
  toast.error = originalToastError
  toast.success = originalToastSuccess
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  window.HTMLAnchorElement.prototype.click = originalAnchorClick
  toast.remove()
})

function summary(overrides = {}) {
  return {
    total_rows: 1,
    valid_rows: 1,
    error_rows: 0,
    create_count: 1,
    update_count: 0,
    ...overrides,
  }
}

function studentPreview(overrides = {}) {
  return {
    job_id: 'student-job-1',
    status: 'PENDING',
    mode: 'FULL_REGISTRATION',
    sheet_name: 'Students',
    other_sheets: ['Archive'],
    source_headers: ['Full Name', 'Email'],
    field_mapping: { 'Full Name': 'full_name', Email: 'email' },
    unmapped_headers: [],
    summary: summary(),
    rows: [
      {
        row_number: 2,
        action: 'CREATE',
        source_raw: { 'Full Name': 'ari student', Email: 'ari@example.com' },
        raw: { full_name: 'ari student', email: 'ari@example.com' },
        errors: [],
        warnings: [],
      },
    ],
    ...overrides,
  }
}

function employeePreview(overrides = {}) {
  return {
    job_id: 'employee-job-1',
    status: 'PENDING',
    type: 'EMPLOYEE',
    summary: summary(),
    rows: [
      {
        row_number: 2,
        action: 'CREATE',
        raw: {
          employee_id: 'EMP-001',
          full_name: 'Ari Employee',
          email: 'ari.employee@example.com',
        },
        errors: [],
        warnings: [],
      },
    ],
    ...overrides,
  }
}

function optionRoutes(entity) {
  if (entity === 'employees') {
    return [
      '/api/admin/units?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/job-positions?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/job-levels?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/buildings?page=1&size=100&sort_by=name&sort_order=asc',
    ].map((path) => ({ path, response: jsonResponse({ data: [] }) }))
  }

  return [
    '/api/admin/grades?page=1&size=100&sort_by=level&sort_order=asc',
    '/api/admin/academic-years?page=1&size=100&sort_by=start_date&sort_order=desc',
    '/api/admin/classes?page=1&size=100&sort_by=grade_level&sort_order=asc',
  ].map((path) => ({ path, response: jsonResponse({ data: [] }) }))
}

function renderDialog(entity, routes, props = {}) {
  const fetchMock = createFetchRouter([...routes, ...optionRoutes(entity)])
  globalThis.fetch = fetchMock
  const result = renderWithProviders(
    <ConfirmProvider>
      <ImportDialog entity={entity} onClose={() => {}} {...props} />
    </ConfirmProvider>,
  )
  return { ...result, fetchMock }
}

describe('DataTransferActions', () => {
  it('enforces import and export permissions at the action buttons', () => {
    renderWithProviders(
      <ConfirmProvider>
        <DataTransferActions
          entity="students"
          exportParams={{ status: 'ACTIVE' }}
          canImport={false}
          canExport={false}
        />
      </ConfirmProvider>,
    )

    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('downloads CSV and XLSX exports with server and fallback file names', async () => {
    const successToast = mock(() => {})
    const createObjectURL = mock()
      .mockReturnValueOnce('blob:csv')
      .mockReturnValueOnce('blob:xlsx')
    const revokeObjectURL = mock(() => {})
    const click = mock(() => {})
    toast.success = successToast
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    window.HTMLAnchorElement.prototype.click = click
    globalThis.fetch = createFetchRouter([
      {
        path: '/api/admin/employees/export?status=ACTIVE&format=csv&export_mode=standard',
        response: new Response('csv', {
          headers: { 'content-disposition': 'attachment; filename="employees.csv"' },
        }),
      },
      {
        path: '/api/admin/employees/export?status=ACTIVE&format=xlsx&export_mode=standard',
        response: new Response('xlsx'),
      },
    ])
    const appendedDownloads = []
    const append = document.body.append.bind(document.body)
    document.body.append = (node) => {
      if (node instanceof window.HTMLAnchorElement) {
        appendedDownloads.push({ href: node.href, download: node.download })
      }
      return append(node)
    }

    const { user } = renderWithProviders(
      <ConfirmProvider>
        <DataTransferActions
          entity="employees"
          exportParams={{ status: 'ACTIVE' }}
          canImport
          canExport
        />
      </ConfirmProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.click(screen.getByRole('button', { name: 'CSV' }))
    const csvDialog = await screen.findByRole('dialog', { name: 'Export CSV?' })
    await user.click(within(csvDialog).getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(successToast).toHaveBeenCalledWith('CSV export downloaded.'))

    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.click(screen.getByRole('button', { name: 'XLSX' }))
    const xlsxDialog = await screen.findByRole('dialog', { name: 'Export XLSX?' })
    await user.click(within(xlsxDialog).getByRole('button', { name: 'Export XLSX' }))
    await waitFor(() => expect(successToast).toHaveBeenCalledWith('XLSX export downloaded.'))

    expect(appendedDownloads).toEqual([
      { href: 'blob:csv', download: 'employees.csv' },
      { href: 'blob:xlsx', download: 'employees-export.xlsx' },
    ])
    expect(click).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(['blob:csv', 'blob:xlsx'])
  })

  it('disables an export while it is pending and reports download failures', async () => {
    const errorToast = mock(() => {})
    let releaseExport
    const exportPending = new Promise((resolve) => { releaseExport = resolve })
    toast.error = errorToast
    globalThis.fetch = createFetchRouter([
      {
        path: '/api/admin/students/export?format=csv&export_mode=standard',
        response: async () => {
          await exportPending
          return jsonResponse({ message: 'Export service unavailable' }, 503)
        },
      },
    ])
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <DataTransferActions entity="students" canImport canExport />
      </ConfirmProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.click(screen.getByRole('button', { name: 'CSV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export CSV?' })
    await user.click(within(dialog).getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled())
    releaseExport()

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(
      'Export service unavailable',
      expect.objectContaining({ id: 'error:Export service unavailable' }),
    ))
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('opens the import dialog only when allowed and closes it from the dialog footer', async () => {
    const { user } = renderWithProviders(
      <ConfirmProvider>
        <DataTransferActions entity="students" canImport canExport={false} />
      </ConfirmProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('dialog', { name: 'Import students' })).toBeVisible()
    await user.click(within(screen.getByRole('dialog', { name: 'Import students' })).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Import students' })).not.toBeInTheDocument()
  })
})

describe('ImportDialog', () => {
  it('selects a student file, sends relation-attach mode, and renders validation/conflict details', async () => {
    let previewForm
    const preview = studentPreview({
      mode: 'RELATION_ATTACH',
      unmapped_headers: ['Legacy Code'],
      summary: summary({ valid_rows: 0, error_rows: 1, create_count: 0, update_count: 1 }),
      rows: [
        {
          row_number: 2,
          action: 'UPDATE',
          source_raw: { 'Full Name': 'ari student', Email: 'new@example.com' },
          raw: { full_name: 'ari student', email: 'new@example.com' },
          errors: ['Email is already used by another student'],
          warnings: ['Full Name: "Ari Student" -> "Ari Updated"'],
        },
      ],
    })
    const { container, user } = renderDialog('students', [
      {
        path: '/api/admin/students/import/preview',
        method: 'POST',
        response: ({ options }) => {
          previewForm = options.body
          return jsonResponse({ data: preview })
        },
      },
    ])
    const file = new File(['Full Name,Email\nAri Student,new@example.com'], 'students.csv', {
      type: 'text/csv',
    })

    await user.click(screen.getByRole('radio', { name: /Attach to Existing Student/ }))
    await user.upload(container.querySelector('input[type="file"]'), file)
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByText('Unmapped headers: Legacy Code')).toBeVisible()
    expect(screen.getByText(/1 row\(s\) have errors and will be skipped on commit/)).toBeVisible()
    expect(screen.getByText('Email is already used by another student')).toBeVisible()
    expect(screen.getByText('Attach to Existing')).toBeVisible()
    expect(previewForm.get('file').name).toBe('students.csv')
    expect(previewForm.get('import_mode')).toBe('RELATION_ATTACH')
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })

  it('revalidates edited mapped fields as CSV and drops unchecked rows after confirmation', async () => {
    const submissions = []
    const secondPreview = studentPreview({
      source_headers: ['Full Name', 'Email'],
      field_mapping: { 'Full Name': 'full_name', Email: 'email' },
      rows: [],
      summary: summary({ total_rows: 0, valid_rows: 0, create_count: 0 }),
    })
    const { container, user } = renderDialog('students', [
      {
        path: '/api/admin/students/import/preview',
        method: 'POST',
        response: ({ options }) => {
          submissions.push(options.body)
          return jsonResponse({ data: submissions.length === 1 ? studentPreview() : secondPreview })
        },
      },
    ])
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['Full Name,Email\nari student,ari@example.com'], 'students.csv', { type: 'text/csv' }),
    )
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByText('Editable Preview')

    const row = container.querySelector('tbody tr')
    const rowCheckbox = within(row).getByRole('checkbox')
    await user.click(rowCheckbox)
    await user.click(screen.getByRole('button', { name: 'Revalidate' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Drop unchecked rows?' })
    expect(within(confirmation).getByText('ari student')).toBeVisible()
    await user.click(within(confirmation).getByRole('button', { name: 'Drop and Revalidate' }))

    await waitFor(() => expect(submissions).toHaveLength(2))
    expect(JSON.parse(submissions[1].get('mapping'))).toEqual({
      'Full Name': 'full_name',
      Email: 'email',
      'Nick Name': 'nick_name',
      Religion: 'religion',
      Gender: 'gender',
      'Birth Place': 'birth_place',
      'Birth Date': 'birth_date',
      'Entry Type': 'entry_type',
      'Current Grade': 'current_grade',
      'Grade Consistency Override Reason (Super Admin)': 'override_too_far_ahead_reason',
    })
    const editedFile = submissions[1].get('file')
    expect(editedFile.name).toBe('students-edited.csv')
    expect(await editedFile.text()).toContain('Full Name,Email')
    expect(await editedFile.text()).not.toContain('ari@example.com')
  })

  it('reports preview request errors without entering a result state', async () => {
    const errorToast = mock(() => {})
    toast.error = errorToast
    const { container, user } = renderDialog('employees', [
      {
        path: '/api/admin/employees/import/preview',
        method: 'POST',
        response: jsonResponse({ message: 'Malformed spreadsheet' }, 422),
      },
    ])
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['broken'], 'employees.xlsx'),
    )
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(
      'Malformed spreadsheet',
      expect.objectContaining({ id: 'error:Malformed spreadsheet' }),
    ))
    expect(screen.queryByText('Editable Preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })

  it('switches workbook sheets and sends the selected sheet name', async () => {
    const submissions = []
    const { container, user } = renderDialog('students', [
      {
        path: '/api/admin/students/import/preview',
        method: 'POST',
        response: ({ options }) => {
          submissions.push(options.body)
          return jsonResponse({
            data: studentPreview(
              submissions.length === 1
                ? {}
                : { sheet_name: 'Archive', other_sheets: ['Students'] },
            ),
          })
        },
      },
    ])
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['Full Name,Email'], 'students.xlsx'),
    )
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByText('Sheet: Students')

    await user.click(screen.getByRole('button', { name: 'Workbook Sheet' }))
    await user.click(screen.getByRole('option', { name: 'Archive' }))
    await user.click(screen.getByRole('button', { name: 'Preview Sheet' }))

    await screen.findByText('Sheet: Archive')
    expect(submissions[1].get('sheet_name')).toBe('Archive')
    expect(submissions[1].get('import_mode')).toBe('FULL_REGISTRATION')
  })

  it('normalizes edited names and escapes CSV values before revalidation', async () => {
    const submissions = []
    const { container, user } = renderDialog('students', [
      {
        path: '/api/admin/students/import/preview',
        method: 'POST',
        response: ({ options }) => {
          submissions.push(options.body)
          return jsonResponse({ data: studentPreview() })
        },
      },
    ])
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['Full Name,Email'], 'students.csv', { type: 'text/csv' }),
    )
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByText('Editable Preview')

    const fullNameInput = container.querySelector('tbody tr input[type="text"]')
    fireEvent.change(fullNameInput, { target: { value: 'sITI, aMINAH' } })
    expect(screen.getByText('Needs revalidation')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Revalidate' }))

    await waitFor(() => expect(submissions).toHaveLength(2))
    expect(await submissions[1].get('file').text()).toContain('"SITI, AMINAH"')
  })

  it('commits in batches, exposes partial progress, resumes after a conflict, and shows final errors', async () => {
    const errorToast = mock(() => {})
    toast.error = errorToast
    let jobReads = 0
    let commitCalls = 0
    let releaseFirstBatch
    const firstBatchPending = new Promise((resolve) => { releaseFirstBatch = resolve })
    const initial = employeePreview({
      id: 'employee-job-1',
      job_id: undefined,
      summary: summary({ total_rows: 70, valid_rows: 70, create_count: 70 }),
    })
    const final = employeePreview({
      id: 'employee-job-1',
      job_id: undefined,
      status: 'COMPLETED',
      summary: summary({ total_rows: 70, valid_rows: 69, error_rows: 1, create_count: 69 }),
    })
    const { fetchMock, user } = renderDialog('employees', [
      {
        path: '/api/admin/employees/import/employee-job-1',
        response: () => jsonResponse({ data: jobReads++ === 0 ? initial : final }),
      },
      {
        path: '/api/admin/employees/import/employee-job-1/commit',
        method: 'POST',
        response: async () => {
          commitCalls += 1
          if (commitCalls === 1) {
            await firstBatchPending
            return jsonResponse({ data: { rows: Array.from({ length: 50 }, (_, index) => ({ index })) } })
          }
          if (commitCalls === 2) return jsonResponse({ message: 'Import job conflict' }, 409)
          return jsonResponse({ data: { rows: Array.from({ length: 20 }, (_, index) => ({ index })) } })
        },
      },
    ], { initialJobId: 'employee-job-1' })

    expect(await screen.findByText('Job employee-job-1')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Commit' }))
    expect(screen.getByRole('button', { name: 'Committing (0/70)...' })).toBeDisabled()
    releaseFirstBatch()

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(
      'Import job conflict',
      expect.objectContaining({ id: 'error:Import job conflict' }),
    ))
    expect(screen.getByRole('button', { name: 'Resume (50/70)' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Resume (50/70)' }))

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(
      'Committed with 1 row(s) still failing. See Validation column.',
      expect.objectContaining({ id: expect.stringContaining('Committed with 1 row') }),
    ))
    expect(screen.getByText('COMPLETED')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Rollback' })).toBeEnabled()

    const commitBodies = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/commit'))
      .map(([, options]) => JSON.parse(options.body))
    expect(commitBodies).toEqual([
      { offset: 0, limit: 50 },
      { offset: 50, limit: 50 },
      { offset: 50, limit: 50 },
    ])
  })

  it('turns malformed commit results into a resumable error state', async () => {
    const errorToast = mock(() => {})
    toast.error = errorToast
    const { user } = renderDialog('employees', [
      {
        path: '/api/admin/employees/import/employee-job-1',
        response: jsonResponse({ data: employeePreview({ id: 'employee-job-1', job_id: undefined }) }),
      },
      {
        path: '/api/admin/employees/import/employee-job-1/commit',
        method: 'POST',
        response: jsonResponse({ data: { unexpected: true } }),
      },
    ], { initialJobId: 'employee-job-1' })

    await user.click(await screen.findByRole('button', { name: 'Commit' }))

    await waitFor(() => expect(errorToast).toHaveBeenCalled())
    expect(String(errorToast.mock.calls[0][0])).toContain('data.rows.length')
    expect(screen.getByRole('button', { name: 'Resume (0/1)' })).toBeEnabled()
  })

  it('rolls back a completed import and updates the displayed result state', async () => {
    const successToast = mock(() => {})
    toast.success = successToast
    const completed = employeePreview({
      id: 'employee-job-1',
      job_id: undefined,
      status: 'COMPLETED',
    })
    const rolledBack = employeePreview({
      id: 'employee-job-1',
      job_id: undefined,
      status: 'ROLLED_BACK',
      summary: summary({ create_count: 0, reverted_count: 1, failed_count: 0 }),
    })
    const { user } = renderDialog('employees', [
      {
        path: '/api/admin/employees/import/employee-job-1',
        response: jsonResponse({ data: completed }),
      },
      {
        path: '/api/admin/employees/import/employee-job-1/rollback',
        method: 'POST',
        response: jsonResponse({ data: rolledBack }),
      },
    ], { initialJobId: 'employee-job-1' })

    await user.click(await screen.findByRole('button', { name: 'Rollback' }))

    expect(await screen.findByText('ROLLED_BACK')).toBeVisible()
    expect(screen.getByText('Reverted').parentElement).toHaveTextContent('Reverted1')
    expect(successToast).toHaveBeenCalledWith('Import rolled back.')
    expect(screen.queryByRole('button', { name: 'Rollback' })).not.toBeInTheDocument()
  })

  it('reports an initial job load failure and leaves commit unavailable', async () => {
    const errorToast = mock(() => {})
    toast.error = errorToast
    renderDialog('students', [
      {
        path: '/api/admin/students/import/missing-job',
        response: jsonResponse({ message: 'Import job not found' }, 404),
      },
    ], { initialJobId: 'missing-job' })

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(
      'Import job not found',
      expect.objectContaining({ id: 'error:Import job not found' }),
    ))
    expect(screen.queryByText('Loading import job...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })

  it('loads employee-specific options and omits student import modes', async () => {
    const { fetchMock } = renderDialog('employees', [
      {
        path: '/api/admin/employees/import/employee-job-1',
        response: jsonResponse({ data: employeePreview({ id: 'employee-job-1', job_id: undefined }) }),
      },
    ], { initialJobId: 'employee-job-1' })

    await screen.findByText('Job employee-job-1')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/admin/units?'))).toBe(true))
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/admin/grades?'))).toBe(false)
    expect(screen.queryByRole('radio', { name: /Full Registration/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Attach to Existing Student/ })).not.toBeInTheDocument()
  })

  it('loads student-specific options and exposes student import modes', async () => {
    const { fetchMock } = renderDialog('students', [
      {
        path: '/api/admin/students/import/student-job-1',
        response: jsonResponse({ data: studentPreview({ id: 'student-job-1', job_id: undefined }) }),
      },
    ], { initialJobId: 'student-job-1' })

    await screen.findByText('Job student-job-1')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/admin/grades?'))).toBe(true))
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/admin/units?'))).toBe(false)
    expect(screen.queryByRole('radio', { name: /Full Registration/ })).not.toBeInTheDocument()
    expect(screen.getByText('Current Grade')).toBeVisible()
    expect(screen.getByText('Grade Consistency Override Reason (Super Admin)')).toBeVisible()
  })
})
