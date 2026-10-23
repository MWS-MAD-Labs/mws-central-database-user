import { apiRequest } from '../../../lib/api.js'

// Changing the email of someone who exists. `resource` is "employees", "interns" or "students". Super Admin only.
export const emailChangeApi = {
  async change(resource, id, payload) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/change-email`, { method: 'POST', body: payload })
    return response.data
  },
}
