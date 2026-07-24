import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

function list(path, params = {}) {
  const searchParams = compactSearchParams({
    page: 1,
    size: 100,
    sort_by: 'name',
    sort_order: 'asc',
    ...params,
  })
  const query = searchParams.toString()
  return apiRequest(`${path}${query ? `?${query}` : ''}`)
}

export const masterDataApi = {
  units(params) {
    return list('/api/admin/units', params)
  },

  jobPositions(params) {
    return list('/api/admin/job-positions', params)
  },

  jobLevels(params) {
    return list('/api/admin/job-levels', params)
  },
}
