import { apiRequest } from '../../../lib/api.js'
import { compactSearchParams } from '../../../lib/url.js'

const ENTITLEMENTS = '/api/admin/application-entitlements'
const ROLES = '/api/admin/application-roles'

export const applicationAccessApi = {
  async listEntitlements(params = {}) {
    const query = compactSearchParams(params).toString()
    return apiRequest(`${ENTITLEMENTS}${query ? `?${query}` : ''}`)
  },

  async grant(payload) {
    const response = await apiRequest(ENTITLEMENTS, { method: 'POST', body: payload })
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
}
