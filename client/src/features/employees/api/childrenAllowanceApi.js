import { apiRequest } from '../../../lib/api.js'

// Which children count for the allowance. Anyone who can open employees reads it; a Super Admin changes it.
export const childrenAllowanceApi = {
  async get() {
    const response = await apiRequest('/api/admin/employee-settings/children-allowance')
    return response.data
  },
  async update(payload) {
    const response = await apiRequest('/api/admin/employee-settings/children-allowance', { method: 'PUT', body: payload })
    return response.data
  },
}
