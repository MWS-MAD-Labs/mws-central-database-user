import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  dataTransferApi,
  downloadBlob,
} from '../../../src/features/import-export/api/dataTransferApi.js'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
const originalAnchorClick = window.HTMLAnchorElement.prototype.click

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  window.HTMLAnchorElement.prototype.click = originalAnchorClick
})

describe('dataTransferApi', () => {
  it('sends preview files and optional import settings as multipart data', async () => {
    let submittedForm
    globalThis.fetch = createFetchRouter([
      {
        path: '/api/admin/students/import/preview',
        method: 'POST',
        response: ({ options }) => {
          submittedForm = options.body
          return jsonResponse({ data: { job_id: 'job-1' } })
        },
      },
    ])
    const file = new File(['name,email'], 'students.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    await expect(dataTransferApi.preview('students', file, {
      sheetName: 'Grade 7',
      sheetIndex: 2,
      mapping: { Name: 'full_name', Email: 'email' },
      importMode: 'RELATION_ATTACH',
    })).resolves.toEqual({ job_id: 'job-1' })

    expect(submittedForm).toBeInstanceOf(FormData)
    expect(submittedForm.get('file').name).toBe('students.xlsx')
    expect(submittedForm.get('sheet_name')).toBe('Grade 7')
    expect(submittedForm.get('sheet_index')).toBe('2')
    expect(JSON.parse(submittedForm.get('mapping'))).toEqual({
      Name: 'full_name',
      Email: 'email',
    })
    expect(submittedForm.get('import_mode')).toBe('RELATION_ATTACH')
  })

  it('omits unset preview options while preserving a zero sheet index', async () => {
    let submittedForm
    globalThis.fetch = createFetchRouter([
      {
        path: '/api/admin/employees/import/preview',
        method: 'POST',
        response: ({ options }) => {
          submittedForm = options.body
          return jsonResponse({ data: { job_id: 'job-optional' } })
        },
      },
    ])

    await dataTransferApi.preview(
      'employees',
      new File(['Employee ID'], 'employees.csv', { type: 'text/csv' }),
      { sheetName: '', sheetIndex: 0, mapping: null, importMode: undefined },
    )

    expect(submittedForm.get('sheet_index')).toBe('0')
    expect(submittedForm.has('sheet_name')).toBe(false)
    expect(submittedForm.has('mapping')).toBe(false)
    expect(submittedForm.has('import_mode')).toBe(false)
  })

  it('maps employee import lifecycle endpoints and defaults an empty commit batch', async () => {
    const commitBodies = []
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/employees/import/job-2/commit',
        method: 'POST',
        response: ({ options }) => {
          commitBodies.push(JSON.parse(options.body))
          return jsonResponse({ data: { status: 'PROCESSING' } })
        },
      },
      {
        path: '/api/admin/employees/import/job-2',
        response: jsonResponse({ data: { id: 'job-2' } }),
      },
      {
        path: '/api/admin/employees/import/job-2/rollback',
        method: 'POST',
        response: jsonResponse({ data: { status: 'ROLLED_BACK' } }),
      },
      {
        path: '/api/admin/employees/import/fields',
        response: jsonResponse({ data: ['employee_id', 'full_name'] }),
      },
    ])
    globalThis.fetch = fetchMock

    await dataTransferApi.commit('employees', 'job-2')
    await dataTransferApi.commit('employees', 'job-2', { offset: 50, limit: 25 })
    await dataTransferApi.getJob('employees', 'job-2')
    await dataTransferApi.rollback('employees', 'job-2')
    await dataTransferApi.getFields('employees')

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method || 'GET'])).toEqual([
      ['/api/admin/employees/import/job-2/commit', 'POST'],
      ['/api/admin/employees/import/job-2/commit', 'POST'],
      ['/api/admin/employees/import/job-2', 'GET'],
      ['/api/admin/employees/import/job-2/rollback', 'POST'],
      ['/api/admin/employees/import/fields', 'GET'],
    ])
    expect(commitBodies).toEqual([{}, { offset: 50, limit: 25 }])
  })

  it('compacts export parameters and returns the server file name', async () => {
    const fetchMock = createFetchRouter([
      {
        path: '/api/admin/students/export?status=ACTIVE&page=2&include_deleted=false&format=csv',
        response: new Response('student export', {
          headers: {
            'content-disposition': 'attachment; filename="active-students.csv"',
          },
        }),
      },
    ])
    globalThis.fetch = fetchMock

    const result = await dataTransferApi.exportFile('students', {
      status: 'ACTIVE',
      search: '',
      page: 2,
      include_deleted: false,
      ignored: null,
      format: 'csv',
    })

    expect(result.fileName).toBe('active-students.csv')
    expect(await result.blob.text()).toBe('student export')
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('*/*')
  })

  it('downloads a blob through a temporary anchor and revokes the object URL', () => {
    const blob = new Blob(['export'])
    const createObjectURL = mock(() => 'blob:export-1')
    const revokeObjectURL = mock(() => {})
    const click = mock(() => {})
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    window.HTMLAnchorElement.prototype.click = click

    const appendedDownloads = []
    const append = document.body.append.bind(document.body)
    document.body.append = (node) => {
      if (node instanceof window.HTMLAnchorElement) {
        appendedDownloads.push({ href: node.href, download: node.download })
      }
      return append(node)
    }

    downloadBlob(blob, '')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(appendedDownloads).toEqual([{ href: 'blob:export-1', download: 'export' }])
    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export-1')
  })
})
