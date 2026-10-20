import { apiRequest } from '../../../lib/api.js'

// The Google Workspace account behind an employee's or an intern's email. `resource` is "employees" or "interns".
export const googleAccountApi = {
  async status(resource, id) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google`)
    return response.data
  },
  async provision(resource, id, payload = {}) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/provision`, { method: 'POST', body: payload })
    return response.data
  },
  async resetPassword(resource, id) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/reset-password`, { method: 'POST' })
    return response.data
  },
}
