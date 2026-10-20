import { apiRequest } from '../../../lib/api.js'

// The Google Workspace account behind an employee's or an intern's email. `resource` is "employees" or "interns".
export const googleAccountApi = {
  // Whether an email can be given to a new employee or intern: free, used in Central, already in Google, not allowed here.
  async emailAvailability(email) {
    const response = await apiRequest(`/api/admin/google/email-availability?email=${encodeURIComponent(email)}`)
    return response.data
  },
  // `refresh` makes the server look at Google again now (Super Admin), instead of when the last look is old.
  async status(resource, id, { refresh = false } = {}) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google${refresh ? '?refresh=true' : ''}`)
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
  async restore(resource, id) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/restore`, { method: 'POST' })
    return response.data
  },
  async setSuspended(resource, id, suspended) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/${suspended ? 'suspend' : 'unsuspend'}`, { method: 'POST' })
    return response.data
  },
}
