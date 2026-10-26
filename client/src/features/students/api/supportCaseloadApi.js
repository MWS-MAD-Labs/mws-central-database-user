import { apiRequest } from '../../../lib/api.js'

// How many students one Special Education teacher can support. Anyone who can open students reads it; a Super Admin changes it.
export const supportCaseloadApi = {
  async get() {
    const response = await apiRequest('/api/admin/support-assignments/caseload-limit')
    return response.data
  },
  async update(payload) {
    const response = await apiRequest('/api/admin/support-assignments/caseload-limit', { method: 'PUT', body: payload })
    return response.data
  },
}
