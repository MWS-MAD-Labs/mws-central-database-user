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
      return jsonResponse({
        data: responses[path],
        paging: { current_page: 1, total_page: 1, total_item: 1, size: 100 },
      })
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

  it('loads unit options across every available page', async () => {
    globalThis.fetch = mock(async (url) => {
      if (url.startsWith('/api/admin/units')) {
        const page = new URL(url, 'http://localhost').searchParams.get('page')
        return jsonResponse({
          data: [{ id: `unit-${page}`, name: `Unit ${page}` }],
          paging: { current_page: Number(page), total_page: 2, total_item: 2, size: 100 },
        })
      }
      return jsonResponse({ data: [] })
    })

    const result = await loadEmployeeFormOptions()

    expect(result.units).toEqual([
      { id: 'unit-1', name: 'Unit 1' },
      { id: 'unit-2', name: 'Unit 2' },
    ])
  })
})
