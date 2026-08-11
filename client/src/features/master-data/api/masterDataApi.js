import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

function buildQuery(params = {}) {
  const searchParams = compactSearchParams({
    page: 1,
    size: 100,
    sort_by: 'name',
    sort_order: 'asc',
    ...params,
  })
  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

function makeMasterDataApi(path) {
  return {
    async list(params) {
      return apiRequest(`${path}${buildQuery(params)}`)
    },

    async get(id) {
      const response = await apiRequest(`${path}/${id}`)
      return response.data
    },

    async create(payload) {
      const response = await apiRequest(path, {
        method: 'POST',
        body: payload,
      })
      return response.data
    },

    async update(id, payload) {
      const response = await apiRequest(`${path}/${id}`, {
        method: 'PATCH',
        body: payload,
      })
      return response.data
    },

    async remove(id) {
      const response = await apiRequest(`${path}/${id}`, {
        method: 'DELETE',
      })
      return response.data
    },
  }
}

export const unitsApi = makeMasterDataApi('/api/admin/units')
export const jobPositionsApi = makeMasterDataApi('/api/admin/job-positions')
export const jobLevelsApi = makeMasterDataApi('/api/admin/job-levels')
export const buildingsApi = makeMasterDataApi('/api/admin/buildings')
export const pcActivitiesApi = makeMasterDataApi('/api/admin/pc-activities-master')

export const masterDataApi = {
  units(params) {
    return unitsApi.list(params)
  },

  jobPositions(params) {
    return jobPositionsApi.list(params)
  },

  jobLevels(params) {
    return jobLevelsApi.list(params)
  },

  buildings(params) {
    return buildingsApi.list(params)
  },

  pcActivities(params) {
    return pcActivitiesApi.list(params)
  },
}
