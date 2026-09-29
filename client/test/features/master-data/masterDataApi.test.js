import { describe, expect, it } from 'bun:test'
import {
  masterDataApi,
  pcActivitiesApi,
  unitsApi,
} from '../../../src/features/master-data/api/masterDataApi.js'
import { createFetchRouter, jsonResponse } from '../../helpers/http.js'

describe('masterDataApi', () => {
  it('maps list, detail, CRUD, and reassignment preview requests', async () => {
    const fetchMock = createFetchRouter([
      { path: '/api/admin/units?page=2&size=30&sort_by=name&sort_order=desc&search=care', response: jsonResponse({ data: [] }) },
      { path: '/api/admin/units/unit-1', method: 'GET', response: jsonResponse({ data: { id: 'unit-1' } }) },
      { path: '/api/admin/units', method: 'POST', response: jsonResponse({ data: { id: 'unit-new' } }) },
      { path: '/api/admin/units/unit-1', method: 'PATCH', response: jsonResponse({ data: { id: 'unit-1', name: 'CARE' } }) },
      { path: '/api/admin/units/unit-1', method: 'DELETE', response: jsonResponse({ data: { id: 'unit-1' } }) },
      { path: '/api/admin/pc-activities-master/activity-1/reassignment-preview?unit_ids=unit-a%2Cunit-b&page=3&size=5', response: jsonResponse({ data: [], paging: {} }) },
    ])
    globalThis.fetch = fetchMock

    await expect(unitsApi.list({ page: 2, size: 30, sort_order: 'desc', search: 'care' })).resolves.toEqual({ data: [] })
    await expect(unitsApi.get('unit-1')).resolves.toEqual({ id: 'unit-1' })
    await expect(unitsApi.create({ name: 'Care' })).resolves.toEqual({ id: 'unit-new' })
    await expect(unitsApi.update('unit-1', { name: 'CARE' })).resolves.toEqual({ id: 'unit-1', name: 'CARE' })
    await expect(unitsApi.remove('unit-1')).resolves.toEqual({ id: 'unit-1' })
    await pcActivitiesApi.previewReassignmentImpact('activity-1', ['unit-a', 'unit-b'], { page: 3, size: 5 })

    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ name: 'Care' })
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ name: 'CARE' })
    expect(fetchMock.mock.calls.map(([, options]) => options.credentials)).toEqual([
      'include', 'include', 'include', 'include', 'include', 'include',
    ])
  })

  it('maps convenience lists', async () => {
    const expectedPaths = [
      '/api/admin/units?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/job-positions?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/job-levels?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/buildings?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/pc-activities-master?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/institutions?page=1&size=100&sort_by=name&sort_order=asc',
      '/api/admin/majors?page=1&size=100&sort_by=name&sort_order=asc',
    ]
    const fetchMock = createFetchRouter(
      expectedPaths.map((path) => ({ path, response: jsonResponse({ data: [] }) })),
    )
    globalThis.fetch = fetchMock

    await Promise.all([
      masterDataApi.units(),
      masterDataApi.jobPositions(),
      masterDataApi.jobLevels(),
      masterDataApi.buildings(),
      masterDataApi.pcActivities(),
      masterDataApi.institutions(),
      masterDataApi.majors(),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(7)
  })
})
