import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

const ENTITLEMENTS = '/api/admin/application-entitlements'
const ROLES = '/api/admin/application-roles'
const RULES = '/api/admin/application-access-rules'

export const applicationAccessApi = {
  async listEntitlements(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${ENTITLEMENTS}${query ? `?${query}` : ''}`)
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

  async listRules() {
    const response = await apiRequest(RULES)
    return response.data
  },

  async setRule(applicationId, payload) {
    const response = await apiRequest(`${RULES}/${applicationId}`, { method: 'PUT', body: payload })
    return response.data
  },
}
