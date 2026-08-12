import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

function buildQuery(params) {
  const query = compactSearchParams(params).toString()
  return query ? `?${query}` : ''
}

export const adminRoles = ['SUPER_ADMIN', 'DATABASE_ADMIN', 'VIEWER']

export const adminUsersApi = {
  async list(params) {
    return apiRequest(`/api/admin/admin-users${buildQuery(params)}`)
  },

  async get(id) {
    const response = await apiRequest(`/api/admin/admin-users/${id}`)
    return response.data
  },

  async promote(payload) {
    const response = await apiRequest('/api/admin/admin-users/promote', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async demote(id) {
    const response = await apiRequest(`/api/admin/admin-users/demote/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },

  async setCanWriteData(id, canWriteData) {
    const response = await apiRequest(`/api/admin/admin-users/can-write-data/${id}`, {
      method: 'PATCH',
      body: { can_write_data: canWriteData },
    })
    return response.data
  },

  async setCanViewSensitiveData(id, canViewSensitiveData) {
    const response = await apiRequest(
      `/api/admin/admin-users/can-view-sensitive-data/${id}`,
      {
        method: 'PATCH',
        body: { can_view_sensitive_data: canViewSensitiveData },
      },
    )
    return response.data
  },

  async setCanViewAllUnits(id, canViewAllUnits) {
    const response = await apiRequest(
      `/api/admin/admin-users/can-view-all-units/${id}`,
      {
        method: 'PATCH',
        body: { can_view_all_units: canViewAllUnits },
      },
    )
    return response.data
  },

  async setCanViewEmployeePii(id, canViewEmployeePii) {
    const response = await apiRequest(
      `/api/admin/admin-users/can-view-employee-pii/${id}`,
      {
        method: 'PATCH',
        body: { can_view_employee_pii: canViewEmployeePii },
      },
    )
    return response.data
  },

  async grantAfterHours(id, minutes) {
    const response = await apiRequest(`/api/admin/admin-users/grant-after-hours/${id}`, {
      method: 'PATCH',
      body: { minutes },
    })
    return response.data
  },
}

export const workingDaysApi = {
  async list() {
    const response = await apiRequest('/api/admin/working-days')
    return response.data || []
  },

  async create(payload) {
    const response = await apiRequest('/api/admin/working-days', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async remove(id) {
    const response = await apiRequest(`/api/admin/working-days/${id}`, {
      method: 'DELETE',
    })
    return response.data
  },
}
