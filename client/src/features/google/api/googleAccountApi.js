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
  // The server mails the new password at once ({ sent_to }) and returns it ({ password }) only when it could not.
  async resetPassword(resource, id, payload = {}) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/reset-password`, { method: 'POST', body: payload })
    return response.data
  },
  // For an account that waits for its owner: the server resets it and mails the password, nothing comes back to show.
  async resetWaiting(resource, id, payload = { language: 'id' }) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/reset-waiting`, { method: 'POST', body: payload })
    return response.data
  },
  // Where the sign-in details would go, hidden ("b***@gmail.com"), or null when the account has no recovery email.
  async recoveryHint(resource, id) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/recovery-hint`)
    return response.data
  },
  // Mails the first sign-in details. Without `to` the server uses the recovery email Google holds. The server writes the mail; only the address, language and password go up.
  async sendSignIn(resource, id, payload) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/send-sign-in`, { method: 'POST', body: payload })
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
  // The recovery email is read from Google each time, hidden ("b***@gmail.com"). Central does not keep it.
  async recoveryEmail(resource, id) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/recovery-email`)
    return response.data
  },
  async changeRecoveryEmail(resource, id, recoveryEmail) {
    const response = await apiRequest(`/api/admin/${resource}/${id}/google/recovery-email`, {
      method: 'POST',
      body: { recovery_email: recoveryEmail },
    })
    return response.data
  },
  // The people with no Google link whose email is already a Google account. The preview changes nothing.
  async linkPreview() {
    const response = await apiRequest('/api/admin/google/link-existing')
    return response.data
  },
  // Where Central and Google disagree, from a full read of both. Super Admin only; nothing is changed.
  async reconcile() {
    const response = await apiRequest('/api/admin/google/reconcile')
    return response.data
  },
  async linkExisting() {
    const response = await apiRequest('/api/admin/google/link-existing', { method: 'POST' })
    return response.data
  },
}
