import { describe, expect, it, mock } from 'bun:test'
import { createBulkCrudApi, createCrudApi } from '../../../src/lib/crudApi.js'

function jsonResponse(data) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('CRUD API factories', () => {
  it('maps standard CRUD methods to the expected endpoints', async () => {
    const fetchMock = mock(async (url) => {
      if (url.endsWith('/count-total')) return jsonResponse({ total: 42 })
      return jsonResponse({ id: 'student-1' })
    })
    globalThis.fetch = fetchMock
    const api = createCrudApi('/api/admin/students')

    await api.list({ page: 2, search: 'Ari', empty: '', missing: undefined })
    await expect(api.get('student-1')).resolves.toEqual({ id: 'student-1' })
    await expect(api.countTotal()).resolves.toBe(42)
    await api.create({ full_name: 'Ari' })
    await api.update('student-1', { full_name: 'Ari Updated' })
    await api.remove('student-1')
    await api.restore('student-1')

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method || 'GET'])).toEqual([
      ['/api/admin/students?page=2&search=Ari', 'GET'],
      ['/api/admin/students/student-1', 'GET'],
      ['/api/admin/students/count-total', 'GET'],
      ['/api/admin/students', 'POST'],
      ['/api/admin/students/student-1', 'PATCH'],
      ['/api/admin/students/delete/student-1', 'PATCH'],
      ['/api/admin/students/restore/student-1', 'PATCH'],
    ])
  })

  it('maps bulk remove and restore payloads', async () => {
    const fetchMock = mock(async () => jsonResponse({ success_count: 2 }))
    globalThis.fetch = fetchMock
    const api = createBulkCrudApi('/api/admin/students')

    await api.bulkRemove(['a', 'b'])
    await api.bulkRestore(['a', 'b'])

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method, options.body])).toEqual([
      ['/api/admin/students/bulk/delete', 'PATCH', JSON.stringify({ ids: ['a', 'b'] })],
      ['/api/admin/students/bulk/restore', 'PATCH', JSON.stringify({ ids: ['a', 'b'] })],
    ])
  })
})
