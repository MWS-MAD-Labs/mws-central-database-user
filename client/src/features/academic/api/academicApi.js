import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

function buildQuery(params) {
  const searchParams = compactSearchParams(params)
  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

function makeCrudApi(path) {
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

export const academicYearStatuses = ['UPCOMING', 'ACTIVE', 'COMPLETED']
export const classStatuses = ['ACTIVE', 'INACTIVE']
export const enrollmentStatuses = [
  'ACTIVE',
  'COMPLETED',
  'TRANSFERRED',
  'WITHDRAWN',
]
export const enrollmentCloseStatuses = ['TRANSFERRED', 'WITHDRAWN']

export const academicYearsApi = makeCrudApi('/api/admin/academic-years')
export const gradesApi = makeCrudApi('/api/admin/grades')
export const classesApi = {
  ...makeCrudApi('/api/admin/classes'),

  async homeroomHistory(id) {
    const response = await apiRequest(
      `/api/admin/classes/${id}/homeroom-history`,
    )
    return response.data
  },
}

export const enrollmentsApi = {
  async list(params) {
    return apiRequest(`/api/admin/enrollments${buildQuery(params)}`)
  },

  async history(studentId, params) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments${buildQuery(params)}`,
    )
    return response.data
  },

  async create(studentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments`,
      {
        method: 'POST',
        body: payload,
      },
    )
    return response.data
  },

  async promote(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/promote`,
      {
        method: 'PATCH',
        body: payload,
      },
    )
    return response.data
  },

  async transfer(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/transfer`,
      {
        method: 'PATCH',
        body: payload,
      },
    )
    return response.data
  },

  async close(studentId, enrollmentId, payload) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/${enrollmentId}/close`,
      {
        method: 'PATCH',
        body: payload,
      },
    )
    return response.data
  },

  async remove(studentId, enrollmentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/delete/${enrollmentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },

  async restore(studentId, enrollmentId) {
    const response = await apiRequest(
      `/api/admin/students/${studentId}/enrollments/restore/${enrollmentId}`,
      { method: 'PATCH' },
    )
    return response.data
  },
}
