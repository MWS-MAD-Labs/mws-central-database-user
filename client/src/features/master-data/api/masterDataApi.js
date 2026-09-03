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
export const institutionsApi = makeMasterDataApi('/api/admin/institutions')
export const majorsApi = makeMasterDataApi('/api/admin/majors')

// Per-unit default mentor sub-resource, nested under one PC activity - same
// activity name can suggest a different mentor per unit.
export const pcActivityDefaultMentorsApi = {
  async list(activityId) {
    const response = await apiRequest(
      `/api/admin/pc-activities-master/${activityId}/default-mentors`,
    )
    return response.data
  },

  // One call for however many activities are on the current Master Data
  // page - see the "Mentor" column.
  async listBatch(activityIds) {
    if (activityIds.length === 0) return []
    const response = await apiRequest(
      `/api/admin/pc-activities-master/default-mentors?activity_ids=${activityIds.join(',')}`,
    )
    return response.data
  },

  async set(activityId, unitId, mentorId) {
    const response = await apiRequest(
      `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
      { method: 'PATCH', body: { mentor_id: mentorId } },
    )
    return response.data
  },

  async clear(activityId, unitId) {
    const response = await apiRequest(
      `/api/admin/pc-activities-master/${activityId}/default-mentors/${unitId}`,
      { method: 'DELETE' },
    )
    return response.data
  },

  async getMentorHistory(activityId) {
    const response = await apiRequest(
      `/api/admin/pc-activities-master/${activityId}/mentor-history`,
    )
    return response.data
  },

  async rollbackMentor(activityId, historyId) {
    const response = await apiRequest(
      `/api/admin/pc-activities-master/${activityId}/mentor-history/${historyId}/rollback`,
      { method: 'PATCH' },
    )
    return response.data
  },
}

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

  institutions(params) {
    return institutionsApi.list(params)
  },

  majors(params) {
    return majorsApi.list(params)
  },
}
