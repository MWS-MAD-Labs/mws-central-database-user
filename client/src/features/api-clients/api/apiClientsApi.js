import { apiRequest } from '../../../lib/api.js'

export const apiScopes = [
  'employees:read',
  'students:read',
  'students:academic_history:read',
  'students:health:read',
  'students:consent:read',
]

export const apiClientsApi = {
  async list() {
    const response = await apiRequest('/api/admin/api-clients')
    return response.data || []
  },

  async create(payload) {
    const response = await apiRequest('/api/admin/api-clients', {
      method: 'POST',
      body: payload,
    })
    return response.data
  },

  async revoke(id) {
    const response = await apiRequest(`/api/admin/api-clients/revoke/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },

  async rotate(id) {
    const response = await apiRequest(`/api/admin/api-clients/rotate/${id}`, {
      method: 'PATCH',
    })
    return response.data
  },
}
