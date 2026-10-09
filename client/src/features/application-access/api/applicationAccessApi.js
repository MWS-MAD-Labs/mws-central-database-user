import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

const ENTITLEMENTS = '/api/admin/application-entitlements'
const ROLES = '/api/admin/application-roles'
const PERMISSIONS = '/api/admin/application-permissions'
const RULES = '/api/admin/application-access-rules'
const ACCESS = '/api/admin/application-access'

export const applicationAccessApi = {
  async listApplications(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${ACCESS}/applications${query ? `?${query}` : ''}`)
  },

  async createApplication(payload) {
    const response = await apiRequest(`${ACCESS}/applications`, { method: 'POST', body: payload })
    return response.data
  },

  async getDetails(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/details`)
    return response.data
  },

  async updateDetails(applicationId, payload) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/details`, { method: 'PATCH', body: payload })
    return response.data
  },

  // What is done and what is still missing, worked out from the data.
  async getSetup(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/setup`)
    return response.data
  },

  // Makes the API client of the application. The token comes back once.
  async connect(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/connect`, { method: 'POST', body: {} })
    return response.data
  },

  // Changes what the connection of this application may read.
  async updateConnectionScopes(applicationId, scopeNames) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/connection-scopes`, {
      method: 'PATCH',
      body: { scope_names: scopeNames },
    })
    return response.data
  },

  // What stops this application from being removed, and what would go with it.
  async getRemoval(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/removal`)
    return response.data
  },

  // Stops the application and keeps its data. Restore turns it back on.
  async retireApplication(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/retire`, { method: 'POST', body: {} })
    return response.data
  },

  async restoreApplication(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/restore`, { method: 'POST', body: {} })
    return response.data
  },

  async removeApplication(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}`, { method: 'DELETE' })
    return response.data
  },

  // Replaces the token of the connection. The new token comes back once.
  async rotateConnection(applicationId, { mode = 'graceful', graceSeconds = 86400 } = {}) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/rotate`, {
      method: 'POST',
      body: { immediate: mode === 'emergency', grace_hours: mode === 'graceful' ? graceSeconds / 3600 : 0 },
    })
    return response.data
  },

  async publish(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/publish`, { method: 'POST', body: {} })
    return response.data
  },

  async unpublish(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/unpublish`, { method: 'POST', body: {} })
    return response.data
  },

  // Exceptions of one group, or of "other" (access no group covers), paged.
  async listExceptions(applicationId, params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${ACCESS}/apps/${applicationId}/exceptions${query ? `?${query}` : ''}`)
  },

  // Master data a scope picker needs: what exists where and which pairs match.
  async scopeCatalog() {
    const response = await apiRequest(`${ACCESS}/scope-catalog`)
    return response.data
  },

  // Roles a group with this scope cannot take.
  async roleOptions(applicationId, params = {}) {
    const query = compactSearchParams(params).toString()
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}/role-options?${query}`)
    return response.data
  },

  async reorderRoles(applicationId, roleIds) {
    const response = await apiRequest(`${ROLES}/order`, {
      method: 'PATCH',
      body: { application_id: applicationId, role_ids: roleIds },
    })
    return response.data
  },

  // Groups of one application with the exceptions under each.
  async getApplication(applicationId) {
    const response = await apiRequest(`${ACCESS}/apps/${applicationId}`)
    return response.data
  },

  // Group rules and people in one paged list.
  async listAccess(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${ACCESS}${query ? `?${query}` : ''}`)
  },

  // Active employees with what the application's groups already give them.
  async listCandidates(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${ACCESS}/candidates${query ? `?${query}` : ''}`)
  },

  async grant(payload) {
    const response = await apiRequest(ENTITLEMENTS, { method: 'POST', body: payload })
    return response.data
  },

  async bulkGrant(payload) {
    const response = await apiRequest(`${ENTITLEMENTS}/bulk`, { method: 'POST', body: payload })
    return response.data
  },

  async updateEntitlement(id, payload) {
    const response = await apiRequest(`${ENTITLEMENTS}/${id}`, { method: 'PATCH', body: payload })
    return response.data
  },

  // Deletes the person's own access row. They fall back to group access.
  async removeEntitlement(id) {
    const response = await apiRequest(`${ENTITLEMENTS}/${id}`, { method: 'DELETE' })
    return response.data
  },

  async unblock(id) {
    const response = await apiRequest(`${ENTITLEMENTS}/unblock/${id}`, { method: 'PATCH' })
    return response.data
  },

  async revoke(id) {
    const response = await apiRequest(`${ENTITLEMENTS}/revoke/${id}`, { method: 'PATCH' })
    return response.data
  },

  async listRoles(params = {}) {
    const query = compactSearchParams(params).toString()
    const response = await apiRequest(`${ROLES}${query ? `?${query}` : ''}`)
    return response.data
  },

  async listPermissions(applicationId) {
    const response = await apiRequest(`${PERMISSIONS}?application_id=${encodeURIComponent(applicationId)}`)
    return response.data
  },

  async createPermission(payload) {
    const response = await apiRequest(PERMISSIONS, { method: 'POST', body: payload })
    return response.data
  },

  async createRole(payload) {
    const response = await apiRequest(ROLES, { method: 'POST', body: payload })
    return response.data
  },

  async updateRole(id, payload) {
    const response = await apiRequest(`${ROLES}/${id}`, { method: 'PATCH', body: payload })
    return response.data
  },

  async deleteRole(id) {
    const response = await apiRequest(`${ROLES}/${id}`, { method: 'DELETE' })
    return response.data
  },

  async getRule(id) {
    const response = await apiRequest(`${RULES}/${id}`)
    return response.data
  },

  async listOrganizations() {
    const response = await apiRequest('/api/admin/application-organizations')
    return response.data
  },

  async createRule(payload) {
    const response = await apiRequest(RULES, { method: 'POST', body: payload })
    return response.data
  },

  async updateRule(id, payload) {
    const response = await apiRequest(`${RULES}/${id}`, { method: 'PATCH', body: payload })
    return response.data
  },

  async deleteRule(id) {
    const response = await apiRequest(`${RULES}/${id}`, { method: 'DELETE' })
    return response.data
  },
}
