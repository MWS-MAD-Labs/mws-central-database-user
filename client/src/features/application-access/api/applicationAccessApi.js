import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

const ENTITLEMENTS = '/api/admin/application-entitlements'
const ROLES = '/api/admin/application-roles'
const RULES = '/api/admin/application-access-rules'
const ACCESS = '/api/admin/application-access'

export const applicationAccessApi = {
  // Group rules and people in one paged list.
  async listAccess(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${ACCESS}${query ? `?${query}` : ''}`)
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

  async revoke(id) {
    const response = await apiRequest(`${ENTITLEMENTS}/revoke/${id}`, { method: 'PATCH' })
    return response.data
  },

  async listRoles(params = {}) {
    const query = compactSearchParams(params).toString()
    const response = await apiRequest(`${ROLES}${query ? `?${query}` : ''}`)
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
