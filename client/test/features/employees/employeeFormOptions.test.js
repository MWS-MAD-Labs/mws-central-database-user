import { describe, expect, it, mock } from 'bun:test'
import { loadEmployeeFormOptions } from '../../../src/features/employees/api/employeeFormOptions.js'

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('loadEmployeeFormOptions', () => {
  it('loads all option catalogs concurrently and unwraps their data', async () => {
    const responses = {
      '/api/admin/units': [{ id: 'unit-1', name: 'Elementary' }],
      '/api/admin/job-positions': [{ id: 'position-1', name: 'Teacher' }],
      '/api/admin/job-levels': [{ id: 'level-1', name: 'Staff' }],
      '/api/admin/buildings': [{ id: 'building-1', name: 'Main' }],
    }
    const fetchMock = mock(async (url) => {
      const path = Object.keys(responses).find((candidate) => url.startsWith(candidate))
      return jsonResponse({ data: responses[path] })
    })
    globalThis.fetch = fetchMock

    await expect(loadEmployeeFormOptions()).resolves.toEqual({
      units: responses['/api/admin/units'],
      jobPositions: responses['/api/admin/job-positions'],
      jobLevels: responses['/api/admin/job-levels'],
      buildings: responses['/api/admin/buildings'],
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/units?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/job-positions?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/job-levels?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/buildings?page=1&size=100&sort_by=name&sort_order=asc',
    ])
  })

  it('normalizes missing catalog data to empty arrays', async () => {
    globalThis.fetch = mock(async () => jsonResponse({}))

    await expect(loadEmployeeFormOptions()).resolves.toEqual({
      units: [],
      jobPositions: [],
      jobLevels: [],
      buildings: [],
    })
  })
})
